import DOMPurify from 'dompurify';
import katex from 'katex';
import { all } from './store';
import type { Note, NoteType } from './types';
import { escapeHtml, stripHtml } from './util';
import { occlusionImage, occlusionOrds, renderOcclusion } from './occlusion';

/* Anki-compatible card template rendering. Supports:
 *   {{Field}} {{text:Field}} {{hint:Field}} {{cloze:Field}} {{type:Field}} {{type:cloze:Field}}
 *   {{#Field}}…{{/Field}} {{^Field}}…{{/Field}} {{FrontSide}} {{Tags}} {{Deck}} {{Subdeck}} {{Card}} {{Type}}
 *   {{tts xx_XX:Field}}  cloze {{c1::answer::hint}}  [sound:file]  <img src="file">  MathJax \( \) \[ \]
 */

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeOrds(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

function renderCloze(text: string, ord: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE_RE, (_all, n: string, answer: string, hint?: string) => {
    if (Number(n) !== ord) return answer;
    if (side === 'back') return `<span class="cloze">${answer}</span>`;
    return `<span class="cloze">[${hint ? escapeHtml(stripHtml(hint)) : '…'}]</span>`;
  });
}

/** The answer text(s) for a cloze ordinal – used by type-in-the-answer. */
function clozeAnswer(text: string, ord: number): string {
  const out: string[] = [];
  for (const m of text.matchAll(CLOZE_RE)) if (Number(m[1]) === ord) out.push(stripHtml(m[2]));
  return out.join(', ');
}

export interface RenderCtx {
  note: Note;
  noteType: NoteType;
  ord: number; // template index (standard) or cloze number (cloze)
  deckName?: string;
  typed?: string; // what the user typed (back side)
}

export interface Rendered {
  html: string;
  /** expected answer if the template contains a type-in field */
  typeAnswer?: string;
}

function isEmptyField(v: string | undefined) {
  if (!v) return true;
  return !stripHtml(v).trim() && !/<img|\[sound:/i.test(v);
}

function renderTemplate(tpl: string, ctx: RenderCtx, side: 'front' | 'back', frontHtml?: string): Rendered {
  const { note, noteType, ord } = ctx;
  const fields = note.fields;
  let typeAnswer: string | undefined;

  // conditionals (repeat for nesting)
  let s = tpl;
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_m, kind: string, name: string, inner: string) => {
      const empty = isEmptyField(fields[name.trim()]);
      return (kind === '#' ? !empty : empty) ? inner : '';
    });
    if (s === before) break;
  }

  s = s.replace(/\{\{([^}]+)\}\}/g, (_m, raw: string) => {
    const tag = raw.trim();
    if (tag === 'FrontSide') return frontHtml ?? '';
    if (tag === 'Tags') return escapeHtml(note.tags.join(' '));
    if (tag === 'Deck') return escapeHtml(ctx.deckName || '');
    if (tag === 'Subdeck') return escapeHtml((ctx.deckName || '').split('::').pop() || '');
    if (tag === 'Type') return escapeHtml(noteType.name);
    if (tag === 'Card') return escapeHtml(noteType.type === 'cloze' ? `Cloze ${ord}` : noteType.type === 'occlusion' ? `Box ${ord}` : noteType.templates[ord]?.name || '');

    // {{tts en_GB:Field}}
    const tts = /^tts\s+([\w-]+)[^:]*:(.+)$/.exec(tag);
    if (tts) {
      const text = stripHtml(fields[tts[2].trim()] || '');
      return text ? `<button class="tts-btn" data-tts="${escapeHtml(text)}" data-lang="${escapeHtml(tts[1].replace('_', '-'))}" aria-label="Speak">🔊</button>` : '';
    }

    const parts = tag.split(':');
    const fieldName = parts.pop()!.trim();
    const filters = parts.map((p) => p.trim());
    let value = fields[fieldName] ?? '';
    if (!(fieldName in fields) && !filters.length) return `{{${escapeHtml(tag)}}}`; // unknown field, show like Anki

    if (filters[0] === 'type') {
      if (filters[1] === 'cloze') typeAnswer = clozeAnswer(value, ord);
      else typeAnswer = stripHtml(value);
      if (side === 'front') return '<div class="typeans-slot"></div>';
      return `<div class="typeans-result">${typeCompare(ctx.typed ?? '', typeAnswer)}</div>`;
    }
    for (const f of filters.reverse()) {
      if (f === 'cloze') value = renderCloze(value, ord, side);
      else if (f === 'text') value = escapeHtml(stripHtml(value));
      else if (f === 'hint')
        value = value ? `<details class="hint"><summary>Show hint</summary>${value}</details>` : '';
      else if (f === 'furigana' || f === 'kana' || f === 'kanji') value = value.replace(/\[[^\]]*\]/g, '');
    }
    return value;
  });

  return { html: s, typeAnswer };
}

