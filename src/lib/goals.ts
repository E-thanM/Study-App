import { useMemo } from 'react';
import { all, get, patch, put, useVersion } from './store';
import { CardState, type Blurt, type Deck, type PastPaper, type Quote, type RevLog, type Session, type SessionGoal, type StudyLog, type StudySet } from './types';
import { HOUR, MIN, addDays, getDayStartHour, isoDate, levenshtein, minToTime, parseIso, timeToMin, uid, weekdayMon } from './util';

/*
 * Session goals ("review 60 Biology cards", "learn 20 new cards", …), automatic progress,
 * subject → deck matching, goal suggestions and the self-fixing timetable (missed sessions
 * and rescheduling). Everything above the "store-backed" section is pure and unit-tested.
 */

/* ───────────── subjects ───────────── */

/** lower-case, "&" → "and", punctuation stripped, single spaces */
export function normSubject(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(gcse|igcse|a level|aqa|ocr|edexcel|eduqas|wjec|triple|separate|higher|foundation)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** canonical subject → normalised aliases (the canonical name itself is always an alias) */
const SUBJECT_ALIASES: Record<string, string[]> = {
  biology: ['bio', 'biol', 'bilogy', 'biolgy'],
  chemistry: ['chem', 'chemisty', 'chemestry'],
  physics: ['phys', 'physic', 'phy'],
  'combined science': ['science', 'sci', 'combined sci', 'trilogy', 'combined'],
  'computer science': ['cs', 'compsci', 'comp sci', 'comp science', 'computing', 'computer sci', 'comsci', 'computer', 'computers'],
  'english literature': ['eng lit', 'english lit', 'englit', 'lit', 'literature', 'eng literature', 'el'],
  'english language': ['eng lang', 'english lang', 'englang', 'language', 'eng language'],
  'design and technology': ['dt', 'd and t', 'dandt', 'd t', 'design technology', 'design tech', 'design', 'technology', 'product design', 'dnt'],
  mathematics: ['maths', 'math', 'mathematics', 'mats'],
  'further mathematics': ['further maths', 'further math', 'fm', 'add maths', 'additional maths'],
  german: ['deutsch', 'ger', 'germ'],
  french: ['fr', 'francais', 'fren'],
  spanish: ['sp', 'span', 'espanol'],
  history: ['hist', 'histroy'],
  geography: ['geog', 'geo', 'goegraphy'],
  'religious studies': ['rs', 're', 'religious education', 'religion', 'rps'],
  'business studies': ['business', 'bus'],
  economics: ['econ', 'eco'],
  psychology: ['psych', 'psy'],
  sociology: ['soc', 'socio'],
  art: ['art and design', 'fine art'],
  music: ['mus'],
  drama: ['theatre'],
  'physical education': ['pe', 'sport', 'sports science'],
  latin: ['lat'],
  statistics: ['stats'],
};

const ALIAS_TO_CANON = (() => {
  const m = new Map<string, string>();
  for (const [canon, aliases] of Object.entries(SUBJECT_ALIASES)) {
    m.set(canon, canon);
    for (const a of aliases) if (!m.has(a)) m.set(a, canon);
  }
  return m;
})();

/** Canonical subject name ("Eng Lit" → "english literature"), or the normalised text if unknown. */
export function canonicalSubject(s: string): string {
  const n = normSubject(s);
  if (!n) return '';
  const direct = ALIAS_TO_CANON.get(n);
  if (direct) return direct;
  const nospace = n.replace(/ /g, '');
  for (const [alias, canon] of ALIAS_TO_CANON) if (alias.replace(/ /g, '') === nospace) return canon;
  // "Biology – cells", "Maths paper 2": first word(s) decide
  const words = n.split(' ');
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const head = words.slice(0, k).join(' ');
    const hit = ALIAS_TO_CANON.get(head);
    if (hit && head.length >= 2) return hit;
  }
  // small typos on the full name ("Chemestry", "Geograpy")
  if (n.length >= 5) {
    let best = '', bestD = Infinity;
    for (const canon of Object.keys(SUBJECT_ALIASES)) {
      const d = levenshtein(n, canon);
      if (d < bestD) { bestD = d; best = canon; }
    }
    if (bestD <= (n.length >= 9 ? 2 : 1)) return best;
  }
  return n;
}

