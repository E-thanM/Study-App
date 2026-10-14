import { all, get, put } from './store';
import type { BaseRec, Target } from './types';
import { CHECKLIST, testTopics } from './novtest';
import { addDays, isoDate, parseIso, weekdayMon } from './util';

/*
 * The study plan: phases from now to the summer exams, how to split time between resources for each
 * subject and type of topic, a day-by-day sprint for the November tests, and weekly targets.
 * The same plan as study-plan/GCSE_Study_Plan.xlsx – the dates and trackers live in one synced record.
 */

export interface PlanDates {
  /** first day of the plan */
  start: string;
  bio: string;
  lang: string;
  mocksPrep: string;
  mocks: string;
  practice: string;
  easter: string;
  exams: string;
  end: string;
}

export interface SkillLog { done: number; last?: number | null; outOf?: number }

export interface StudyPlan extends BaseRec {
  kind: 'plan';
  dates: PlanDates;
  /** Biology topic name → on the November test (unset = default guess) */
  onTest: Record<string, boolean>;
  skills: Record<string, SkillLog>;
  daysDone: string[];
  weeksDone: string[];
  /** Biology checklist self-rating per spec point: 1 could answer it now, 2 some gaps, 3 need to learn it */
  checklist: Record<string, 1 | 2 | 3>;
  hours: number;
  /** subject → priority weight (unset = default) */
  weights: Record<string, number>;
}

export const DEFAULT_DATES: PlanDates = {
  start: '2026-10-14', bio: '2026-11-02', lang: '2026-11-03', mocksPrep: '2026-12-14', mocks: '2027-01-04',
  practice: '2027-01-18', easter: '2027-03-29', exams: '2027-04-19', end: '2027-06-18',
};

export const DATE_LABELS: [keyof PlanDates, string][] = [
  ['bio', 'Biology test'], ['lang', 'English Language test'], ['mocksPrep', 'Start timed mock prep'], ['mocks', 'Mocks begin'],
  ['practice', 'Exam practice starts (after mocks)'], ['easter', 'Easter holidays start'], ['exams', 'Exam season starts'], ['end', 'Last exam'],
];

export const PLAN_ID = 'plan';

export function defaultPlan(): StudyPlan {
  return { id: PLAN_ID, kind: 'plan', updatedAt: 0, dates: { ...DEFAULT_DATES }, onTest: {}, skills: {}, daysDone: [], weeksDone: [], checklist: {}, hours: 16, weights: {} };
}

export function getPlan(): StudyPlan {
  const p = get('plan', PLAN_ID);
  const d = defaultPlan();
  return p ? { ...d, ...p, dates: { ...d.dates, ...p.dates } } : d;
}

/** Saves changes; if the test/mock dates moved, the matching calendar exams move with them. */
export function savePlan(changes: Partial<StudyPlan>) {
  const next = { ...getPlan(), ...changes };
  put(next);
  if (changes.dates) {
    const moved = calendarExams(next.dates).filter((t) => {
      const cur = get('target', t.id);
      return cur && !cur.deleted && cur.date !== t.date;
    });
    if (moved.length) put(moved.map((t) => ({ ...get('target', t.id)!, date: t.date })));
  }
}

/* ───────────── Phases ───────────── */

export interface Phase {
  id: string;
  n: number;
  name: string;
  start: string;
  end: string;
  goal: string;
  flashcards: string;
  /** learn & recall / questions / papers & essays / mistakes */
  split: [number, number, number, number];
  finish: string;
}

const iso = (d: string, n: number) => isoDate(addDays(parseIso(d), n));
export const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);

/** Last day of the November sprint: whichever test comes later. */
export const sprintEnd = (d: PlanDates) => (d.bio > d.lang ? d.bio : d.lang);