/** Anki-style typed-answer comparison. */
export function typeCompare(given: string, expected: string): string {
  const g = given.trim();
  const e = expected.trim();
  if (!g) return `<code class="ta-expected">${escapeHtml(e)}</code>`;
  if (g === e) return `<code class="ta-good">${escapeHtml(e)}</code>`;
  // LCS-based char diff
  const n = g.length, m = e.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = g[i] === e[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, typed = '', exp = '';
  while (i < n || j < m) {
    if (i < n && j < m && g[i] === e[j]) {
      typed += `<span class="ta-good">${escapeHtml(g[i])}</span>`;
      exp += `<span class="ta-good">${escapeHtml(e[j])}</span>`;
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      typed += `<span class="ta-missed">-</span>`;
      exp += `<span class="ta-missed">${escapeHtml(e[j])}</span>`;
      j++;
    } else {
      typed += `<span class="ta-bad">${escapeHtml(g[i])}</span>`;
      i++;
    }
  }
  return `<code>${typed}</code><br><span class="ta-arrow">↓</span><br><code>${exp}</code>`;
}

export function renderCard(ctx: RenderCtx): { front: Rendered; back: Rendered } {
  if (ctx.noteType.type === 'occlusion') return { front: { html: renderOcclusion(ctx.note, ctx.ord, 'front') }, back: { html: renderOcclusion(ctx.note, ctx.ord, 'back') } };
  const tpl = ctx.noteType.type === 'cloze' ? ctx.noteType.templates[0] : ctx.noteType.templates[ctx.ord];
  if (!tpl) return { front: { html: '<i>Missing template</i>' }, back: { html: '' } };
  const front = renderTemplate(tpl.front, ctx, 'front');
  const back = renderTemplate(tpl.back, ctx, 'back', front.html);
  return { front, back };
}

/** Which card ordinals a note should have. */
export function cardOrdsFor(note: Pick<Note, 'fields'>, nt: NoteType): number[] {
  if (nt.type === 'occlusion') return occlusionImage(note.fields) ? occlusionOrds(note.fields) : [];
  if (nt.type === 'cloze') {
    const clozeFields = new Set<string>();
    for (const t of nt.templates) for (const m of (t.front + t.back).matchAll(/\{\{(?:[^}]*:)?cloze:([^}]+)\}\}/g)) clozeFields.add(m[1].trim());
    if (!clozeFields.size) clozeFields.add(nt.fields[0]);
    const ords = new Set<number>();
    for (const f of clozeFields) clozeOrds(note.fields[f] || '').forEach((o) => ords.add(o));
    return [...ords];
  }
  const ords: number[] = [];
  const fakeNote = { fields: note.fields, tags: [] } as unknown as Note;
  nt.templates.forEach((t, i) => {
    // a card is generated when its front side references at least one non-empty field
    const refs = [...t.front.matchAll(/\{\{(?:[#^/]?)([^}]+)\}\}/g)].map((m) => m[1].split(':').pop()!.trim());
    const hasContent = refs.some((r) => r in note.fields && !isEmptyField(note.fields[r]));
    if (!hasContent) return;
    const r = renderTemplate(t.front, { note: fakeNote, noteType: nt, ord: i }, 'front');
    if (!isEmptyField(r.html.replace(/<div class="typeans-slot"><\/div>/g, ''))) ords.push(i);
  });
  return ords;
}

/* ───────── post-processing for display ───────── */

let mediaIndex: Map<string, string> | null = null;
let mediaVersion = -1;
function mediaMap(): Map<string, string> {
  const list = all('media');
  if (!mediaIndex || mediaVersion !== list.length) {
    mediaIndex = new Map(list.map((m) => [m.name, m.dataUrl]));
    mediaVersion = list.length;
  }
  return mediaIndex;
}

function renderMath(html: string): string {
  const render = (tex: string, display: boolean) => {
    try {
      return katex.renderToString(tex.replace(/<br\s*\/?>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' '), {
        displayMode: display,
        throwOnError: false,
      });
    } catch {
      return escapeHtml(tex);
    }
  };
  return html
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => render(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => render(t, false))
    .replace(/\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (_m, t: string) => render(t, true))
    .replace(/\[\$\]([\s\S]+?)\[\/\$\]/g, (_m, t: string) => render(t, false));
}

/** Turn raw field/template HTML into safe display HTML (media, sounds, maths, sanitising). */
export function toDisplayHtml(html: string): string {
  const media = mediaMap();
  let s = html.replace(/\[sound:([^\]]+)\]/g, (_m, name: string) => {
    const url = media.get(name.trim());
    return url ? `<button class="audio-btn" data-audio="${escapeHtml(name.trim())}" aria-label="Play audio">▶</button>` : '';
  });
  s = renderMath(s);
  s = DOMPurify.sanitize(s, {
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['data-tts', 'data-lang', 'data-audio', 'target'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
  });
  // resolve local media references
  s = s.replace(/(<img[^>]*?\ssrc=")([^"]+)(")/gi, (m, a: string, src: string, b: string) => {
    if (/^(data:|https?:|blob:)/i.test(src)) return m;
    const url = media.get(decodeURIComponent(src));
    return url ? a + url + b : m;
  });
  return s;
}

export function audioUrl(name: string): string | undefined {
  return mediaMap().get(name);
}

/** Scope note-type CSS to the card container so it can't restyle the app. */
export function scopeCss(css: string, scope: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^{}]+)\{/g, (_m, sel: string) => {
      const scoped = sel
        .split(',')
        .map((x) => {
          const t = x.trim();
          if (!t || t.startsWith('@')) return t;
          if (t === '.card' || t === 'body' || t === 'html') return scope;
          return `${scope} ${t.replace(/^\.card\s*/, '').replace(/^(body|html)\s*/, '')}`;
        })
        .join(', ');
      return scoped + ' {';
    });
}