/** How well a deck name matches a timetable subject: 0 = no match, higher is better. */
export function subjectScore(subject: string, name: string): number {
  const a = normSubject(subject), b = normSubject(name);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ca = canonicalSubject(subject), cb = canonicalSubject(name);
  if (ca && ca === cb) return 90;
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return 88;
  // initials: "CS" ~ "Computer Science"
  const initials = b.split(' ').filter((w) => w !== 'and').map((w) => w[0]).join('');
  if (a.replace(/ /g, '').length >= 2 && initials.length >= 2 && a.replace(/ /g, '') === initials) return 70;
  // prefix: "Bio" ~ "Biology", "English" ~ "English Literature"
  if (a.length >= 3 && (b.startsWith(a) || b.split(' ').some((w) => w.startsWith(a)))) return 60 - Math.min(20, b.length - a.length);
  if (b.length >= 3 && a.startsWith(b + ' ')) return 55;
  if (a.length >= 5 && levenshtein(a, b) <= 2) return 50;
  return 0;
}

/** Same subject? Used for papers and blurts logged with free-text subjects. */
export function sameSubject(a: string, b: string): boolean {
  if (!normSubject(a) || !normSubject(b)) return false;
  return subjectScore(a, b) >= 50 || subjectScore(b, a) >= 50;
}

type DeckLite = Pick<Deck, 'id' | 'name' | 'parentId'> & { filtered?: unknown; deleted?: boolean };

/**
 * The deck that best matches a timetable subject. Root decks win over subdecks with the same score
 * (so "Biology" picks the "Biology" root, not "Chemistry::Biology links"). Filtered decks are skipped.
 */
export function matchDeck<D extends DeckLite>(subject: string, decks: D[]): D | undefined {
  let best: D | undefined, bestScore = 0;
  for (const d of decks) {
    if (d.deleted || d.filtered) continue;
    let sc = subjectScore(subject, d.name);
    if (!sc) continue;
    if (!d.parentId) sc += 5;
    if (sc > bestScore) { best = d; bestScore = sc; }
  }
  return best;
}

/** deck id plus all its descendants */
export function deckSubtree(deckId: string, decks: DeckLite[]): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const d of decks) if (d.parentId) byParent.set(d.parentId, [...(byParent.get(d.parentId) || []), d.id]);
  const out = [deckId];
  for (let i = 0; i < out.length; i++) out.push(...(byParent.get(out[i]) || []));
  return new Set(out);
}

/** Quick Learn sets that belong to a subject (folder or title matches), least recently studied first. */
export function setsForSubject<S extends Pick<StudySet, 'id' | 'title' | 'folder' | 'createdAt' | 'lastStudied'>>(subject: string, sets: S[]): S[] {
  if (!normSubject(subject)) return [];
  return sets
    .filter((s) => (s.folder && sameSubject(subject, s.folder.split('::')[0])) || subjectScore(subject, s.title) >= 60)
    .sort((a, b) => (a.lastStudied || 0) - (b.lastStudied || 0) || a.createdAt - b.createdAt);
}

/* ───────────── days ───────────── */

/** The study day (YYYY-MM-DD) a timestamp belongs to – days roll over at dayStartHour, like stats. */
export function studyDayIso(ts: number, dayStartHour = getDayStartHour()): string {
  return isoDate(new Date(ts - dayStartHour * HOUR));
}

export const studyToday = (now = Date.now(), dayStartHour = getDayStartHour()) => studyDayIso(now, dayStartHour);

/* ───────────── progress ───────────── */

export interface GoalData {
  revlogs: Pick<RevLog, 'deckId' | 'review' | 'state'>[];
  decks: DeckLite[];
  studylogs: Pick<StudyLog, 'source' | 'start' | 'ms' | 'refId'>[];
  papers: Pick<PastPaper, 'subject' | 'date'>[];
  blurts: Pick<Blurt, 'subject' | 'date'>[];
  quotes: Pick<Quote, 'history'>[];
  dayStartHour: number;
}