export function phases(d: PlanDates): Phase[] {
  const last = sprintEnd(d);
  return [
    { id: 'november', n: 0, name: 'November tests', start: d.start, end: last, goal: 'Biology (everything on your Year 9–10 checklist) and English Language tests – everything else ticks over on flashcards.', flashcards: 'All due cards daily (all subjects); Biology first', split: [30, 35, 25, 10], finish: 'Walk into both tests with every checklist statement rated green and timed English Language practice done.' },
    { id: 'secure', n: 1, name: 'Secure the content', start: iso(last, 1), end: iso(d.mocksPrep, -1), goal: 'Finish learning every topic once and turn it into flashcards you can recall.', flashcards: 'All due cards daily + new cards topic by topic', split: [50, 30, 10, 10], finish: 'Blurt each topic at 70%+ and answer topic questions without notes.' },
    { id: 'mocks', n: 2, name: 'Mocks: prep and sit them', start: d.mocksPrep, end: iso(d.practice, -1), goal: 'Timed papers for every subject, then sit the January mocks.', flashcards: 'All due cards daily', split: [30, 20, 40, 10], finish: 'Sit every mock paper in time with a plan for each question type.' },
    { id: 'practice', n: 3, name: 'Exam practice', start: d.practice, end: iso(d.easter, -1), goal: 'Past papers by subject; fix the weak topics the mocks found.', flashcards: 'All due cards daily', split: [25, 25, 35, 15], finish: 'Score grade 8+ on recent past papers in every subject.' },
    { id: 'easter', n: 4, name: 'Easter intensive', start: d.easter, end: iso(d.exams, -1), goal: 'Full papers under exam conditions; perfect exam technique.', flashcards: 'All due cards daily', split: [15, 15, 55, 15], finish: 'Get near-full marks on most papers and know every mark-scheme phrase.' },
    { id: 'exams', n: 5, name: 'Exam season', start: d.exams, end: d.end, goal: 'Final papers and light review, paper by paper in exam order.', flashcards: 'Due cards only (keep reviews going)', split: [25, 10, 50, 15], finish: 'Walk into each paper having done its last 2–3 past papers.' },
  ];
}

/** The phase a date falls in (before the plan → first phase, after it → last). */
export function phaseOn(d: PlanDates, day: string): Phase {
  const ps = phases(d);
  return [...ps].reverse().find((p) => p.start <= day) || ps[0];
}

/** Which resource mix applies: building up to the mocks, or exam practice after them. */
export const mixPeriod = (p: Phase): 'now' | 'later' => (p.n <= 2 ? 'now' : 'later');

/* ───────────── Resource mix and subjects ───────────── */

export interface MixRow {
  subject: string;
  type: string;
  examples: string;
  /** learn, flashcards, blurting, topic questions, past papers/essays */
  now: number[];
  /** flashcards, blurting, topic questions, past papers, mistake review */
  later: number[];
  resources: string;
  tip: string;
}

export const MIX_NOW = ['Learn (notes / video)', 'App flashcards', 'Blurting', 'Topic questions (SME / PMT)', 'Past papers / essays'];
export const MIX_LATER = ['App flashcards', 'Blurting', 'Topic questions (SME / PMT)', 'Past papers', 'Mistake review'];
export const MIX_NOW_ROUTES = [null, '/cards', '/tools/blurt', null, '/tools/papers'];
export const MIX_LATER_ROUTES = ['/cards', '/tools/blurt', null, '/tools/papers', '/tools/papers'];

export interface SubjectPlan {
  subject: string;
  board: string;
  priority: 'High' | 'Medium' | 'Low';
  weight: number;
  demands: string;
  resources: string;
  traps: string;
  mock: string;
  final: string;
}

export interface SessionType { type: string; start: string; middle: string; end: string; when: string }

/** Weekly hours per subject, split by priority weight. */
export function subjectHours(hours: number, weights: Record<string, number>): { subject: string; weight: number; hours: number }[] {
  const ws = SUBJECT_PLANS.map((s) => ({ subject: s.subject, weight: weights[s.subject] ?? s.weight }));
  const sum = ws.reduce((a, s) => a + s.weight, 0) || 1;
  return ws.map((s) => ({ ...s, hours: (hours * s.weight) / sum }));
}

/** Minutes of a session to give each resource, from the subject's main mix row. */
export function sessionSplit(row: MixRow, period: 'now' | 'later', minutes: number): { label: string; minutes: number; to: string | null }[] {
  const pcts = period === 'now' ? row.now : row.later;
  const labels = period === 'now' ? MIX_NOW : MIX_LATER;
  const routes = period === 'now' ? MIX_NOW_ROUTES : MIX_LATER_ROUTES;
  const raw = pcts.map((p) => (p / 100) * minutes);
  // round to 5 minutes but keep the total
  const out = raw.map((m) => Math.round(m / 5) * 5);
  let diff = minutes - out.reduce((a, b) => a + b, 0);
  const order = raw.map((_, i) => i).sort((a, b) => raw[b] - raw[a]);
  for (let k = 0; diff !== 0 && k < 20; k++) {
    const i = order[k % order.length];
    const step = Math.sign(diff) * Math.min(5, Math.abs(diff));
    if (out[i] + step >= 0) { out[i] += step; diff -= step; }
  }
  return labels.map((label, i) => ({ label, minutes: out[i], to: routes[i] })).filter((x) => x.minutes > 0);
}

/* ───────────── November tests ───────────── */

/** Biology topics on the test, from the school's checklist (everything but inheritance). */
export const defaultOnTest = (topic: string) => testTopics().includes(topic);
export const isOnTest = (plan: StudyPlan, topic: string) => plan.onTest[topic] ?? defaultOnTest(topic);

