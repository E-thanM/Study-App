import { all, get } from './store';
import { deckPath, subtreeIds } from './collection';
import { retrievability } from './scheduler';
import { CardState, type Card } from './types';
import { dayEnd, dayNumber, dayStart, stripHtml } from './util';

/*
 * Anki search syntax:
 *   dog cat            both words        dog or cat        either        -cat     not
 *   "a phrase"         exact phrase      (a or b) c        grouping      d*g      wildcard
 *   deck:Biology       deck + subdecks   deck:Bio*         wildcard      tag:cells  tag:cells::*
 *   is:new is:learn is:review is:due is:suspended is:buried is:new-only
 *   flag:1  card:2  card:Reverse  note:Cloze  front:text  re:regex
 *   prop:ivl>=10 prop:due=1 prop:due<0 prop:reps>5 prop:lapses>3 prop:ease<2.5 prop:r<0.8
 *   added:7  rated:2  rated:7:1  introduced:7  nid:… cid:…
 */

type Pred = (c: Card) => boolean;

function tokenize(q: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { out.push(ch); i++; continue; }
    let tok = '';
    let inQuote = false;
    while (i < q.length) {
      const c = q[i];
      if (c === '"') { inQuote = !inQuote; tok += c; i++; continue; }
      if (!inQuote && (/\s/.test(c) || c === '(' || c === ')')) break;
      tok += c;
      i++;
    }
    out.push(tok);
  }
  return out;
}

const unquote = (s: string) => s.replace(/^"(.*)"$/s, '$1').replace(/"/g, '');

function wildcardRe(s: string, whole = false): RegExp {
  const esc = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.');
  return new RegExp(whole ? `^${esc}$` : esc, 'i');
}

const noteTextCache = new Map<string, { at: number; text: string }>();
function noteText(noteId: string): string {
  const n = get('note', noteId);
  if (!n) return '';
  const c = noteTextCache.get(noteId);
  if (c && c.at === n.updatedAt) return c.text;
  const text = Object.values(n.fields).map(stripHtml).join('\u001f');
  noteTextCache.set(noteId, { at: n.updatedAt, text });
  return text;
}

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return Math.abs(a - b) < 1e-9;
  }
}