interface DayBucket {
  rev: Map<string, number>; // deckId → answers
  neu: Map<string, number>; // deckId → new cards learnt
  setMs: Map<string, number>; // set id → ms studied
  papers: string[]; // subjects
  blurts: string[];
  quotes: number;
}

/** Everything goals need, bucketed by study day so each lookup is cheap. */
export interface GoalIndex {
  decks: DeckLite[];
  days: Map<string, DayBucket>;
  subtree: (deckId: string) => Set<string>;
}

export function buildGoalIndex(data: GoalData): GoalIndex {
  const days = new Map<string, DayBucket>();
  const bucket = (iso: string) => {
    let b = days.get(iso);
    if (!b) days.set(iso, (b = { rev: new Map(), neu: new Map(), setMs: new Map(), papers: [], blurts: [], quotes: 0 }));
    return b;
  };
  const h = data.dayStartHour;
  for (const r of data.revlogs) {
    const b = bucket(studyDayIso(r.review, h));
    b.rev.set(r.deckId, (b.rev.get(r.deckId) || 0) + 1);
    if (r.state === CardState.New) b.neu.set(r.deckId, (b.neu.get(r.deckId) || 0) + 1);
  }
  for (const s of data.studylogs) {
    if (s.source !== 'set' || !s.refId) continue;
    const b = bucket(studyDayIso(s.start, h));
    b.setMs.set(s.refId, (b.setMs.get(s.refId) || 0) + s.ms);
  }
  for (const p of data.papers) if (p.date) bucket(p.date.slice(0, 10)).papers.push(p.subject || '');
  for (const bl of data.blurts) if (bl.date) bucket(studyDayIso(bl.date, h)).blurts.push(bl.subject || '');
  for (const q of data.quotes) for (const [iso, n] of Object.entries(q.history || {})) if (n > 0) bucket(iso).quotes += n;
  const cache = new Map<string, Set<string>>();
  const subtree = (id: string) => {
    let s = cache.get(id);
    if (!s) cache.set(id, (s = deckSubtree(id, data.decks)));
    return s;
  };
  return { decks: data.decks, days, subtree };
}

export interface GoalProgress {
  done: number;
  target: number;
  met: boolean;
  /** 0…1 for the bar */
  frac: number;
}

/** The deck a review/new goal counts: its own deck, else the deck matching the session subject. */
export function goalDeckId(goal: SessionGoal, subject: string, decks: DeckLite[]): string | undefined {
  if (goal.deckId && decks.some((d) => d.id === goal.deckId && !d.deleted)) return goal.deckId;
  return matchDeck(subject, decks)?.id;
}

export function goalTarget(goal: SessionGoal): number {
  if (goal.type === 'custom') return 1;
  return Math.max(1, Math.round(goal.target || 0) || 1);
}

export function goalProgress(goal: SessionGoal, session: Pick<Session, 'subject' | 'log'>, iso: string, idx: GoalIndex): GoalProgress {
  const target = goalTarget(goal);
  const b = idx.days.get(iso);
  let done = 0;
  switch (goal.type) {
    case 'review':
    case 'new': {
      const deckId = goalDeckId(goal, session.subject, idx.decks);
      if (b && deckId) {
        const m = goal.type === 'review' ? b.rev : b.neu;
        for (const id of idx.subtree(deckId)) done += m.get(id) || 0;
      }
      break;
    }
    case 'set':
      // target is minutes of Quick Learn study on that set
      done = b && goal.setId ? Math.floor((b.setMs.get(goal.setId) || 0) / MIN) : 0;
      break;
    case 'paper':
      done = b ? b.papers.filter((s) => !normSubject(session.subject) || !normSubject(s) || sameSubject(s, session.subject)).length : 0;
      break;
    case 'blurt':
      done = b ? b.blurts.filter((s) => !normSubject(session.subject) || !normSubject(s) || sameSubject(s, session.subject)).length : 0;
      break;
    case 'quotes':
      done = b ? b.quotes : 0;
      break;
    case 'custom':
      done = session.log?.[iso]?.goalsDone?.includes(goal.id) ? 1 : 0;
      break;
  }
  return { done, target, met: done >= target, frac: Math.min(1, done / target) };
}