/** Checklist statements for a topic and how the student rated them. */
export function topicChecklist(plan: StudyPlan, topic: string) {
  const items = CHECKLIST.filter((c) => c[1] === topic);
  const r = items.map((c) => plan.checklist[c[0]]);
  return { total: items.length, green: r.filter((x) => x === 1).length, amber: r.filter((x) => x === 2).length, red: r.filter((x) => x === 3).length, ratings: r };
}

/**
 * How urgently to revise a topic, 0–5: low flashcard confidence and checklist statements rated
 * "need to learn" both push it up. Unrated statements count as "some gaps".
 */
export function priority(onTest: boolean, confidence: number, ratings: (1 | 2 | 3 | undefined)[] = []): number {
  if (!onTest) return 0;
  const cards = 6 - confidence;
  if (!ratings.some(Boolean)) return cards;
  const gap = ratings.reduce((a: number, x) => a + (x === 1 ? 0 : x === 3 ? 1 : 0.5), 0) / ratings.length;
  return Math.round(((cards + 1 + 4 * gap) / 2) * 10) / 10;
}

export const BIO_TOPICS = [
  '1 Variety of living organisms', '2a–b Cells and organisation', '2c Biological molecules', '2d Movement of substances', '2e Plant nutrition', '2e Human nutrition',
  '2f Respiration', '2g Gas exchange', '2h Transport', '2i Excretion', '2j Coordination and response', '3a Reproduction', '3b Inheritance', '4 Ecology and environment', '5 Use of biological resources',
];

export const NOVEMBER_HOURS = [
  { subject: 'Biology', hours: 8 },
  { subject: 'English Language', hours: 5 },
  { subject: 'Everything else (light, for January)', hours: 3 },
];

export const LANG_SKILLS = [
  { id: 'retrieve', name: 'Retrieving information (short questions)', how: 'Quick questions on an unseen extract – 1 mark per point, quote briefly.', outOf: 12 },
  { id: 'language', name: 'Language analysis', how: 'Pick 3 quotations, name the technique, explain the effect on the reader (zoom in on single words).', outOf: 12 },
  { id: 'structure', name: 'Structure analysis', how: 'Opening, shifts in focus, pace, ending – why the writer orders it this way.', outOf: 12 },
  { id: 'compare', name: 'Comparing two texts', how: 'Compare ideas and methods throughout with connectives (whereas, similarly).', outOf: 22 },
  { id: 'transactional', name: 'Transactional writing (article, letter, speech)', how: 'Plan 5 min, write 40 min: audience, purpose, form; rhetorical devices; check SPaG.', outOf: 45 },
  { id: 'imaginative', name: 'Imaginative writing (story / description)', how: "Plan a clear structure; show-don't-tell; varied sentences; ambitious vocabulary; check SPaG.", outOf: 30 },
];

export interface Task { text: string; to?: string; min?: number }

const FC: Task = { text: 'Flashcards: all due cards (Biology first)', to: '/cards' };
const BIO_LEARN: Task = { text: 'Biology: blurt the top-priority topic → learn the gaps → 5 topic questions', to: '/tools/blurt', min: 40 };
const BIO_Q: Task = { text: 'Biology: timed topic question set (SME / PMT) on the next-priority topic; mark it; mistakes → cards', to: '/tools/papers', min: 40 };
const BIO_MIX: Task = { text: 'Biology: mixed questions across all checklist topics (timed); mark strictly', to: '/tools/papers', min: 40 };
const EL_READ: Task = { text: 'English Language: one extract – language analysis answer (timed); mark it with Mark my answer', to: '/tools/mark', min: 40 };
const EL_STRUCT: Task = { text: 'English Language: structure + comparison practice on two short extracts', to: '/tools/mark', min: 40 };
const EL_WRITE: Task = { text: 'English Language: one writing piece (plan 5 + write 35); mark it; note SPaG fixes', to: '/tools/mark', min: 40 };
const JAN: Task = { text: 'January mocks: one session of English Literature or History (quotes / flashcards + blurt)', to: '/tools/quotes', min: 40 };

