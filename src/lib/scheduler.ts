import { fsrs, generatorParameters, type Card as FCard, type Grade, type StepUnit, State } from 'ts-fsrs';
import { CardState, type Card, type Preset } from './types';
import { DAY, MIN, dayEnd, dayNumber } from './util';

/*
 * Two schedulers, as in Anki:
 *  - FSRS (default in modern Anki): ts-fsrs, with Anki-style learning/relearning steps.
 *  - SM-2 (Anki's legacy v3 scheduler): implemented below to match Anki's maths.
 */

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface ScheduleResult {
  card: Card;
  /** delay until due, in ms (for button labels) */
  delayMs: number;
  /** Anki revlog interval: days if >= 1 day, negative seconds otherwise */
  interval: number;
}

export function parseStep(s: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/i.exec(s);
  if (!m) return NaN;
  const n = Number(m[1]);
  switch ((m[2] || 'm').toLowerCase()) {
    case 's': return n / 60;
    case 'h': return n * 60;
    case 'd': return n * 1440;
    default: return n;
  }
}

export const validSteps = (steps: string[]) => steps.every((s) => Number.isFinite(parseStep(s)) && parseStep(s) > 0);

const toStepUnit = (s: string): StepUnit => `${parseStep(s)}m` as StepUnit;

/* ───────────── FSRS ───────────── */

const fsrsCache = new Map<string, ReturnType<typeof fsrs>>();
function fsrsFor(p: Preset) {
  const k = JSON.stringify([p.desiredRetention, p.maxInterval, p.learningSteps, p.relearningSteps, p.fsrsWeights]);
  let f = fsrsCache.get(k);
  if (!f) {
    f = fsrs(
      generatorParameters({
        request_retention: p.desiredRetention,
        maximum_interval: p.maxInterval,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: p.learningSteps.filter((s) => parseStep(s) > 0).map(toStepUnit),
        relearning_steps: p.relearningSteps.filter((s) => parseStep(s) > 0).map(toStepUnit),
        ...(p.fsrsWeights?.length ? { w: p.fsrsWeights } : {}),
      }),
    );
    fsrsCache.set(k, f);
  }
  return f;
}

function toF(c: Card): FCard {
  let stability = c.stability;
  let difficulty = c.difficulty;
  // Cards scheduled by SM-2 or imported from Anki without memory state:
  // seed FSRS from the current interval so nothing is lost when switching.
  if (c.state !== CardState.New && !(stability > 0)) {
    stability = Math.max(c.scheduledDays, 0.5);
    difficulty = c.ease ? Math.min(10, Math.max(1, 11 - (c.ease - 1.3) * 5)) : 5;
  }
  return {
    due: new Date(c.due),
    stability,
    difficulty,
    elapsed_days: 0,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningStep,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as unknown as State,
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  };
}

function scheduleFsrs(c: Card, p: Preset, rating: Rating, now: number): ScheduleResult {
  const { card: f } = fsrsFor(p).next(toF(c), new Date(now), rating as Grade);
  const due = f.due.getTime();
  return {
    card: {
      ...c,
      state: f.state as unknown as CardState,
      due,
      stability: f.stability,
      difficulty: f.difficulty,
      scheduledDays: f.scheduled_days,
      learningStep: f.learning_steps,
      reps: f.reps,
      lapses: f.lapses,
      lastReview: now,
    },
    delayMs: due - now,
    interval: f.state === State.Review ? f.scheduled_days : -Math.round((due - now) / 1000),
  };
}

/* ───────────── SM-2 (Anki legacy) ───────────── */

function fuzz(ivl: number, cardId: string): number {
  if (ivl < 2.5) return Math.round(ivl);
  // deterministic per card+interval so previews match the actual answer
  let h = 0;
  const s = cardId + ':' + Math.round(ivl);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = (h % 1000) / 1000;
  const delta = ivl < 7 ? 1 : ivl < 30 ? Math.max(2, ivl * 0.15) : Math.max(4, ivl * 0.05);
  return Math.round(ivl - delta + r * (2 * delta));
}

function stepDelay(steps: number[], idx: number, rating: Rating): { idx: number; mins: number } | null {
  if (!steps.length) return null;
  if (rating === 1) return { idx: 0, mins: steps[0] };
  if (rating === 2) {
    if (idx === 0) {
      const mins = steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440);
      return { idx: 0, mins };
    }
    return { idx, mins: steps[idx] };
  }
  if (rating === 3) {
    const next = idx + 1;
    if (next >= steps.length) return null; // graduate
    return { idx: next, mins: steps[next] };
  }
  return null; // easy always graduates
}

function reviewDue(now: number, days: number): number {
  // due at the start of the study day `days` from today, like Anki
  return dayEnd(dayNumber(now) + days - 1);
}