export function occurrenceProgress(session: Pick<Session, 'subject' | 'log' | 'goals'>, iso: string, idx: GoalIndex) {
  const goals = session.goals || [];
  const list = goals.map((g) => ({ goal: g, p: goalProgress(g, session, iso, idx) }));
  const met = list.filter((x) => x.p.met).length;
  return { list, met, total: list.length, allMet: list.length > 0 && met === list.length };
}

/* ───────────── labels & links ───────────── */

export const GOAL_TYPES: { type: SessionGoal['type']; label: string; unit: string }[] = [
  { type: 'review', label: 'Review flashcards', unit: 'cards' },
  { type: 'new', label: 'Learn new cards', unit: 'new' },
  { type: 'set', label: 'Quick Learn set', unit: 'min' },
  { type: 'paper', label: 'Past paper', unit: 'paper' },
  { type: 'blurt', label: 'Blurt a topic', unit: 'blurt' },
  { type: 'quotes', label: 'Practise quotes', unit: 'quotes' },
  { type: 'custom', label: 'Checklist item', unit: '' },
];

export function goalLabel(goal: SessionGoal, names: { deck?: string; set?: string }): string {
  const t = goalTarget(goal);
  switch (goal.type) {
    case 'review': return `Review ${t} ${names.deck ? names.deck + ' ' : ''}card${t === 1 ? '' : 's'}`;
    case 'new': return `Learn ${t} new ${names.deck ? names.deck + ' ' : ''}card${t === 1 ? '' : 's'}`;
    case 'set': return `${names.set ? names.set : 'Quick Learn set'} · ${t} min`;
    case 'paper': return t === 1 ? 'Do a past paper' : `Do ${t} past papers`;
    case 'blurt': return t === 1 ? 'Blurt a topic' : `Blurt ${t} topics`;
    case 'quotes': return `Practise ${t} quote${t === 1 ? '' : 's'}`;
    case 'custom': return goal.text?.trim() || 'Checklist item';
  }
}

/** In-app route for a goal's "Go" link (hash router path). */
export function goalRoute(goal: SessionGoal, deckId: string | undefined): string | null {
  switch (goal.type) {
    case 'review':
    case 'new': return deckId ? `/cards/review/${deckId}` : '/cards';
    case 'set': return goal.setId ? `/quick/${goal.setId}` : '/quick';
    case 'paper': return '/tools/papers';
    case 'blurt': return '/tools/blurt';
    case 'quotes': return '/tools/quotes';
    default: return null;
  }
}

/* ───────────── suggestions ───────────── */

export const SECONDS_PER_REVIEW = 8;
/** a new card takes several answers (learning steps) – ~40s all in */
export const SECONDS_PER_NEW = 40;

export interface SuggestInput {
  subject: string;
  topic?: string;
  minutes: number;
  deckId?: string;
  /** cards due now in the deck subtree (reviews + learning) */
  due: number;
  /** new cards available today */
  newAvailable: number;
  /** matching Quick Learn sets, best first */
  sets: { id: string; title: string }[];
  /** the student has quotes saved */
  hasQuotes?: boolean;
}

const roundTo = (n: number, step: number) => (n >= step * 2 ? Math.floor(n / step) * step : n);