/** The November sprint for one day: main sessions plus weekend extras. Null outside the sprint. */
export function novemberDay(d: PlanDates, day: string): { main: Task[]; extra: Task[]; label?: string } | null {
  if (day < d.start || day > sprintEnd(d)) return null;
  const left = daysBetween(day, d.bio);
  const wd = weekdayMon(parseIso(day));
  if (day === d.bio && day === d.lang) return { label: 'Test day', main: [{ text: 'Biology and English Language tests – good luck!' }], extra: [] };
  if (day === d.bio) return { label: 'Biology test', main: [{ text: 'BIOLOGY TEST – good luck!' }, { text: 'Evening: English Language – reread your best writing piece and your technique list; early night', to: '/tools/mark' }], extra: [] };
  if (day === d.lang) return { label: 'English Language test', main: [{ text: 'ENGLISH LANGUAGE TEST – good luck!' }, day > d.bio ? { text: 'Evening: due flashcards only – January mock revision starts tomorrow', to: '/cards' } : { text: 'Evening: Biology – flashcards for your weakest tested topic', to: '/cards' }], extra: [] };
  if (left === 1) return { label: 'Day before', main: [{ text: 'Biology: blurt your 2 weakest topics one last time', to: '/tools/blurt' }, { text: 'Biology: flashcards + a last look at practical methods and definitions', to: '/cards' }, { text: 'Light: pack equipment, early night (no new content)' }], extra: [] };
  if (left < 1) {
    // between the two tests (if Biology comes first)
    return { main: [{ ...FC, text: 'Flashcards: all due cards' }, EL_READ, EL_WRITE], extra: [] };
  }
  if (wd === 4) return { label: 'Light day', main: [{ ...FC, text: 'Flashcards: all due cards in every subject' }, { text: 'Optional: Biology – blurt one weak topic', to: '/tools/blurt' }], extra: [] };
  if (wd >= 5) {
    // alternate the order of the two Biology sessions each weekend day
    let k = 0;
    for (let x = d.start; x < day; x = iso(x, 1)) if (weekdayMon(parseIso(x)) >= 5) k++;
    const [a, b] = k % 2 === 0 ? [BIO_LEARN, BIO_Q] : [BIO_Q, BIO_LEARN];
    return {
      main: [FC, a, b, wd === 5 ? EL_WRITE : EL_READ],
      extra: [left <= 9 ? BIO_MIX : BIO_LEARN, wd === 6 ? EL_STRUCT : EL_READ, JAN],
    };
  }
  const el = [EL_READ, EL_WRITE, EL_STRUCT, EL_READ][wd];
  return { main: [FC, left > 6 ? BIO_LEARN : BIO_MIX, wd % 2 === 0 ? BIO_Q : el, wd % 2 === 0 ? el : BIO_Q], extra: [] };
}

const learnTask = (topic: string): Task => ({ text: `Biology – ${topic}: blurt it → learn the gaps → 5 topic questions`, to: `/tools/blurt?subject=Biology&topic=${encodeURIComponent(topic)}`, min: 40 });
const questionTask = (topic: string): Task => ({ text: `Biology – ${topic}: timed topic questions (SME / PMT); mark them; mistakes → cards`, to: '/tools/papers', min: 40 });

export type SprintDay = NonNullable<ReturnType<typeof novemberDay>>;

/**
 * The sprint with real topics. From `from` on, each blurting session takes the next topic in
 * priority order and each question session revisits the topic blurted the day before (spacing),
 * so every topic gets learnt once and tested again before the test. Earlier days stay generic.
 */
export function novemberSchedule(d: PlanDates, topics: string[], from: string): Map<string, SprintDay> {
  const out = new Map<string, SprintDay>();
  let k = 0;
  let last: string | null = null;
  for (const day of novemberDays(d)) {
    const p = novemberDay(d, day);
    if (!p) continue;
    if (day < from || !topics.length) { out.set(day, p); continue; }
    const learnt: string[] = [];
    const qTopic = last;
    const fill = (t: Task): Task => {
      if (t === BIO_LEARN) { const topic = topics[k++ % topics.length]; learnt.push(topic); return learnTask(topic); }
      if (t === BIO_Q) return questionTask(qTopic ?? learnt[0] ?? topics[0]);
      return t;
    };
    out.set(day, { ...p, main: p.main.map(fill), extra: p.extra.map(fill) });
    last = learnt[learnt.length - 1] ?? last;
  }
  return out;
}

/** Every day of the sprint. */
export function novemberDays(d: PlanDates): string[] {
  const out: string[] = [];
  for (let x = d.start; x <= sprintEnd(d) && out.length < 120; x = iso(x, 1)) out.push(x);
  return out;
}

/* ───────────── Daily tasks after November ───────────── */

