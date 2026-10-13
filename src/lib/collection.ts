import { all, get, patch, put, remove } from './store';
import { newCardFields, schedule, type Rating } from './scheduler';
import { getPreset } from './seed';
import { cardOrdsFor } from './templates';
import { CardState, type Card, type Deck, type Note, type NoteType, type RevLog } from './types';
import { DAY, MIN, dayEnd, dayNumber, dayStart, shuffle, uid } from './util';

/* ───────────── decks ───────────── */

export function deckPath(deck: Deck | undefined): string {
  const parts: string[] = [];
  let d = deck;
  let guard = 0;
  while (d && guard++ < 50) {
    parts.unshift(d.name);
    d = get('deck', d.parentId);
  }
  return parts.join('::');
}

export function childDecks(parentId: string | null): Deck[] {
  return all('deck')
    .filter((d) => (d.parentId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function subtreeIds(deckId: string): string[] {
  const out = [deckId];
  const byParent = new Map<string, string[]>();
  for (const d of all('deck')) if (d.parentId) byParent.set(d.parentId, [...(byParent.get(d.parentId) || []), d.id]);
  for (let i = 0; i < out.length; i++) out.push(...(byParent.get(out[i]) || []));
  return out;
}

export function deckByPath(path: string): Deck | undefined {
  return all('deck').find((d) => deckPath(d).toLowerCase() === path.toLowerCase());
}

/**
 * Find or create "Subject::Topic::Subtopic". Returns the leaf deck id.
 * idFor gives a created deck a fixed id (e.g. derived from its path) so two devices that
 * both create it end up with the same deck instead of two copies.
 */
export function ensureDeckPath(path: string, presetId = 'preset-default', idFor?: (path: string) => string): string {
  const parts = path.split('::').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) parts.push('Default');
  let parentId: string | null = null;
  const created: Deck[] = [];
  const soFar: string[] = [];
  for (const name of parts) {
    soFar.push(name);
    const pid: string | null = parentId;
    let d: Deck | undefined =
      created.find((x) => x.parentId === pid && x.name.toLowerCase() === name.toLowerCase()) ||
      all('deck').find((x) => (x.parentId || null) === pid && x.name.toLowerCase() === name.toLowerCase());
    if (!d) {
      const parent: Deck | undefined = pid ? get('deck', pid) || created.find((x) => x.id === pid) : undefined;
      d = { id: idFor ? idFor(soFar.join('::').toLowerCase()) : uid(), kind: 'deck', updatedAt: 0, name, parentId: pid, presetId: parent?.presetId || presetId, createdAt: Date.now() };
      created.push(d);
    }
    parentId = d.id;
  }
  if (created.length) put(created);
  return parentId!;
}

export function deleteDeck(deckId: string) {
  const ids = subtreeIds(deckId);
  const idSet = new Set(ids);
  const cards = all('card');
  // filtered decks: return cards home instead of deleting them
  const toReturn = cards.filter((c) => idSet.has(c.deckId) && c.odid && !idSet.has(c.odid));
  if (toReturn.length) put(toReturn.map((c) => ({ ...c, deckId: c.odid!, odid: undefined })));
  const notes = all('note').filter((n) => idSet.has(n.deckId));
  const noteIds = new Set(notes.map((n) => n.id));
  const deadCards = cards.filter((c) => (idSet.has(c.deckId) && !c.odid) || noteIds.has(c.noteId) || (c.odid && idSet.has(c.odid)));
  remove('card', deadCards.map((c) => c.id));
  remove('note', [...noteIds]);
  remove('deck', ids);
}

export function moveDeck(deckId: string, newParentId: string | null) {
  if (newParentId && subtreeIds(deckId).includes(newParentId)) return;
  patch('deck', deckId, { parentId: newParentId });
}

/* ───────────── notes & cards ───────────── */

let positionCounter = 0;
function nextPosition(): number {
  if (!positionCounter) positionCounter = all('card').reduce((m, c) => Math.max(m, c.position || 0), 0);
  return ++positionCounter;
}

export function makeCard(note: Note, ord: number, deckId: string): Card {
  const now = Date.now();
  return {
    id: uid(),
    kind: 'card',
    updatedAt: 0,
    noteId: note.id,
    deckId,
    ord,
    ...newCardFields(),
    position: nextPosition(),
    createdAt: now,
  };
}

/** Build a note and its cards without saving (use put() to save, e.g. in bulk). */
export function buildNote(input: { noteTypeId: string; deckId: string; fields: Record<string, string>; tags?: string[]; guid?: string }): { note: Note; cards: Card[] } | null {
  const nt = get('notetype', input.noteTypeId);
  if (!nt) return null;
  const note: Note = {
    id: uid(),
    kind: 'note',
    updatedAt: 0,
    noteTypeId: nt.id,
    deckId: input.deckId,
    fields: Object.fromEntries(nt.fields.map((f) => [f, input.fields[f] ?? ''])),
    tags: normaliseTags(input.tags || []),
    createdAt: Date.now(),
    ...(input.guid ? { guid: input.guid } : {}),
  };
  const ords = cardOrdsFor(note, nt);
  if (!ords.length) return null;
  return { note, cards: ords.map((o) => makeCard(note, o, input.deckId)) };
}

export function addNote(input: { noteTypeId: string; deckId: string; fields: Record<string, string>; tags?: string[]; guid?: string }): { note: Note; cards: Card[] } | null {
  const r = buildNote(input);
  if (r) put([r.note, ...r.cards]);
  return r;
}

export function normaliseTags(tags: string[]): string[] {
  return [...new Set(tags.flatMap((t) => t.split(/\s+/)).map((t) => t.trim()).filter(Boolean))];
}

export function cardsOfNote(noteId: string): Card[] {
  return all('card').filter((c) => c.noteId === noteId);
}

/** Save note edits and generate any newly required cards (Anki behaviour). */
export function updateNote(note: Note) {
  const nt = get('notetype', note.noteTypeId);
  if (!nt) return;
  const existing = cardsOfNote(note.id);
  const ords = new Set(cardOrdsFor(note, nt));
  const have = new Set(existing.map((c) => c.ord));
  const added = [...ords].filter((o) => !have.has(o)).map((o) => makeCard(note, o, existing[0]?.odid || existing[0]?.deckId || note.deckId));
  // new (never studied) cards whose template is now empty are removed; studied ones are kept
  // (an occlusion card whose box was deleted has nothing left to test, so it goes even if studied)
  const empty = existing.filter((c) => !ords.has(c.ord) && (c.state === CardState.New || nt.type === 'occlusion'));
  put([{ ...note, tags: normaliseTags(note.tags) }, ...added]);
  if (empty.length && ords.size) remove('card', empty.map((c) => c.id));
}

export function deleteNotes(noteIds: string[]) {
  const set = new Set(noteIds);
  remove('card', all('card').filter((c) => set.has(c.noteId)).map((c) => c.id));
  remove('note', noteIds);
}

export function changeDeck(cardIds: string[], deckId: string) {
  const cards = cardIds.map((id) => get('card', id)).filter(Boolean) as Card[];
  put(cards.map((c) => (c.odid ? { ...c, odid: deckId } : { ...c, deckId })));
  // keep the note's default deck in sync for single-card notes
  const notes = new Set(cards.map((c) => c.noteId));
  put([...notes].map((id) => get('note', id)).filter(Boolean).map((n) => ({ ...n!, deckId })));
}

/** Change note type, mapping old fields to new ones by position. */
export function changeNoteType(noteIds: string[], newTypeId: string, fieldMap: Record<string, string>) {
  const nt = get('notetype', newTypeId);
  if (!nt) return;
  for (const id of noteIds) {
    const n = get('note', id);
    if (!n) continue;
    const fields = Object.fromEntries(nt.fields.map((f) => [f, fieldMap[f] ? n.fields[fieldMap[f]] ?? '' : '']));
    const updated = { ...n, noteTypeId: nt.id, fields };
    const old = cardsOfNote(id);
    const ords = cardOrdsFor(updated, nt);
    // keep scheduling for cards that still exist by ordinal
    const keep = old.filter((c) => ords.includes(c.ord));
    const drop = old.filter((c) => !ords.includes(c.ord));
    const add = ords.filter((o) => !keep.some((c) => c.ord === o)).map((o) => makeCard(updated, o, n.deckId));
    put([updated, ...add]);
    if (drop.length) remove('card', drop.map((c) => c.id));
  }
}

/* ───────────── card actions ───────────── */

export function suspend(cardIds: string[], on = true) {
  put(cardIds.map((id) => get('card', id)).filter(Boolean).map((c) => ({ ...c!, queue: on ? 'suspended' : 'normal' as const })));
}

export function bury(cardIds: string[], on = true) {
  const today = dayNumber();
  put(
    cardIds
      .map((id) => get('card', id))
      .filter(Boolean)
      .map((c) => ({ ...c!, queue: on ? ('userBuried' as const) : ('normal' as const), buriedDay: on ? today : undefined })),
  );
}

export function setFlag(cardIds: string[], flag: number) {
  put(cardIds.map((id) => get('card', id)).filter(Boolean).map((c) => ({ ...c!, flag })));
}

/** Forget: reset to new (Anki "Reset"/"Forget"). */
export function forget(cardIds: string[], resetCounts = true) {
  put(
    cardIds
      .map((id) => get('card', id))
      .filter(Boolean)
      .map((c) => ({
        ...c!,
        ...newCardFields(),
        queue: c!.queue === 'suspended' ? 'suspended' : 'normal',
        flag: c!.flag,
        reps: resetCounts ? 0 : c!.reps,
        lapses: resetCounts ? 0 : c!.lapses,
        position: nextPosition(),
      })),
  );
}

/** Set due date: "0" = today, "1-7" = random range, "5!" also sets interval. */
export function setDueDate(cardIds: string[], spec: string) {
  const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*(!)?\s*$/.exec(spec);
  if (!m) return false;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const today = dayNumber();
  put(
    cardIds
      .map((id) => get('card', id))
      .filter(Boolean)
      .map((c) => {
        const days = lo + Math.floor(Math.random() * (hi - lo + 1));
        const due = dayStart(today + days);
        const sched = m[3] || c!.state === CardState.New ? Math.max(1, days) : c!.scheduledDays;
        return {
          ...c!,
          state: CardState.Review,
          due,
          scheduledDays: sched,
          stability: c!.stability > 0 ? c!.stability : Math.max(1, days),
          difficulty: c!.difficulty || 5,
          ease: c!.ease || 2.5,
          lastReview: c!.lastReview || Date.now(),
          queue: c!.queue === 'buried' || c!.queue === 'userBuried' ? 'normal' : c!.queue,
        };
      }),
  );
  return true;
}

export function reposition(cardIds: string[], start: number, step = 1, randomise = false) {
  const cards = cardIds.map((id) => get('card', id)).filter((c): c is Card => !!c && c.state === CardState.New);
  const ordered = randomise ? shuffle(cards) : cards.sort((a, b) => a.position - b.position);
  put(ordered.map((c, i) => ({ ...c, position: start + i * step })));
}

/* ───────────── queue building ───────────── */

const LEARN_AHEAD = 20 * MIN;

function isActive(c: Card, today: number): boolean {
  if (c.queue === 'suspended') return false;
  if ((c.queue === 'buried' || c.queue === 'userBuried') && (c.buriedDay ?? today) >= today) return false;
  return true;
}

export interface TodayDone {
  newByDeck: Map<string, number>;
  revByDeck: Map<string, number>;
  timeMs: number;
  count: number;
}

let todayCache: { key: string; val: TodayDone } | null = null;
export function todayDone(): TodayDone {
  const logs = all('revlog');
  const start = dayStart();
  const key = `${start}:${logs.length}:${logs[logs.length - 1]?.id ?? ''}`;
  if (todayCache?.key === key) return todayCache.val;
  const val: TodayDone = { newByDeck: new Map(), revByDeck: new Map(), timeMs: 0, count: 0 };
  for (const r of logs) {
    if (r.review < start) continue;
    val.count++;
    val.timeMs += r.timeMs;
    const m = r.state === CardState.New ? val.newByDeck : r.state === CardState.Review ? val.revByDeck : null;
    if (m) m.set(r.deckId, (m.get(r.deckId) || 0) + 1);
  }
  todayCache = { key, val };
  return val;
}

function limitsFor(deck: Deck, done: TodayDone, today: number) {
  const p = getPreset(deck.presetId);
  const ext = deck.extend && deck.extend.day === today ? deck.extend : { newExtra: 0, revExtra: 0 };
  // like Anki, cards studied in subdecks count towards a parent's limit
  let newDone = 0, revDone = 0;
  for (const id of subtreeIds(deck.id)) {
    newDone += done.newByDeck.get(id) || 0;
    revDone += done.revByDeck.get(id) || 0;
  }
  return {
    newLeft: Math.max(0, p.newPerDay + ext.newExtra - newDone),
    revLeft: Math.max(0, p.reviewsPerDay + ext.revExtra - revDone),
  };
}

export interface DeckQueue {
  learnNow: Card[];
  learnAhead: Card[];
  learnLater: number; // learning cards due later today
  review: Card[];
  new: Card[];
}

/** Build today's queue for a deck and its subdecks, honouring per-deck daily limits. */
export function buildQueue(deckId: string, now = Date.now()): DeckQueue {
  const today = dayNumber(now);
  const end = dayEnd(today);
  const deck = get('deck', deckId);
  const q: DeckQueue = { learnNow: [], learnAhead: [], learnLater: 0, review: [], new: [] };
  if (!deck) return q;
  const ids = subtreeIds(deckId);
  const idSet = new Set(ids);
  const byDeck = new Map<string, Card[]>();
  for (const c of all('card')) {
    if (!idSet.has(c.deckId) || !isActive(c, today)) continue;
    const arr = byDeck.get(c.deckId);
    if (arr) arr.push(c);
    else byDeck.set(c.deckId, [c]);
  }
  const done = todayDone();

  // collect children first so a parent's limit caps the total of its subtree
  const collect = (id: string): { rev: Card[]; neu: Card[] } => {
    const d = get('deck', id)!;
    const cards = byDeck.get(id) || [];
    let rev: Card[] = [];
    let neu: Card[] = [];
    if (d.filtered) {
      for (const c of cards) {
        if (c.state === CardState.Learning || c.state === CardState.Relearning) continue;
        if (c.state === CardState.New) neu.push(c);
        else rev.push(c);
      }
      rev.sort((a, b) => a.due - b.due);
      neu.sort((a, b) => a.position - b.position);
      for (const child of childDecks(id)) {
        const r = collect(child.id);
        rev.push(...r.rev);
        neu.push(...r.neu);
      }
      return { rev, neu };
    }
    const p = getPreset(d.presetId);
    for (const c of cards) {
      if (c.state === CardState.Review && c.due < end) rev.push(c);
      else if (c.state === CardState.New) neu.push(c);
    }
    rev.sort((a, b) => a.due - b.due || a.position - b.position);
    neu = p.newCardOrder === 'random' ? shuffle(neu) : neu.sort((a, b) => a.position - b.position);
    for (const child of childDecks(id)) {
      const r = collect(child.id);
      rev.push(...r.rev);
      neu.push(...r.neu);
    }
    const lim = limitsFor(d, done, today);
    rev = rev.slice(0, lim.revLeft);
    neu = neu.slice(0, lim.newLeft);
    return { rev, neu };
  };
  const { rev, neu } = collect(deckId);
  q.review = rev;
  q.new = neu;

  for (const [, cards] of byDeck)
    for (const c of cards) {
      if (c.state !== CardState.Learning && c.state !== CardState.Relearning) continue;
      if (c.due <= now) q.learnNow.push(c);
      else if (c.due <= now + LEARN_AHEAD) q.learnAhead.push(c);
      else if (c.due < end) q.learnLater++;
    }
  // interday learning steps (e.g. "1d") due today are shown straight away, like Anki
  for (const [, cards] of byDeck)
    for (const c of cards)
      if ((c.state === CardState.Learning || c.state === CardState.Relearning) && c.due > now + LEARN_AHEAD && c.due < end && c.due - (c.lastReview || 0) >= DAY) {
        q.learnNow.push(c);
        q.learnLater--;
      }
  q.learnNow.sort((a, b) => a.due - b.due);
  q.learnAhead.sort((a, b) => a.due - b.due);
  return q;
}

export function deckCounts(deckId: string, now = Date.now()) {
  const q = buildQueue(deckId, now);
  return { new: q.new.length, learn: q.learnNow.length + q.learnAhead.length + q.learnLater, review: q.review.length };
}

/** Pick the next card to show, Anki v3 style. */
export function nextCard(deckId: string, now = Date.now(), skipId?: string): Card | null {
  const q = buildQueue(deckId, now);
  const not = (c: Card) => c.id !== skipId;
  const learnNow = q.learnNow.filter(not);
  if (learnNow.length) return learnNow[0];
  const rev = q.review.filter(not);
  const neu = q.new.filter(not);
  const deck = get('deck', deckId);
  const mix = deck ? getPreset(deck.presetId).newReviewMix : 'mix';
  if (rev.length || neu.length) {
    if (!neu.length) return rev[0];
    if (!rev.length) return neu[0];
    if (mix === 'before') return neu[0];
    if (mix === 'after') return rev[0];
    // spread new cards evenly through reviews
    const done = todayDone();
    const ids = new Set(subtreeIds(deckId));
    let dn = 0, dr = 0;
    done.newByDeck.forEach((v, k) => ids.has(k) && (dn += v));
    done.revByDeck.forEach((v, k) => ids.has(k) && (dr += v));
    const targetRatio = neu.length / (neu.length + rev.length);
    const actual = dn + dr ? dn / (dn + dr) : 0;
    return actual < targetRatio ? neu[0] : rev[0];
  }
  const ahead = q.learnAhead.filter(not);
  if (ahead.length) return ahead[0];
  return null;
}

/* ───────────── answering ───────────── */

export function answerCard(card: Card, rating: Rating, timeMs: number, now = Date.now()): { card: Card; log: RevLog; leech: boolean } {
  const deckForPreset = get('deck', card.odid || card.deckId) || get('deck', card.deckId);
  const preset = getPreset(deckForPreset?.presetId);
  const res = schedule(card, preset, rating, now);
  let updated: Card = { ...res.card };
  if (updated.queue === 'buried' || updated.queue === 'userBuried') updated.queue = 'normal';

  // filtered decks: send graduated cards home
  const deck = get('deck', card.deckId);
  if (deck?.filtered && card.odid && updated.state === CardState.Review) {
    updated.deckId = card.odid;
    updated.odid = undefined;
  }

  // leeches
  let leech = false;
  if (rating === 1 && card.state === CardState.Review) {
    const t = preset.leechThreshold;
    const half = Math.max(1, Math.ceil(t / 2));
    if (t > 0 && updated.lapses >= t && (updated.lapses - t) % half === 0) {
      leech = true;
      const note = get('note', card.noteId);
      if (note && !note.tags.includes('leech')) put({ ...note, tags: [...note.tags, 'leech'] });
      if (preset.leechAction === 'suspend') updated.queue = 'suspended';
    }
  }

  const prevSnapshot: Partial<Card> = { ...card };
  const log: RevLog = {
    id: uid(),
    kind: 'revlog',
    updatedAt: 0,
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.odid || card.deckId,
    rating,
    state: card.state,
    review: now,
    timeMs: Math.min(timeMs, preset.maxAnswerSeconds * 1000),
    interval: res.interval,
    lastInterval: card.scheduledDays,
    ease: updated.ease || 0,
    prev: prevSnapshot,
  };

  // bury siblings until tomorrow
  const today = dayNumber(now);
  const siblings = cardsOfNote(card.noteId).filter(
    (s) =>
      s.id !== card.id &&
      s.queue === 'normal' &&
      ((preset.buryNewSiblings && s.state === CardState.New) ||
        (preset.buryReviewSiblings && s.state === CardState.Review && s.due < dayEnd(today))),
  );
  put([updated, log, ...siblings.map((s) => ({ ...s, queue: 'buried' as const, buriedDay: today }))]);
  return { card: updated, log, leech };
}

/** Undo the most recent review (Anki Ctrl+Z). Returns the restored card. */
export function undoLastReview(): Card | null {
  const logs = all('revlog');
  let last: RevLog | undefined;
  for (const l of logs) if (l.prev && (!last || l.review > last.review)) last = l;
  if (!last?.prev) return null;
  const cur = get('card', last.cardId);
  if (!cur) return null;
  const restored = { ...cur, ...last.prev, id: cur.id, kind: 'card' } as Card;
  // un-bury siblings buried by that answer
  const today = dayNumber();
  const sibs = cardsOfNote(cur.noteId).filter((s) => s.id !== cur.id && s.queue === 'buried' && s.buriedDay === today);
  put([restored, ...sibs.map((s) => ({ ...s, queue: 'normal' as const, buriedDay: undefined }))]);
  remove('revlog', last.id);
  return restored;
}

/* ───────────── filtered decks / custom study ───────────── */

export function emptyFiltered(deckId: string) {
  const cards = all('card').filter((c) => c.deckId === deckId && c.odid);
  put(cards.map((c) => ({ ...c, deckId: c.odid!, odid: undefined })));
}

export function rebuildFiltered(deckId: string, matcher: (c: Card) => boolean): number {
  const deck = get('deck', deckId);
  if (!deck?.filtered) return 0;
  emptyFiltered(deckId);
  const today = dayNumber();
  let cards = all('card').filter(
    (c) => !c.odid && c.deckId !== deckId && !get('deck', c.deckId)?.filtered && c.queue !== 'suspended' && isActive(c, today) && matcher(c),
  );
  switch (deck.filtered.order) {
    case 'random': cards = shuffle(cards); break;
    case 'due': cards.sort((a, b) => a.due - b.due); break;
    case 'added': cards.sort((a, b) => a.createdAt - b.createdAt); break;
    case 'lapses': cards.sort((a, b) => b.lapses - a.lapses); break;
    case 'interval': cards.sort((a, b) => a.scheduledDays - b.scheduledDays); break;
  }
  cards = cards.slice(0, deck.filtered.limit);
  put(cards.map((c) => ({ ...c, odid: c.deckId, deckId })));
  return cards.length;
}

export function extendLimits(deckId: string, newExtra: number, revExtra: number) {
  const d = get('deck', deckId);
  if (!d) return;
  const today = dayNumber();
  const cur = d.extend && d.extend.day === today ? d.extend : { day: today, newExtra: 0, revExtra: 0 };
  patch('deck', deckId, { extend: { day: today, newExtra: cur.newExtra + newExtra, revExtra: cur.revExtra + revExtra } });
}

export function noteTypeOf(note: Note | undefined): NoteType | undefined {
  return note ? get('notetype', note.noteTypeId) : undefined;
}

/** Unbury everything in a deck (Anki "Unbury"). */
export function unburyDeck(deckId: string) {
  const ids = new Set(subtreeIds(deckId));
  const cards = all('card').filter((c) => ids.has(c.deckId) && (c.queue === 'buried' || c.queue === 'userBuried'));
  put(cards.map((c) => ({ ...c, queue: 'normal' as const, buriedDay: undefined })));
}

/** Review time (ms) and review count per deck, including subdecks. */
let timeCache: { key: string; map: Map<string, { ms: number; reviews: number }> } | null = null;
export function deckTotals(deckId: string): { ms: number; reviews: number } {
  const logs = all('revlog');
  const key = `${logs.length}:${logs[logs.length - 1]?.id ?? ''}`;
  if (timeCache?.key !== key) {
    const map = new Map<string, { ms: number; reviews: number }>();
    for (const r of logs) {
      const cur = map.get(r.deckId) || { ms: 0, reviews: 0 };
      cur.ms += r.timeMs;
      cur.reviews++;
      map.set(r.deckId, cur);
    }
    timeCache = { key, map };
  }
  let ms = 0, reviews = 0;
  for (const id of subtreeIds(deckId)) {
    const t = timeCache.map.get(id);
    if (t) { ms += t.ms; reviews += t.reviews; }
  }
  return { ms, reviews };
}

/* ───────────── duplicate clean-up ───────────── */

const studied = (c: Card) => c.reps + c.lapses + (c.state === CardState.New ? 0 : 1);

/**
 * Merge decks that share a parent and a name (e.g. two "Biology" decks made when the same starter
 * decks were added on two devices before they had synced), then drop starter notes that exist twice.
 * Cards, notes and subdecks move to the deck with the most cards; for a duplicated note the copy with
 * the most review progress is kept. Safe to run repeatedly. Returns how many decks/notes were merged.
 */
export function mergeDuplicates(): { decks: number; notes: number } {
  let decks = 0, notes = 0;
  for (let pass = 0; pass < 12; pass++) {
    const live = all('deck').filter((d) => !d.deleted);
    const groups = new Map<string, Deck[]>();
    for (const d of live) {
      if (d.filtered) continue;
      const k = `${d.parentId || ''}\u0001${d.name.trim().toLowerCase()}`;
      groups.set(k, [...(groups.get(k) || []), d]);
    }
    const dupes = [...groups.values()].filter((g) => g.length > 1);
    if (!dupes.length) break;
    const cards = all('card');
    const size = new Map<string, number>();
    for (const c of cards) size.set(c.deckId, (size.get(c.deckId) || 0) + 1);
    const writes: (Deck | Card | Note)[] = [];
    const dead: string[] = [];
    for (const g of dupes) {
      const keep = [...g].sort((a, b) => (size.get(b.id) || 0) - (size.get(a.id) || 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
      for (const d of g) {
        if (d.id === keep.id) continue;
        for (const c of cards) {
          if (c.deckId === d.id) writes.push({ ...c, deckId: keep.id });
          else if (c.odid === d.id) writes.push({ ...c, odid: keep.id });
        }
        for (const n of all('note')) if (n.deckId === d.id) writes.push({ ...n, deckId: keep.id });
        for (const ch of live) if (ch.parentId === d.id) writes.push({ ...ch, parentId: keep.id });
        if (d.collapsed === false && keep.collapsed) writes.push({ ...keep, collapsed: false });
        dead.push(d.id);
      }
      decks += g.length - 1;
    }
    // a card or note rewritten twice keeps its last write
    const byId = new Map(writes.map((w) => [w.id, w]));
    put([...byId.values()]);
    remove('deck', dead);
  }

  // notes installed twice carry the same starter id
  const byGuid = new Map<string, Note[]>();
  for (const n of all('note')) if (n.guid && !n.deleted) byGuid.set(n.guid, [...(byGuid.get(n.guid) || []), n]);
  const extra = [...byGuid.values()].filter((g) => g.length > 1);
  if (extra.length) {
    const progress = new Map<string, number>();
    for (const c of all('card')) progress.set(c.noteId, (progress.get(c.noteId) || 0) + studied(c));
    const drop: string[] = [];
    for (const g of extra) {
      const keep = [...g].sort((a, b) => (progress.get(b.id) || 0) - (progress.get(a.id) || 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
      for (const n of g) if (n.id !== keep.id) drop.push(n.id);
    }
    deleteNotes(drop);
    notes = drop.length;
  }
  return { decks, notes };
}