/** Sensible goals from what's actually due, sized to the session length. */
export function suggestGoals(inp: SuggestInput): SessionGoal[] {
  const out: SessionGoal[] = [];
  const topic = normSubject(inp.topic || '');
  let secs = Math.max(10, inp.minutes) * 60;
  const wantsPaper = /\b(past paper|paper|exam questions?|timed)\b/.test(topic);
  const wantsBlurt = /\b(blurt|topic review|recall)\b/.test(topic);
  const wantsQuotes = !!inp.hasQuotes && (canonicalSubject(inp.subject) === 'english literature' || /\bquotes?\b/.test(topic));

  // reserve time for the non-flashcard parts first
  if (wantsPaper && inp.minutes >= 30) { out.push({ id: uid(), type: 'paper', target: 1 }); secs -= Math.min(secs / 2, 25 * 60); }
  if (wantsBlurt) { out.push({ id: uid(), type: 'blurt', target: 1 }); secs -= 10 * 60; }
  if (wantsQuotes) { out.push({ id: uid(), type: 'quotes', target: 10 }); secs -= 8 * 60; }
  const set = inp.sets[0];
  if (set && inp.minutes >= 25 && secs > 15 * 60) { out.push({ id: uid(), type: 'set', target: 10, setId: set.id }); secs -= 10 * 60; }
  secs = Math.max(0, secs);

  if (inp.deckId) {
    const cards: SessionGoal[] = [];
    const rev = Math.min(inp.due, Math.floor(secs / SECONDS_PER_REVIEW));
    if (rev > 0) { cards.push({ id: uid(), type: 'review', target: roundTo(rev, 5), deckId: inp.deckId }); secs -= rev * SECONDS_PER_REVIEW; }
    const neu = Math.min(inp.newAvailable, 20, Math.floor(secs / SECONDS_PER_NEW));
    if (neu >= 3) cards.push({ id: uid(), type: 'new', target: roundTo(neu, 5), deckId: inp.deckId });
    out.unshift(...cards);
  } else if (set && !out.some((g) => g.type === 'set')) {
    out.push({ id: uid(), type: 'set', target: Math.min(20, Math.max(5, Math.round(inp.minutes / 3))), setId: set.id });
  }
  if (!out.length && inp.topic?.trim()) out.push({ id: uid(), type: 'custom', target: 1, text: inp.topic.trim() });
  return out;
}

/* ───────────── missed sessions & rescheduling ───────────── */

/** log[date].moved value used for "dismissed – skip it" (no reschedule). */
export const SKIPPED = 'skipped';

export const isMoved = (s: Pick<Session, 'log'>, iso: string) => !!s.log?.[iso]?.moved && s.log[iso].moved !== SKIPPED;
export const isSkipped = (s: Pick<Session, 'log'>, iso: string) => s.log?.[iso]?.moved === SKIPPED;

type SessLite = Pick<Session, 'id' | 'date' | 'weekday' | 'start' | 'end' | 'log' | 'subject' | 'topic'> & { timetableId?: string };

export const occursOn = (s: Pick<Session, 'date' | 'weekday'>, iso: string) =>
  s.date ? s.date === iso : s.weekday === weekdayMon(parseIso(iso));

export interface Missed<S> { session: S; iso: string }

/**
 * Past occurrences (the last `days` study days, not today) that weren't ticked, moved or dismissed.
 * `since` (YYYY-MM-DD) ignores anything before the timetable existed.
 */