export function phaseTasks(p: Phase, d: PlanDates, day: string): Task[] {
  const mockWeek = day >= d.mocks && day < d.practice;
  switch (p.id) {
    case 'secure': return [
      { text: 'Flashcards: all due cards, then new cards for the topic you are learning', to: '/cards' },
      { text: 'Each session: learn one topic (notes / video) → close it → blurt → fill the gaps', to: '/tools/blurt' },
      { text: 'Finish with 3–5 topic questions without notes (SME / PMT)' },
      { text: 'Check your weakest topics on Strengths & weaknesses and give them the next session', to: '/tools/strengths' },
    ];
    case 'mocks': return mockWeek ? [
      { text: 'Mocks this week: flashcards for tomorrow\'s papers only, then an early night', to: '/cards' },
      { text: 'After each paper: write down what you were unsure of and add it to the mistakes log', to: '/tools/papers' },
    ] : [
      { text: 'Flashcards: all due cards', to: '/cards' },
      { text: 'One timed paper (or half a paper) per session – mark it strictly and log every lost mark', to: '/tools/papers' },
      { text: 'English Lit / History: one timed essay, marked with Mark my answer', to: '/tools/mark' },
      { text: 'Quotes: 10 minutes in the Quote learner', to: '/tools/quotes' },
    ];
    case 'practice': return [
      { text: 'Flashcards: all due cards (including the cards made from mistakes)', to: '/cards' },
      { text: 'Past papers by subject, oldest first – log score and mistakes', to: '/tools/papers' },
      { text: 'Fix the weak topics the mocks found: blurt → topic questions', to: '/tools/strengths' },
      { text: 'Essays for English and History, marked with Mark my answer', to: '/tools/mark' },
    ];
    case 'easter': return [
      { text: 'Flashcards: all due cards', to: '/cards' },
      { text: 'A full paper in exam conditions every day – mark strictly', to: '/tools/papers' },
      { text: 'Every lost mark → mistakes log → flashcard', to: '/tools/papers' },
    ];
    case 'exams': return [
      { text: 'Due flashcards only – keep the reviews going', to: '/cards' },
      { text: 'The last 2–3 past papers for your next exam', to: '/tools/papers' },
      { text: 'Sleep well – 8–9 hours before every exam' },
    ];
    default: return [];
  }
}

/* ───────────── Weekly plan ───────────── */

export interface Week { n: number; start: string; phase: Phase; focus: string; flashcards: string; blurts: number; topicSets: number; papers: number }

export function weeks(d: PlanDates): Week[] {
  const out: Week[] = [];
  const s = parseIso(d.start);
  let w = isoDate(addDays(s, -weekdayMon(s)));
  for (let n = 1; w <= d.end && n < 80; n++, w = iso(w, 7)) {
    const phase = phaseOn(d, w < d.start ? d.start : w);
    const f: Record<string, [string, string, number, number, number]> = {
      november: ['November tests: Biology checklist topics (highest priority first) + English Language practice; other subjects: due flashcards only', 'All due', 5, 4, 2],
      secure: ['Finish learning 1–2 topics per subject; make / learn their cards; blurt each topic; topic questions', 'All due', 4, 6, 1],
      mocks: ['Mocks: a timed paper per subject, then sit the mocks; log every lost mark', 'All due', 3, 3, 5],
      practice: ['Past papers by subject (oldest first); fix weak topics from the mocks; essays for English and History', 'All due', 2, 4, 6],
      easter: ['Easter: full papers in exam conditions daily; mark strictly; mistakes → flashcards', 'All due', 1, 2, 10],
      exams: ['Exam season: last 2–3 papers for each upcoming exam; light flashcards; sleep well', 'Due only', 1, 1, 6],
    };
    const [focus, flashcards, blurts, topicSets, papers] = f[phase.id];
    out.push({ n, start: w, phase, focus, flashcards, blurts, topicSets, papers });
  }
  return out;
}

/* ───────────── Calendar ───────────── */

/** The plan's key dates as calendar exams (fixed ids, so adding them twice doesn't duplicate). */
export function calendarExams(d: PlanDates): Pick<Target, 'id' | 'kind' | 'date' | 'title' | 'subject' | 'type' | 'done' | 'notes'>[] {
  const t = (id: string, date: string, title: string, subject: string) => ({ id: `plan-${id}`, kind: 'target' as const, date, title, subject, type: 'exam' as const, done: false, notes: 'From your study plan' });
  return [
    t('bio', d.bio, 'Biology test', 'Biology'),
    t('lang', d.lang, 'English Language test', 'English Language'),
    t('mocks', d.mocks, 'January mocks begin', ''),
    t('exams', d.exams, 'GCSE exam season begins', ''),
  ];
}

export function addExamsToCalendar(d: PlanDates): number {
  const missing = calendarExams(d).filter((t) => {
    const cur = get('target', t.id);
    return !cur || cur.deleted;
  });
  if (missing.length) put(missing);
  return missing.length;
}

export const examsInCalendar = (d: PlanDates) => calendarExams(d).every((t) => all('target').some((x) => x.id === t.id && !x.deleted));