function scheduleSm2(c: Card, p: Preset, rating: Rating, now: number): ScheduleResult {
  const learn = p.learningSteps.map(parseStep).filter((x) => x > 0);
  const relearn = p.relearningSteps.map(parseStep).filter((x) => x > 0);
  const out: Card = { ...c, reps: c.reps + 1, lastReview: now };
  const mod = p.intervalModifier || 1;
  const cap = (d: number) => Math.min(p.maxInterval, Math.max(1, d));
  const learnTo = (idx: number, mins: number, state: CardState): ScheduleResult => {
    out.state = state;
    out.learningStep = idx;
    out.due = now + mins * MIN;
    return { card: out, delayMs: mins * MIN, interval: -Math.round(mins * 60) };
  };
  const reviewIn = (days: number): ScheduleResult => {
    days = cap(Math.round(days));
    out.state = CardState.Review;
    out.learningStep = 0;
    out.scheduledDays = days;
    out.due = reviewDue(now, days);
    return { card: out, delayMs: out.due - now, interval: days };
  };

  if (c.state === CardState.New || c.state === CardState.Learning) {
    if (!c.ease) out.ease = p.startingEase;
    const idx = c.state === CardState.New ? 0 : c.learningStep;
    const st = stepDelay(learn, idx, rating);
    if (st && rating !== 4) return learnTo(st.idx, st.mins, CardState.Learning);
    out.ease = out.ease || p.startingEase;
    return reviewIn(rating === 4 ? p.easyInterval : p.graduatingInterval);
  }

  if (c.state === CardState.Relearning) {
    const st = stepDelay(relearn, c.learningStep, rating);
    if (st && rating !== 4) return learnTo(st.idx, st.mins, CardState.Relearning);
    return reviewIn(rating === 4 ? c.scheduledDays + 1 : c.scheduledDays);
  }

  // Review
  const ease = c.ease || p.startingEase;
  const ivl = Math.max(1, c.scheduledDays);
  const elapsed = c.lastReview ? Math.max(0, (now - c.lastReview) / DAY) : ivl;
  const late = Math.max(0, elapsed - ivl);
  if (rating === 1) {
    out.lapses = c.lapses + 1;
    out.ease = Math.max(1.3, ease - 0.2);
    out.scheduledDays = cap(Math.max(p.minInterval, Math.round(ivl * p.newInterval)));
    if (relearn.length) return learnTo(0, relearn[0], CardState.Relearning);
    return reviewIn(out.scheduledDays);
  }
  const hardIvl = Math.max(ivl + 1, ivl * p.hardInterval * mod);
  const goodIvl = Math.max(hardIvl + 1, (ivl + late / 2) * ease * mod);
  const easyIvl = Math.max(goodIvl + 1, (ivl + late) * ease * p.easyBonus * mod);
  if (rating === 2) {
    out.ease = Math.max(1.3, ease - 0.15);
    return reviewIn(fuzz(cap(hardIvl), c.id));
  }
  if (rating === 3) return reviewIn(fuzz(cap(goodIvl), c.id));
  out.ease = ease + 0.15;
  return reviewIn(fuzz(cap(easyIvl), c.id));
}

/* ───────────── public API ───────────── */

export function schedule(c: Card, p: Preset, rating: Rating, now = Date.now()): ScheduleResult {
  return p.algorithm === 'sm2' ? scheduleSm2(c, p, rating, now) : scheduleFsrs(c, p, rating, now);
}

export function previewAll(c: Card, p: Preset, now = Date.now()): Record<Rating, number> {
  return {
    1: schedule(c, p, 1, now).delayMs,
    2: schedule(c, p, 2, now).delayMs,
    3: schedule(c, p, 3, now).delayMs,
    4: schedule(c, p, 4, now).delayMs,
  };
}

/** Probability of recall right now (FSRS forgetting curve). */
export function retrievability(c: Card, now = Date.now()): number | null {
  if (c.state === CardState.New || !c.lastReview || !(c.stability > 0)) return null;
  const t = (now - c.lastReview) / DAY;
  const decay = -0.5;
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return Math.pow(1 + (factor * t) / c.stability, decay);
}

export function newCardFields(): Pick<
  Card,
  'state' | 'due' | 'stability' | 'difficulty' | 'ease' | 'scheduledDays' | 'learningStep' | 'reps' | 'lapses' | 'lastReview' | 'queue' | 'flag'
> {
  return {
    state: CardState.New,
    due: 0,
    stability: 0,
    difficulty: 0,
    ease: 0,
    scheduledDays: 0,
    learningStep: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
    queue: 'normal',
    flag: 0,
  };
}