export function findMissed<S extends SessLite>(sessions: S[], today: string, opts: { days?: number; since?: string } = {}): Missed<S>[] {
  const out: Missed<S>[] = [];
  const t = parseIso(today);
  for (let i = opts.days ?? 7; i >= 1; i--) {
    const iso = isoDate(addDays(t, -i));
    if (opts.since && iso < opts.since) continue;
    for (const s of sessions) {
      if (!occursOn(s, iso)) continue;
      const e = s.log?.[iso];
      if (e?.done || e?.moved) continue;
      out.push({ session: s, iso });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || timeToMin(a.session.start) - timeToMin(b.session.start));
}

export interface Slot { iso: string; start: string; end: string }

export interface PlanOpts {
  /** days to look ahead, starting today */
  horizon?: number;
  /** latest end time, minutes after midnight (default 21:30) */
  latestEnd?: number;
  /** start time on a day with nothing planned (default 16:00) */
  defaultStart?: number;
  /** minutes after midnight now – today's slots must start after it */
  nowMin?: number;
  /** gap after the previous session, minutes */
  gap?: number;
  /** at most this many rescheduled sessions added per day */
  perDay?: number;
}

const roundUp = (m: number, step: number) => Math.ceil(m / step) * step;

/**
 * Next free slot for each missed occurrence, after the last session of a day and before ~21:30.
 * Days that already have study sessions are preferred (e.g. Friday stays free when it's a day off);
 * a day without sessions is only used when no study day in the horizon has room.
 */
export function planReschedule<S extends SessLite>(missed: Missed<S>[], sessions: SessLite[], today: string, opts: PlanOpts = {}): (Missed<S> & { slot: Slot })[] {
  const horizon = opts.horizon ?? 7;
  const latestEnd = opts.latestEnd ?? 21 * 60 + 30;
  const defaultStart = opts.defaultStart ?? 16 * 60;
  const gap = opts.gap ?? 0;
  const perDay = opts.perDay ?? 2;
  const t = parseIso(today);
  const days = Array.from({ length: horizon }, (_, i) => isoDate(addDays(t, i)));
  // occupied intervals per day: existing occurrences (not moved away) + what we add
  const busy = new Map<string, [number, number][]>();
  const added = new Map<string, number>();
  for (const iso of days) {
    busy.set(iso, sessions.filter((s) => occursOn(s, iso) && !s.log?.[iso]?.moved).map((s) => [timeToMin(s.start), timeToMin(s.end)] as [number, number]));
  }
  const weekdaysWithStudy = new Set<number>();
  for (const s of sessions) {
    if (s.weekday != null) weekdaysWithStudy.add(s.weekday);
    else if (s.date) weekdaysWithStudy.add(weekdayMon(parseIso(s.date)));
  }
  const isStudyDay = (iso: string) => (busy.get(iso)?.length || 0) > 0 || weekdaysWithStudy.has(weekdayMon(parseIso(iso)));

  const slotOn = (iso: string, dur: number): Slot | null => {
    if ((added.get(iso) || 0) >= perDay) return null;
    const list = busy.get(iso)!;
    let start = list.length ? Math.max(...list.map((x) => x[1])) + gap : defaultStart;
    if (iso === today && opts.nowMin != null) start = Math.max(start, roundUp(opts.nowMin + 10, 15));
    if (start + dur > latestEnd) return null;
    return { iso, start: minToTime(start), end: minToTime(start + dur) };
  };

  const out: (Missed<S> & { slot: Slot })[] = [];
  for (const m of missed) {
    const dur = Math.max(15, timeToMin(m.session.end) - timeToMin(m.session.start));
    let slot: Slot | null = null;
    for (const pass of [0, 1]) {
      for (const iso of days) {
        if (pass === 0 && !isStudyDay(iso)) continue;
        slot = slotOn(iso, dur);
        if (slot) break;
      }
      if (slot) break;
    }
    if (!slot) continue;
    busy.get(slot.iso)!.push([timeToMin(slot.start), timeToMin(slot.end)]);
    added.set(slot.iso, (added.get(slot.iso) || 0) + 1);
    out.push({ ...m, slot });
  }
  return out;
}

/** "Tue 14:00" */
export function fmtSlot(iso: string, start?: string): string {
  const d = parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short' });
  return start ? `${d} ${start}` : d;
}

/* ───────────── store-backed helpers ───────────── */

export function goalIndexFromStore(): GoalIndex {
  return buildGoalIndex({
    revlogs: all('revlog'),
    decks: all('deck'),
    studylogs: all('studylog'),
    papers: all('paper'),
    blurts: all('blurt'),
    quotes: all('quote'),
    dayStartHour: getDayStartHour(),
  });
}

/** Re-computed whenever reviews, study time, papers, blurts, quotes or decks change. */
export function useGoalIndex(): GoalIndex {
  const v = useVersion('revlog', 'studylog', 'paper', 'blurt', 'quote', 'deck', 'settings');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => goalIndexFromStore(), [v]);
}