export const RESOURCE_MIX: MixRow[] = [
  {subject: "Biology", type: "Recall-heavy content", examples: "Cells, transport, coordination, reproduction, ecology", now: [15, 35, 20, 25, 5], later: [25, 15, 25, 25, 10], resources: "App flashcards; Save My Exams (SME) Edexcel IGCSE revision notes + topic questions; PMT Edexcel IGCSE Biology topic questions", tip: "Learn mark-scheme keywords exactly (e.g. \"active site\", \"denatured\"). Blurt each topic, then do its SME/PMT questions."},
  {subject: "Biology", type: "Required practicals & data", examples: "Practicals, graphs, magnification, % change", now: [10, 25, 10, 40, 15], later: [15, 5, 30, 40, 10], resources: "App practical cards; PMT practical questions; past papers", tip: "Every practical: method, variables, control, results, safety. Practise \"describe a method\" 6-markers."},
  {subject: "Biology", type: "Extended answers", examples: "Explain/evaluate 4–6 mark questions", now: [5, 20, 15, 30, 30], later: [10, 10, 20, 45, 15], resources: "Past papers + mark schemes; app \"Mark my answer\"", tip: "Write a point per mark; use examiner phrasing; check against mark scheme."},
  {subject: "Chemistry", type: "Recall-heavy content", examples: "Bonding, periodic table, tests, organic", now: [15, 35, 20, 25, 5], later: [25, 15, 25, 25, 10], resources: "App flashcards; SME Edexcel IGCSE Chemistry notes + topic questions; PMT topic questions", tip: "Know every test (ion/gas) word-perfect including the result colour."},
  {subject: "Chemistry", type: "Calculations", examples: "Moles, concentration, yield, energetics", now: [10, 15, 0, 60, 15], later: [10, 0, 40, 40, 10], resources: "PMT and SME calculation question sets; past papers", tip: "Do 10+ questions per calculation type until automatic; always show units and working."},
  {subject: "Chemistry", type: "Practicals & extended answers", examples: "Salt preparation, rates, electrolysis explanations", now: [5, 25, 15, 30, 25], later: [15, 10, 25, 40, 10], resources: "Past papers; app practical cards", tip: "Learn full methods step by step; explain using particles/collisions with key terms."},
  {subject: "Physics", type: "Concepts & recall", examples: "Forces, waves, electricity, radioactivity, astrophysics", now: [15, 30, 20, 30, 5], later: [20, 15, 30, 25, 10], resources: "App flashcards; SME Edexcel IGCSE Physics; PMT topic questions", tip: "Know definitions precisely (e.g. \"the rate of change of velocity\")."},
  {subject: "Physics", type: "Equations & calculations", examples: "All recall equations, unit conversions, graphs", now: [10, 25, 0, 55, 10], later: [15, 0, 40, 35, 10], resources: "App equation cards; PMT/SME calculation questions; past papers", tip: "Recall every equation instantly (flashcards); show substitution → answer → unit."},
  {subject: "Physics", type: "Practicals & explain questions", examples: "Required practicals, EM induction, 6-markers", now: [5, 25, 15, 30, 25], later: [15, 10, 25, 40, 10], resources: "Past papers; your EM induction revision sheet cards", tip: "Practise 6-mark \"describe how\" answers with a clear sequence."},
  {subject: "History", type: "Knowledge (events, dates, people)", examples: "Medicine, Elizabeth, Cold War, Weimar & Nazi Germany", now: [15, 40, 25, 15, 5], later: [30, 20, 15, 25, 10], resources: "App flashcards; blurting per key topic; SME/Seneca notes; textbook", tip: "Blurt timelines; learn 2–3 specific examples per key topic to use as evidence."},
  {subject: "History", type: "Exam question types", examples: "Describe, explain, how far, sources, interpretations", now: [5, 15, 10, 30, 40], later: [10, 5, 20, 55, 10], resources: "Past papers + mark schemes; app \"Mark my answer\"; exam technique cards", tip: "Practise each question type with the mark-scheme structure; for 16-markers judge, don't just describe."},
  {subject: "English Literature", type: "Quotes & context", examples: "Macbeth, An Inspector Calls, Of Mice and Men", now: [10, 30, 20, 0, 40], later: [25, 15, 0, 45, 15], resources: "App Quote learner + point → quote cards; Mr Bruff / Mr Salles videos for analysis ideas", tip: "Learn ~20 short quotes per text that each fit several themes; know context to link (AO4)."},
  {subject: "English Literature", type: "Poetry (anthology + unseen)", examples: "16 anthology poems, unseen method", now: [15, 30, 15, 0, 40], later: [20, 10, 0, 55, 15], resources: "App poem guide + quote cards; past paper poetry questions", tip: "Compare throughout (AO3); for unseen, plan 5 min: meaning → methods → effect."},
  {subject: "English Literature", type: "Essay writing", examples: "Timed essays for each text", now: [0, 10, 10, 0, 80], later: [10, 5, 0, 75, 10], resources: "Past papers; app \"Mark my answer\" with examiner-marked examples", tip: "Thesis-led paragraphs; analyse single words; integrate context; time strictly."},
  {subject: "English Language", type: "Reading questions", examples: "Non-fiction and anthology analysis, comparison", now: [10, 10, 10, 30, 40], later: [5, 5, 25, 55, 10], resources: "Past papers (Pearson); app \"Mark my answer\"; anthology notes", tip: "Use subject terminology and explain effect on the reader; compare both texts throughout."},
  {subject: "English Language", type: "Writing (transactional / imaginative)", examples: "Articles, letters, speeches, stories", now: [10, 10, 5, 15, 60], later: [5, 5, 10, 70, 10], resources: "Past papers; model answers; app \"Mark my answer\"", tip: "Plan, vary sentences and vocabulary, check SPaG (AO5) in the last 5 minutes."},
  {subject: "Maths", type: "Methods & skills", examples: "Algebra, geometry, number, statistics", now: [10, 10, 0, 60, 20], later: [5, 0, 35, 50, 10], resources: "Corbettmaths (5-a-day + topic questions); Maths Genie / PMT; past papers", tip: "Do questions daily; redo every wrong question a week later; learn formulae not given."},
  {subject: "German", type: "Vocabulary", examples: "Theme vocabulary, high-frequency words", now: [5, 65, 10, 10, 10], later: [55, 10, 10, 15, 10], resources: "App German deck (both directions); Quizlet-style Quick Learn", tip: "Daily flashcards both ways; learn genders and plurals with each noun."},
  {subject: "German", type: "Grammar & tenses", examples: "Cases, word order, tenses", now: [15, 30, 5, 40, 10], later: [20, 5, 35, 30, 10], resources: "App grammar cards; textbook exercises; past paper translations", tip: "Practise translations into German; check verb position (V2, verb to end)."},
  {subject: "German", type: "Speaking & writing", examples: "Role-play, photo card, writing tasks", now: [5, 25, 10, 20, 40], later: [15, 5, 15, 55, 10], resources: "AQA past papers; prepared answers for each theme", tip: "Learn opinion phrases + 3 tenses; prepare and rehearse answers aloud."},
  {subject: "Computer Science", type: "Theory", examples: "Data, hardware, networks, security, ethics", now: [15, 35, 20, 25, 5], later: [25, 15, 25, 25, 10], resources: "App flashcards; SME/PMT Edexcel IGCSE CS questions", tip: "Learn definitions with an example; \"explain\" = point + reason."},
  {subject: "Computer Science", type: "Calculations & logic", examples: "Binary/hex, file sizes, truth tables", now: [10, 20, 0, 60, 10], later: [10, 0, 45, 35, 10], resources: "Topic questions; past papers", tip: "Practise conversions until fast; always show working."},
  {subject: "Computer Science", type: "Programming", examples: "Python, pseudocode, algorithms, trace tables", now: [10, 15, 0, 55, 20], later: [5, 0, 40, 45, 10], resources: "Write code daily (Python); past paper 2 tasks; trace tables", tip: "Programming is a skill – write, test and debug real code every week."},
  {subject: "Design & Technology", type: "Core & material knowledge", examples: "Materials, processes, sustainability, systems", now: [15, 40, 20, 20, 5], later: [30, 15, 20, 25, 10], resources: "App flashcards; SME/Seneca OCR D&T notes; textbook", tip: "Name specific materials and processes, and justify choices."},
  {subject: "Design & Technology", type: "Maths & extended questions", examples: "Calculations, design evaluations", now: [5, 15, 10, 40, 30], later: [10, 5, 30, 45, 10], resources: "OCR past papers + mark schemes", tip: "Show working in calculations; evaluate with pros and cons and a conclusion."},
];

