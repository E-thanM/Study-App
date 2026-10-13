import type { StarterNote } from './starter';
import type { Quote } from './types';

/*
 * Quote learner – pure logic (no store access, so it can be unit-tested):
 *  - extracting the built-in English Literature quotes from the starter content
 *  - progressive cues (first letters, half the words blanked)
 *  - forgiving word-by-word answer checking with a diff for mistakes
 *  - picking the quotes for a practice session
 */

export const STAGES = ['Read', 'First letters', 'Half hidden', 'From memory', 'Mastered'] as const;
export const MASTERED = 4;
/** Mastered quotes come back for a review after this long. */
export const REVIEW_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

export interface BuiltinQuote { id: string; work: string; text: string; source: string }

/* ───────── normalising ───────── */

/** Small stable hash (FNV-1a + a second rolling hash) so every device derives the same id. */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/** One word, compared forgivingly: case, accents, apostrophes, hyphens and punctuation are ignored. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** The words of a quote that have to be typed (dashes, ellipses and "/" line breaks don't count). */
export function quoteWords(text: string): string[] {
  return text.split(/\s+/).map(normWord).filter(Boolean);
}

/** Stable id for a built-in quote: the same quote gets the same record on every device. */
export const quoteId = (work: string, text: string) => `quote-${hashText(normWord(work) + '|' + quoteWords(text).join(' '))}`;

/* ───────── extracting the built-in quotes ───────── */

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ;; ')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[“”]/g, '"');
}

/** "Macbeth – points, quotes and analysis" → "Macbeth" */
export const workFromTopic = (topic: string) => topic.split(/\s+[–-]\s+/)[0].trim();

/**
 * Pull quotes out of the English Literature starter notes. Two reliable shapes are used:
 *  - "points" cards: back starts `Quote: "text" (source)`
 *  - "key quotes" cards: front is `"text" – analyse.` and the back has `Who/where: source`
 * Cards with two quotes glued together ("…" / "…") are skipped. Near-duplicates (the same quote
 * cut slightly differently on two cards) are merged by work + the first five words; the first
 * version found wins, and "points" cards are read first because their sources are tidier.
 */
export function extractQuotes(notes: StarterNote[]): BuiltinQuote[] {
  const out: BuiltinQuote[] = [];
  const seen = new Set<string>();
  const add = (work: string, rawText: string, rawSource: string) => {
    const text = rawText.replace(/\s+/g, ' ').trim();
    const source = rawSource.replace(/\s+/g, ' ').trim();
    const words = quoteWords(text);
    if (words.length < 2 || !work) return;
    const keys = [`${work}|${words.join(' ')}`, `${work}|${words.slice(0, 5).join(' ')}`];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ id: quoteId(work, text), work, text, source: source.charAt(0).toUpperCase() + source.slice(1) });
  };
  const points = notes.filter((n) => /points, quotes/i.test(n.topic));
  const keyQuotes = notes.filter((n) => /key quotes/i.test(n.topic));
  for (const n of points) {
    const m = /^\s*Quote:\s*"([^"]+)"\s*\(([^)]+)\)/.exec(htmlToPlain(n.back));
    if (m) add(workFromTopic(n.topic), m[1], m[2]);
  }
  for (const n of keyQuotes) {
    const f = /^\s*"([^"]+)"\s+[–-]\s/.exec(htmlToPlain(n.front));
    const s = /Who\/where:\s*(.+?)\s*(?:;;|$)/.exec(htmlToPlain(n.back));
    if (!s) continue;
    // "Macbeth (soliloquy), Act 1 Scene 7" → "Macbeth, Act 1 Scene 7"; drop notes after the act/chapter
    const src = s[1].replace(/\s*\([^)]*\)/g, '').replace(/^(.*?\b(?:Act \d+(?: Scene \d+)?|Chapter \d+)).*$/, '$1');
    if (f) add(workFromTopic(n.topic), f[1], src);
  }
  return out;
}

/* ───────── cues ───────── */

export interface CuePart {
  /** leading punctuation, e.g. an opening bracket */
  pre: string;
  word: string;
  /** trailing punctuation, e.g. "," or ";" */
  post: string;
  show: 'full' | 'initial' | 'blank';
}

/** Deterministic pseudo-random numbers so a cue doesn't reshuffle on every render. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Split a quote into display parts for a stage:
 *  0 → every word in full, 1 → first letter of each word, 2 → about half the words blanked,
 *  3+ → nothing shown (the page prompts with the source only).
 * Punctuation-only chunks ("–", "/", "…") are always shown.
 */
export function cueParts(text: string, stage: number, seed = 1): CuePart[] {
  const parts: CuePart[] = text.split(/\s+/).filter(Boolean).map((chunk) => {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(chunk)!;
    return m[2] ? { pre: m[1], word: m[2], post: m[3], show: 'full' as const } : { pre: chunk, word: '', post: '', show: 'full' as const };
  });
  const wordIdx = parts.map((p, i) => (p.word ? i : -1)).filter((i) => i >= 0);
  if (stage === 1) wordIdx.forEach((i) => (parts[i].show = 'initial'));
  if (stage === 2) {
    const rand = seeded(seed);
    const order = wordIdx.map((i) => ({ i, r: rand() })).sort((a, b) => a.r - b.r);
    order.slice(0, Math.ceil(wordIdx.length / 2)).forEach(({ i }) => (parts[i].show = 'blank'));
  }
  if (stage >= 3) wordIdx.forEach((i) => (parts[i].show = 'blank'));
  return parts;
}