function termPred(raw: string): Pred {
  const t = unquote(raw);
  const colon = t.indexOf(':');
  const key = colon > 0 ? t.slice(0, colon).toLowerCase() : '';
  const val = colon > 0 ? t.slice(colon + 1) : '';
  const today = dayNumber();

  switch (key) {
    case 'deck': {
      if (val === 'current' || val === '*') return () => true;
      const re = wildcardRe(val, true);
      const ids = new Set(all('deck').filter((d) => re.test(deckPath(d))).flatMap((d) => subtreeIds(d.id)));
      return (c) => ids.has(c.deckId) || (!!c.odid && ids.has(c.odid));
    }
    case 'tag': {
      if (val === 'none') return (c) => !(get('note', c.noteId)?.tags.length);
      const re = wildcardRe(val, true);
      const reChild = wildcardRe(val + '::*', true);
      return (c) => !!get('note', c.noteId)?.tags.some((tg) => re.test(tg) || reChild.test(tg));
    }
    case 'is':
      switch (val.toLowerCase()) {
        case 'new': return (c) => c.state === CardState.New;
        case 'learn': return (c) => c.state === CardState.Learning || c.state === CardState.Relearning;
        case 'review': return (c) => c.state === CardState.Review || c.state === CardState.Relearning;
        case 'due': return (c) => c.queue === 'normal' && ((c.state === CardState.Review && c.due < dayEnd(today)) || ((c.state === CardState.Learning || c.state === CardState.Relearning) && c.due <= Date.now()));
        case 'suspended': return (c) => c.queue === 'suspended';
        case 'buried': return (c) => (c.queue === 'buried' || c.queue === 'userBuried') && (c.buriedDay ?? today) >= today;
        case 'leech': return (c) => !!get('note', c.noteId)?.tags.includes('leech');
        default: return () => false;
      }
    case 'flag': return (c) => c.flag === Number(val);
    case 'card': {
      const n = Number(val);
      if (Number.isFinite(n)) return (c) => (get('notetype', get('note', c.noteId)?.noteTypeId)?.type === 'cloze' ? c.ord === n : c.ord === n - 1);
      const re = wildcardRe(val, true);
      return (c) => {
        const nt = get('notetype', get('note', c.noteId)?.noteTypeId);
        return !!nt && re.test(nt.templates[c.ord]?.name || '');
      };
    }
    case 'note': {
      const re = wildcardRe(val, true);
      return (c) => re.test(get('notetype', get('note', c.noteId)?.noteTypeId)?.name || '');
    }
    case 'nid': return (c) => val.split(',').includes(c.noteId);
    case 'cid': return (c) => val.split(',').includes(c.id);
    case 're': {
      let re: RegExp;
      try { re = new RegExp(val, 'i'); } catch { return () => false; }
      return (c) => re.test(noteText(c.noteId));
    }
    case 'added': {
      const since = dayStart(today - Math.max(1, Number(val) || 1) + 1);
      return (c) => c.createdAt >= since;
    }
    case 'rated':
    case 'introduced': {
      const [daysS, easeS] = val.split(':');
      const since = dayStart(today - Math.max(1, Number(daysS) || 1) + 1);
      const set = new Set<string>();
      const firstSeen = new Map<string, number>();
      for (const r of all('revlog')) {
        if (key === 'introduced') {
          const f = firstSeen.get(r.cardId);
          if (f === undefined || r.review < f) firstSeen.set(r.cardId, r.review);
        } else if (r.review >= since && (!easeS || r.rating === Number(easeS))) set.add(r.cardId);
      }
      if (key === 'introduced') firstSeen.forEach((ts, id) => ts >= since && set.add(id));
      return (c) => set.has(c.id);
    }
    case 'prop': {
      const m = /^(ivl|due|reps|lapses|ease|r|s|d|pos)(>=|<=|!=|>|<|=)(-?[\d.]+)$/i.exec(val);
      if (!m) return () => false;
      const [, prop, op, nS] = m;
      const n = Number(nS);
      return (c) => {
        switch (prop.toLowerCase()) {
          case 'ivl': return c.state !== CardState.New && cmp(op, c.scheduledDays, n);
          case 'due': return c.state === CardState.Review && cmp(op, dayNumber(c.due) - today, n);
          case 'reps': return cmp(op, c.reps, n);
          case 'lapses': return cmp(op, c.lapses, n);
          case 'ease': return c.state !== CardState.New && cmp(op, c.ease || 2.5, n);
          case 'pos': return c.state === CardState.New && cmp(op, c.position, n);
          case 's': return c.state !== CardState.New && cmp(op, c.stability, n);
          case 'd': return c.state !== CardState.New && cmp(op, c.difficulty, n);
          case 'r': {
            const r = retrievability(c);
            return r !== null && cmp(op, r, n);
          }
        }
        return false;
      };
    }
  }

  // field-specific search: front:dog
  if (key) {
    const re = wildcardRe(val, true);
    const reLoose = wildcardRe(val);
    return (c) => {
      const n = get('note', c.noteId);
      if (!n) return false;
      const fk = Object.keys(n.fields).find((f) => f.toLowerCase() === key);
      if (fk === undefined) return reLoose.test(noteText(c.noteId)) && noteText(c.noteId).toLowerCase().includes(t.toLowerCase());
      const v = stripHtml(n.fields[fk]);
      return val.includes('*') ? re.test(v) : v.toLowerCase().includes(val.toLowerCase());
    };
  }

  const re = wildcardRe(t);
  return (c) => re.test(noteText(c.noteId));
}

/** Compile an Anki search string into a card predicate. */
export function compileSearch(query: string): Pred {
  const tokens = tokenize(query.trim());
  let pos = 0;

  function parseOr(): Pred {
    let left = parseAnd();
    while (tokens[pos]?.toLowerCase() === 'or') {
      pos++;
      const right = parseAnd();
      const l = left;
      left = (c) => l(c) || right(c);
    }
    return left;
  }
  function parseAnd(): Pred {
    const preds: Pred[] = [];
    while (pos < tokens.length && tokens[pos] !== ')' && tokens[pos].toLowerCase() !== 'or') {
      if (tokens[pos].toLowerCase() === 'and') { pos++; continue; }
      preds.push(parseUnary());
    }
    return (c) => preds.every((p) => p(c));
  }
  function parseUnary(): Pred {
    let tok = tokens[pos];
    if (tok === '-' ) { pos++; const p = parseUnary(); return (c) => !p(c); }
    if (tok.startsWith('-') && tok.length > 1) {
      tokens[pos] = tok.slice(1);
      const p = parseUnary();
      return (c) => !p(c);
    }
    if (tok === '(') {
      pos++;
      const p = parseOr();
      if (tokens[pos] === ')') pos++;
      return p;
    }
    pos++;
    tok = tok.trim();
    return termPred(tok);
  }

  if (!tokens.length) return () => true;
  try {
    return parseOr();
  } catch {
    return () => false;
  }
}

export function searchCards(query: string): Card[] {
  const p = compileSearch(query);
  return all('card').filter(p);
}