export const SUBJECT_PLANS: SubjectPlan[] = [
  {subject: "English Literature", board: "Edexcel IGCSE 4ET1: Paper 1 poetry & modern prose; Paper 2 modern drama & literary heritage", priority: "High", weight: 3, demands: "Precise short quotes, analysis of methods, integrated context, comparison for poetry, timed essays", resources: "App quotes & poem guide; past papers; Mr Bruff / Mr Salles; \"Mark my answer\"", traps: "Retelling the plot; bolted-on context; long quotes; running out of time", mock: "7", final: "9"},
  {subject: "Biology", board: "Edexcel IGCSE 4BI1: Paper 1 + Paper 2 (separate science)", priority: "High", weight: 3, demands: "Exact keyword definitions, all practicals, data and calculation questions", resources: "App flashcards; SME notes + topic questions; PMT; past papers", traps: "Vague wording (\"it gets bigger\"); forgetting units; skipping Paper 2 topics", mock: "8", final: "9"},
  {subject: "History", board: "Edexcel GCSE 1HI0: Medicine + Western Front; Elizabethan England + Cold War; Weimar & Nazi Germany", priority: "High", weight: 3, demands: "Specific evidence for every point, sustained judgement in 16-markers, source and interpretation skills", resources: "App flashcards + blurting; past papers; textbook; \"Mark my answer\"", traps: "Describing instead of explaining; no judgement; generic evidence", mock: "7", final: "9"},
  {subject: "Physics", board: "Edexcel IGCSE 4PH1: Paper 1 + Paper 2", priority: "Medium", weight: 2, demands: "Every equation and unit, practicals, clear multi-step explanations", resources: "App flashcards; PMT/SME questions; past papers", traps: "Not rearranging equations; missing unit conversions", mock: "8", final: "9"},
  {subject: "Chemistry", board: "Edexcel IGCSE 4CH1: Paper 1 + Paper 2", priority: "Medium", weight: 2, demands: "Calculations, every test result, practical methods, particle explanations", resources: "App flashcards; PMT/SME questions; past papers", traps: "Unbalanced equations; wrong state symbols; vague test colours", mock: "8", final: "9"},
  {subject: "German", board: "AQA GCSE 8662: listening, speaking, reading, writing", priority: "Medium", weight: 2, demands: "Wide vocabulary, accurate grammar and word order, three tenses, confident speaking", resources: "App German deck; AQA past papers; speaking practice aloud", traps: "Wrong genders/word order; English word order in translation", mock: "7", final: "9"},
  {subject: "Computer Science", board: "Edexcel IGCSE 4CP0: Paper 1 theory; Paper 2 programming", priority: "Medium", weight: 2, demands: "Precise theory, fast calculations, confident Python under time pressure", resources: "App flashcards; SME/PMT questions; coding practice; past papers", traps: "Not practising code; mis-tracing algorithms", mock: "8", final: "9"},
  {subject: "English Language", board: "Assumed Edexcel IGCSE English Language A (4EA1)", priority: "Low", weight: 1.5, demands: "Analysis of language and structure, comparison, controlled accurate writing", resources: "Past papers; model answers; \"Mark my answer\"", traps: "Feature-spotting without effect; weak SPaG", mock: "7", final: "8+"},
  {subject: "Maths", board: "Assumed Edexcel IGCSE Maths A (4MA1, Higher)", priority: "Low", weight: 1.5, demands: "Accuracy across every topic, full working, fluency on harder questions", resources: "Corbettmaths 5-a-day; Maths Genie; PMT; past papers", traps: "Careless errors; not showing working; rusty topics", mock: "8", final: "9"},
  {subject: "Design & Technology", board: "OCR GCSE J310 (exam 50% + NEA 50%)", priority: "Low", weight: 1.5, demands: "Specific materials and processes, maths questions, evaluative answers; strong NEA", resources: "App flashcards; OCR past papers; NEA guidance", traps: "Generic answers (\"it is strong\"); leaving NEA late", mock: "7", final: "9"},
];