/** Plain-text version of a cue (used by tests and screen readers): "F i f, a f i f". */
export function cueText(parts: CuePart[]): string {
  return parts
    .map((p) => p.pre + (p.show === 'full' ? p.word : p.show === 'initial' ? p.word.charAt(0) : '_'.repeat(Math.max(2, Math.min(p.word.length, 8)))) + p.post)
    .join(' ');
}

/* ───────── checking ───────── */

export interface DiffItem {
  /** ok = right word; missed = left out; wrong = a different word typed instead; extra = typed but not in the quote */
  kind: 'ok' | 'missed' | 'wrong' | 'extra';
  /** the quote's word as written (or the typed word for "extra") */
  word: string;
  /** what was typed instead, for "wrong" */
  typed?: string;
}

export interface CheckResult { ok: boolean; diff: DiffItem[]; mistakes: number }

/**
 * Every word must be right, but case, curly/straight quotes, apostrophes, punctuation and spacing
 * don't matter. As a last resort the letters are compared with all spaces removed, so
 * "fiend like" matches "fiend-like".
 */
export function checkQuote(given: string, expected: string): CheckResult {
  const exp = expected.split(/\s+/).filter((w) => normWord(w)).map((w) => ({ show: w, n: normWord(w) }));
  const got = given.split(/\s+/).filter((w) => normWord(w)).map((w) => ({ show: w, n: normWord(w) }));
  const same = exp.length === got.length && exp.every((e, i) => e.n === got[i].n);
  if (same || (got.length && exp.map((e) => e.n).join('') === got.map((g) => g.n).join(''))) {
    return { ok: true, diff: exp.map((e) => ({ kind: 'ok', word: e.show })), mistakes: 0 };
  }
  // longest common subsequence of words, then walk it back into a diff
  const m = exp.length, n = got.length;
  const L: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) L[i][j] = exp[i].n === got[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const raw: DiffItem[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && exp[i].n === got[j].n) { raw.push({ kind: 'ok', word: exp[i].show }); i++; j++; }
    else if (j < n && (i >= m || L[i][j + 1] > L[i + 1][j])) { raw.push({ kind: 'extra', word: got[j].show }); j++; }
    else { raw.push({ kind: 'missed', word: exp[i].show }); i++; }
  }
  // a run of missed words next to a run of extra words = words typed wrongly; pair them up
  const diff: DiffItem[] = [];
  for (let k = 0; k < raw.length; ) {
    if (raw[k].kind === 'ok') { diff.push(raw[k++]); continue; }
    const missed: DiffItem[] = [], extra: DiffItem[] = [];
    while (k < raw.length && raw[k].kind !== 'ok') (raw[k].kind === 'missed' ? missed : extra).push(raw[k++]);
    const pairs = Math.min(missed.length, extra.length);
    for (let p = 0; p < pairs; p++) diff.push({ kind: 'wrong', word: missed[p].word, typed: extra[p].word });
    missed.slice(pairs).forEach((d) => diff.push(d));
    extra.slice(pairs).forEach((d) => diff.push(d));
  }
  return { ok: false, diff, mistakes: diff.filter((d) => d.kind !== 'ok').length };
}

/* ───────── stages and sessions ───────── */

/** Stage after an attempt: right → up one (max mastered), wrong → down one. */
export function nextStage(stage: number, ok: boolean): number {
  return ok ? Math.min(MASTERED, stage + 1) : Math.max(0, stage - 1);
}

export const isDue = (q: Pick<Quote, 'stage' | 'last'>, now = Date.now()) =>
  q.stage >= MASTERED && (!q.last || now - q.last >= REVIEW_AFTER_DAYS * DAY_MS);

export type Status = 'new' | 'learning' | 'mastered';
export const statusOf = (q: Pick<Quote, 'stage' | 'correct' | 'wrong'> | undefined): Status =>
  !q || (q.stage === 0 && !q.correct && !q.wrong) ? 'new' : q.stage >= MASTERED ? 'mastered' : 'learning';

export interface Candidate { id: string; stage: number; last?: number; isNew: boolean }

/**
 * Choose up to `size` quotes for a session: quotes being learnt (weakest first), up to `maxNew`
 * new ones in their natural order, and mastered quotes that are due a review; then top up with
 * whatever is left. The result is interleaved so new quotes are spread out.
 */
export function pickSession(cands: Candidate[], size = 10, now = Date.now(), maxNew = 4): string[] {
  const learning = cands.filter((c) => !c.isNew && c.stage < MASTERED).sort((a, b) => a.stage - b.stage || (a.last || 0) - (b.last || 0));
  const fresh = cands.filter((c) => c.isNew);
  const due = cands.filter((c) => !c.isNew && isDue(c, now)).sort((a, b) => (a.last || 0) - (b.last || 0));
  const rest = cands.filter((c) => !c.isNew && c.stage >= MASTERED && !isDue(c, now)).sort((a, b) => (a.last || 0) - (b.last || 0));
  const picked: Candidate[] = [];
  const take = (list: Candidate[], n: number) => {
    for (const c of list) {
      if (picked.length >= size || n <= 0) break;
      if (!picked.includes(c)) { picked.push(c); n--; }
    }
  };
  take(due, 2);
  // a big backlog of half-learnt quotes means fewer new ones
  take(fresh, learning.length >= size ? Math.min(2, maxNew) : maxNew);
  take(learning, size);
  take(fresh, size);
  take(due, size);
  take(rest, size);
  // interleave: known quotes first in each pair, new ones between them
  const olds = picked.filter((c) => !c.isNew), news = picked.filter((c) => c.isNew);
  const out: string[] = [];
  while (olds.length || news.length) {
    if (olds.length) out.push(olds.shift()!.id);
    if (news.length) out.push(news.shift()!.id);
  }
  return out;
}