export function toggleGoalDone(s: Session, iso: string, goalId: string, on: boolean) {
  const cur = get('session', s.id) || s;
  const prev = cur.log?.[iso]?.goalsDone || [];
  const goalsDone = on ? [...new Set([...prev, goalId])] : prev.filter((x) => x !== goalId);
  patch('session', s.id, { log: { ...cur.log, [iso]: { ...cur.log?.[iso], goalsDone } } });
}

const AUTO_KEY = 'study.goalsAutoDone';
function autoSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(AUTO_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Tick occurrences whose goals are all met. Each occurrence is auto-ticked once (remembered on this
 * device), so a student who unticks it again keeps it unticked. Returns how many were ticked.
 */
export function autoCompleteGoals(occ: { session: Session; iso: string }[], idx: GoalIndex): number {
  const seen = autoSeen();
  const changed: Session[] = [];
  const byId = new Map<string, Session>();
  for (const { session, iso } of occ) {
    if (!session.goals?.length) continue;
    const k = `${session.id}:${iso}`;
    const s = byId.get(session.id) || session;
    if (seen.has(k) || s.log?.[iso]?.done || s.log?.[iso]?.moved) continue;
    if (!occurrenceProgress(s, iso, idx).allMet) continue;
    seen.add(k);
    const next = { ...s, log: { ...s.log, [iso]: { ...s.log?.[iso], done: true } } };
    byId.set(s.id, next);
  }
  changed.push(...byId.values());
  if (changed.length) {
    put(changed);
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify([...seen].slice(-500)));
    } catch {
      /* ignore */
    }
  }
  return changed.length;
}

/** Suggest goals for a session from the live collection. */
export function suggestFromStore(
  s: Pick<Session, 'subject' | 'topic' | 'start' | 'end'>,
  deckId: string | undefined,
  counts: (deckId: string) => { new: number; learn: number; review: number },
): SessionGoal[] {
  const c = deckId ? counts(deckId) : { new: 0, learn: 0, review: 0 };
  return suggestGoals({
    subject: s.subject,
    topic: s.topic,
    minutes: Math.max(15, timeToMin(s.end) - timeToMin(s.start)),
    deckId,
    due: c.review + c.learn,
    newAvailable: c.new,
    sets: setsForSubject(s.subject, all('set')),
    hasQuotes: all('quote').length > 0,
  });
}

/** Move a missed occurrence: add a one-off copy at the slot and mark the original as moved. */
export function applyMove(s: Session, fromIso: string, slot: Slot) {
  const cur = get('session', s.id) || s;
  const copy: Session = {
    id: uid(), kind: 'session', updatedAt: 0, timetableId: cur.timetableId,
    date: slot.iso, weekday: null, start: slot.start, end: slot.end,
    subject: cur.subject, topic: cur.topic, notes: cur.notes, log: {},
    goals: cur.goals?.map((g) => ({ ...g, id: uid() })),
  };
  put([copy, { ...cur, log: { ...cur.log, [fromIso]: { ...cur.log?.[fromIso], moved: slot.iso } } }]);
  return copy;
}

export function skipOccurrence(s: Session, iso: string) {
  const cur = get('session', s.id) || s;
  patch('session', s.id, { log: { ...cur.log, [iso]: { ...cur.log?.[iso], moved: SKIPPED } } });
}

/** Undo a move/skip: un-marks the original (the copy, if any, is left for the student to delete). */
export function unmoveOccurrence(s: Session, iso: string) {
  const cur = get('session', s.id) || s;
  const e = { ...cur.log?.[iso] };
  delete e.moved;
  patch('session', s.id, { log: { ...cur.log, [iso]: e } });
}

/** The one-off session an occurrence was moved to (same subject/topic on that date). */
export function movedTarget(s: Session, iso: string, sessions: Session[]): Session | undefined {
  const to = s.log?.[iso]?.moved;
  if (!to || to === SKIPPED) return undefined;
  return sessions.find((x) => x.id !== s.id && x.date === to && x.timetableId === s.timetableId && x.subject === s.subject && x.topic === s.topic);
}

export const nowMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes();