export const SESSION_TYPES: SessionType[] = [
  {type: "Learn a new topic", start: "Due flashcards for this subject", middle: "Read SME notes / watch one video, then close it and blurt; check and fill gaps; add or unsuspend the topic's cards", end: "Do 3–5 short topic questions without notes", when: "Phase 1, first time through a topic"},
  {type: "Recall & strengthen", start: "Blurt the topic from memory (timer)", middle: "App Blurting check → learn the gaps (Quick Learn set it makes); topic questions", end: "Mark, log mistakes, turn them into cards", when: "Topics rated 1–3 on Strengths & weaknesses"},
  {type: "Question practice", start: "Skim the mark scheme style for this topic", middle: "One SME/PMT topic question set, timed (about 1 mark per minute)", end: "Mark strictly; every lost mark → mistakes log → flashcard", when: "All phases; calculations and practicals"},
  {type: "Timed paper / essay", start: "—", middle: "Full paper or one essay in exam time (over two sessions if needed)", end: "Mark with the official mark scheme (or \"Mark my answer\" for essays); log mistakes", when: "Phases 2–5"},
  {type: "Quotes & English", start: "Quote learner – 10 quotes", middle: "Plan 2 essays in 10 min each, or write one timed section", end: "Compare your plan with the point → quote cards; mark with \"Mark my answer\"", when: "English Literature (and Language writing)"},
  {type: "Languages", start: "German flashcards (both ways)", middle: "Translation into German or a reading/listening paper section", end: "Speak 3 prepared answers aloud for the photo card / conversation", when: "German, every week"},
];
