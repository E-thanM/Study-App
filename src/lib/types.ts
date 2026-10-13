// Every synced object is a "record": a JSON document with an id, a kind and a
// client-side updatedAt timestamp used for last-write-wins conflict resolution.

export interface BaseRec {
  id: string;
  kind: Kind;
  updatedAt: number;
  deleted?: boolean;
}

export type Kind =
  | 'deck'
  | 'preset'
  | 'notetype'
  | 'note'
  | 'card'
  | 'revlog'
  | 'media'
  | 'set'
  | 'setprogress'
  | 'studylog'
  | 'timetable'
  | 'session'
  | 'target'
  | 'settings';

/* ───────────── Long-term flashcards (Anki-style) ───────────── */

export interface FilteredConfig {
  search: string;
  limit: number;
  order: 'random' | 'due' | 'added' | 'lapses' | 'interval';
  reschedule: boolean;
}

export interface Deck extends BaseRec {
  kind: 'deck';
  name: string;
  parentId: string | null;
  presetId: string;
  description?: string;
  collapsed?: boolean;
  filtered?: FilteredConfig;
  /** Custom-study "extend today's limits": { day, newExtra, revExtra } */
  extend?: { day: number; newExtra: number; revExtra: number };
  createdAt: number;
}

export interface Preset extends BaseRec {
  kind: 'preset';
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  learningSteps: string[]; // e.g. ["1m","10m"]
  relearningSteps: string[];
  algorithm: 'fsrs' | 'sm2';
  // FSRS
  desiredRetention: number;
  fsrsWeights?: number[];
  // shared
  maxInterval: number;
  // SM-2 (legacy Anki)
  graduatingInterval: number;
  easyInterval: number;
  startingEase: number;
  easyBonus: number;
  intervalModifier: number;
  hardInterval: number;
  newInterval: number;
  minInterval: number;
  // lapses
  leechThreshold: number;
  leechAction: 'suspend' | 'tag';
  // display / burying
  newCardOrder: 'added' | 'random';
  newReviewMix: 'mix' | 'after' | 'before';
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  showTimer: boolean;
  maxAnswerSeconds: number;
  autoplayAudio: boolean;
}

export interface Template {
  name: string;
  front: string;
  back: string;
}

export interface NoteType extends BaseRec {
  kind: 'notetype';
  name: string;
  type: 'standard' | 'cloze';
  fields: string[];
  templates: Template[];
  css: string;
  builtin?: boolean;
}

export interface Note extends BaseRec {
  kind: 'note';
  noteTypeId: string;
  deckId: string;
  fields: Record<string, string>;
  tags: string[];
  createdAt: number;
  /** Anki note guid, used to avoid duplicates when re-importing a deck */
  guid?: string;
}

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export type Queue = 'normal' | 'suspended' | 'buried' | 'userBuried';

export interface Card extends BaseRec {
  kind: 'card';
  noteId: string;
  deckId: string;
  /** original deck when the card is in a filtered deck */
  odid?: string;
  ord: number;
  state: CardState;
  due: number; // ms timestamp
  stability: number;
  difficulty: number;
  ease: number; // SM-2 ease factor (2.5 = 250%)
  scheduledDays: number;
  learningStep: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
  queue: Queue;
  buriedDay?: number;
  flag: number; // 0 none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple
  position: number; // new card order
  createdAt: number;
}

export interface RevLog extends BaseRec {
  kind: 'revlog';
  cardId: string;
  noteId: string;
  deckId: string;
  rating: 1 | 2 | 3 | 4;
  /** state before answering */
  state: CardState;
  review: number;
  timeMs: number;
  interval: number; // days (negative = minutes, Anki style)
  lastInterval: number;
  ease: number;
  /** snapshot of card before answer for undo */
  prev?: Partial<Card>;
}

export interface Media extends BaseRec {
  kind: 'media';
  name: string;
  dataUrl: string;
}

/* ───────────── Short-term sets (Quizlet-style) ───────────── */

export interface Term {
  id: string;
  term: string;
  definition: string;
  starred?: boolean;
}

export interface StudySet extends BaseRec {
  kind: 'set';
  title: string;
  description: string;
  folder: string;
  terms: Term[];
  createdAt: number;
  lastStudied?: number;
  convertedDeckId?: string;
  bestMatchMs?: number;
}

/** Per-term mastery for Learn mode. 0 = not studied, 1 = learning, 2 = familiar, 3 = mastered */
export interface SetProgress extends BaseRec {
  kind: 'setprogress';
  setId: string;
  terms: Record<string, { level: number; correct: number; wrong: number; known?: boolean }>;
}

export interface StudyLog extends BaseRec {
  kind: 'studylog';
  source: 'set' | 'deck' | 'manual';
  start: number;
  ms: number;
  refId?: string;
}

/* ───────────── Timetable ───────────── */

export interface Timetable extends BaseRec {
  kind: 'timetable';
  name: string;
  createdAt: number;
}

export interface Session extends BaseRec {
  kind: 'session';
  timetableId: string;
  /** YYYY-MM-DD for a one-off session, or null for a weekly repeating one */
  date: string | null;
  /** 0 = Monday … 6 = Sunday when repeating weekly */
  weekday: number | null;
  start: string; // HH:MM
  end: string; // HH:MM
  subject: string;
  topic: string;
  notes: string;
  /** completion/notes per occurrence date (YYYY-MM-DD) */
  log: Record<string, { done?: boolean; note?: string }>;
}

/* ───────────── Calendar ───────────── */

export interface Target extends BaseRec {
  kind: 'target';
  date: string; // YYYY-MM-DD
  title: string;
  subject: string;
  type: 'target' | 'exam' | 'event';
  done: boolean;
  notes: string;
}

/* ───────────── Settings ───────────── */

export interface Settings extends BaseRec {
  kind: 'settings';
  dayStartHour: number;
  weekStartsMonday: boolean;
  countTimetableHours: boolean;
  weeklyGoalHours: number;
  /** content signature of each starter deck/set when the user last added or dismissed updates */
  starterSig?: Record<string, string>;
  /** presets were switched to show every new card at once */
  allNewCards?: boolean;
}

export type AnyRec =
  | Deck
  | Preset
  | NoteType
  | Note
  | Card
  | RevLog
  | Media
  | StudySet
  | SetProgress
  | StudyLog
  | Timetable
  | Session
  | Target
  | Settings;

export type RecOf<K extends Kind> = Extract<AnyRec, { kind: K }>;
