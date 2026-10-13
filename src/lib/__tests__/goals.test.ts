import { describe, expect, it } from 'vitest';
import {
  SKIPPED, buildGoalIndex, canonicalSubject, findMissed, goalProgress, matchDeck, occurrenceProgress, planReschedule,
  sameSubject, setsForSubject, studyDayIso, suggestGoals, type GoalData,
} from '../goals';
import { CardState, type Session, type SessionGoal } from '../types';

const decks = [
  { id: 'bio', name: 'Biology', parentId: null },
  { id: 'bio-cells', name: 'Cells', parentId: 'bio' },
  { id: 'bio-cells-mito', name: 'Mitosis', parentId: 'bio-cells' },
  { id: 'chem', name: 'Chemistry', parentId: null },
  { id: 'cs', name: 'Computer Science', parentId: null },
  { id: 'lit', name: 'English Literature', parentId: null },
  { id: 'dt', name: 'Design & Technology', parentId: null },
  { id: 'maths', name: 'Maths', parentId: null },
  { id: 'ger', name: 'German', parentId: null },
  { id: 'phys', name: 'Physics', parentId: null },
  { id: 'hist', name: 'History', parentId: null },
  { id: 'chem-bio', name: 'Biology links', parentId: 'chem' },
];

describe('subject → deck matching', () => {
  const cases: [string, string][] = [
    ['Biology', 'bio'], ['Bio', 'bio'], ['biology ', 'bio'], ['GCSE Biology', 'bio'], ['Triple Bio', 'bio'],
    ['Chem', 'chem'], ['Chemestry', 'chem'],
    ['Compsci', 'cs'], ['CS', 'cs'], ['Comp Sci', 'cs'], ['Computing', 'cs'],
    ['English lit', 'lit'], ['Eng Lit', 'lit'], ['English Literature', 'lit'],
    ['DT', 'dt'], ['D&T', 'dt'], ['D & T', 'dt'], ['Design and Technology', 'dt'], ['Design Tech', 'dt'],
    ['Maths', 'maths'], ['Mathematics', 'maths'], ['Math', 'maths'],
    ['German', 'ger'], ['Physics', 'phys'], ['Hist', 'hist'],
  ];
  for (const [subject, id] of cases) it(`${subject} → ${id}`, () => expect(matchDeck(subject, decks)?.id).toBe(id));

  it('returns nothing for an unrelated subject', () => {
    expect(matchDeck('Music', decks)).toBeUndefined();
    expect(matchDeck('', decks)).toBeUndefined();
  });
  it('matches "DT" deck names too', () => {
    expect(matchDeck('Design & Technology', [{ id: 'x', name: 'DT', parentId: null }])?.id).toBe('x');
    expect(matchDeck('Mathematics', [{ id: 'm', name: 'Maths', parentId: null }])?.id).toBe('m');
  });
  it('prefers root decks and skips filtered ones', () => {
    expect(matchDeck('Biology', [{ id: 'f', name: 'Biology', parentId: null, filtered: {} }, ...decks])?.id).toBe('bio');
  });
  it('canonical names and sameSubject', () => {
    expect(canonicalSubject('Eng Lit')).toBe('english literature');
    expect(canonicalSubject('Biology – cells')).toBe('biology');
    expect(sameSubject('Bio', 'Biology')).toBe(true);
    expect(sameSubject('Chemistry', 'Biology')).toBe(false);
    expect(sameSubject('English Literature', 'English Language')).toBe(false);
  });
  it('finds Quick Learn sets for a subject', () => {
    const sets = [
      { id: 's1', title: 'Cells', folder: 'Biology', createdAt: 1, lastStudied: 50 },
      { id: 's2', title: 'Enzymes', folder: 'Biology', createdAt: 2 },
      { id: 's3', title: 'Bonding', folder: 'Chemistry', createdAt: 3 },
    ];
    expect(setsForSubject('Bio', sets).map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

/* local time helpers – study days roll over at 04:00 */
const at = (iso: string, h: number, m = 0) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m).getTime();
};

describe('goal progress', () => {
  const day = '2026-10-12';
  const data: GoalData = {
    dayStartHour: 4,
    decks,
    revlogs: [
      { deckId: 'bio', review: at(day, 17), state: CardState.Review },
      { deckId: 'bio-cells', review: at(day, 17, 5), state: CardState.New },
      { deckId: 'bio-cells-mito', review: at(day, 23, 30), state: CardState.Learning },
      { deckId: 'bio', review: at('2026-10-13', 2), state: CardState.New }, // 2am → still the 12th
      { deckId: 'bio', review: at('2026-10-13', 5), state: CardState.Review }, // the 13th
      { deckId: 'chem', review: at(day, 18), state: CardState.Review },
    ],
    studylogs: [
      { source: 'set', start: at(day, 18), ms: 6 * 60_000, refId: 'set1' },
      { source: 'set', start: at(day, 19), ms: 5 * 60_000, refId: 'set1' },
      { source: 'set', start: at(day, 19), ms: 30 * 60_000, refId: 'other' },
    ],
    papers: [{ subject: 'Bio', date: day }, { subject: 'Chemistry', date: day }],
    blurts: [{ subject: 'Biology', date: at(day, 20) }],
    quotes: [{ history: { [day]: 4 } }, { history: { [day]: 3, '2026-10-11': 9 } }],
  };
  const idx = buildGoalIndex(data);
  const sess = (goals: SessionGoal[], log: Session['log'] = {}) => ({ subject: 'Biology', log, goals });

  it('uses the day rollover', () => {
    expect(studyDayIso(at('2026-10-13', 2), 4)).toBe(day);
    expect(studyDayIso(at('2026-10-13', 4), 4)).toBe('2026-10-13');
  });
  it('counts reviews in the deck subtree on that day', () => {
    const p = goalProgress({ id: 'g', type: 'review', target: 4 }, sess([]), day, idx);
    expect(p).toMatchObject({ done: 4, target: 4, met: true, frac: 1 });
    expect(goalProgress({ id: 'g', type: 'review', target: 10, deckId: 'bio-cells' }, sess([]), day, idx).done).toBe(2);
    expect(goalProgress({ id: 'g', type: 'review', target: 10 }, sess([]), '2026-10-13', idx).done).toBe(1);
  });
  it('counts new cards learnt', () => {
    expect(goalProgress({ id: 'g', type: 'new', target: 5 }, sess([]), day, idx)).toMatchObject({ done: 2, met: false });
  });
  it('falls back to the subject deck when the goal deck was deleted', () => {
    expect(goalProgress({ id: 'g', type: 'review', target: 5, deckId: 'gone' }, sess([]), day, idx).done).toBe(4);
  });
  it('counts minutes on the Quick Learn set', () => {
    expect(goalProgress({ id: 'g', type: 'set', target: 10, setId: 'set1' }, sess([]), day, idx)).toMatchObject({ done: 11, met: true });
  });
  it('papers, blurts and quotes', () => {
    expect(goalProgress({ id: 'g', type: 'paper', target: 1 }, sess([]), day, idx)).toMatchObject({ done: 1, met: true });
    expect(goalProgress({ id: 'g', type: 'paper', target: 1 }, { subject: 'Physics', log: {} }, day, idx).met).toBe(false);
    expect(goalProgress({ id: 'g', type: 'blurt', target: 1 }, sess([]), day, idx).met).toBe(true);
    expect(goalProgress({ id: 'g', type: 'blurt', target: 1 }, sess([]), '2026-10-11', idx).met).toBe(false);
    expect(goalProgress({ id: 'g', type: 'quotes', target: 10 }, sess([]), day, idx)).toMatchObject({ done: 7, met: false });
  });
  it('custom goals are ticked manually', () => {
    const g: SessionGoal = { id: 'c1', type: 'custom', target: 1, text: 'Plan an essay' };
    expect(goalProgress(g, sess([g]), day, idx).met).toBe(false);
    expect(goalProgress(g, sess([g], { [day]: { goalsDone: ['c1'] } }), day, idx).met).toBe(true);
  });
  it('an occurrence is complete when every goal is met', () => {
    const goals: SessionGoal[] = [{ id: 'a', type: 'review', target: 3 }, { id: 'b', type: 'custom', target: 1, text: 'x' }];
    expect(occurrenceProgress(sess(goals), day, idx)).toMatchObject({ met: 1, total: 2, allMet: false });
    expect(occurrenceProgress(sess(goals, { [day]: { goalsDone: ['b'] } }), day, idx).allMet).toBe(true);
    expect(occurrenceProgress(sess([]), day, idx).allMet).toBe(false);
  });
});

describe('suggest goals', () => {
  it('caps reviews to what fits at ~8s each and adds new cards + a set', () => {
    const g = suggestGoals({ subject: 'Biology', minutes: 40, deckId: 'bio', due: 500, newAvailable: 100, sets: [{ id: 's', title: 'Cells' }] });
    const rev = g.find((x) => x.type === 'review')!;
    // 40 min minus 10 min of Quick Learn = 30 min → 225 reviews at 8s
    expect(rev.target).toBe(225);
    expect(rev.deckId).toBe('bio');
    expect(g.find((x) => x.type === 'set')?.setId).toBe('s');
    expect(g.some((x) => x.type === 'new')).toBe(false); // no time left
  });
  it('few due cards leaves room for new cards', () => {
    const g = suggestGoals({ subject: 'Biology', minutes: 40, deckId: 'bio', due: 23, newAvailable: 100, sets: [] });
    expect(g.map((x) => [x.type, x.target])).toEqual([['review', 20], ['new', 20]]);
  });
  it('past paper / quotes topics and a custom fallback', () => {
    const g = suggestGoals({ subject: 'English Literature', topic: 'Past paper section', minutes: 40, deckId: 'lit', due: 0, newAvailable: 0, sets: [], hasQuotes: true });
    expect(g.map((x) => x.type).sort()).toEqual(['paper', 'quotes']);
    const c = suggestGoals({ subject: 'Music', topic: 'Composition', minutes: 40, due: 0, newAvailable: 0, sets: [] });
    expect(c).toMatchObject([{ type: 'custom', text: 'Composition' }]);
  });
});

describe('missed sessions and rescheduling', () => {
  // 2026-10-12 is a Monday
  const mk = (id: string, p: Partial<Session>): Session => ({
    id, kind: 'session', updatedAt: 0, timetableId: 't', date: null, weekday: null, start: '17:00', end: '17:40',
    subject: id, topic: '', notes: '', log: {}, ...p,
  });
  const mon = mk('mon', { weekday: 0 });
  const tue = mk('tue', { weekday: 1, start: '17:00', end: '17:40' });
  const tue2 = mk('tue2', { weekday: 1, start: '17:40', end: '18:20' });
  const thu = mk('thu', { weekday: 3 });
  const sat = mk('sat', { weekday: 5, start: '10:00', end: '10:40' });

  it('finds unticked past occurrences of the last week', () => {
    const doneTue = { ...tue, log: { '2026-10-13': { done: true } } };
    const movedThu = { ...thu, log: { '2026-10-15': { moved: '2026-10-17' } } };
    const skippedMon = { ...mon, log: { '2026-10-12': { moved: SKIPPED } } };
    const m = findMissed([skippedMon, doneTue, tue2, movedThu, sat], '2026-10-19');
    expect(m.map((x) => `${x.session.id}@${x.iso}`)).toEqual(['tue2@2026-10-13', 'sat@2026-10-17']);
    // today's own sessions aren't missed yet, and nothing before the timetable existed
    expect(findMissed([mon], '2026-10-19')).toHaveLength(1);
    expect(findMissed([mon], '2026-10-19', { since: '2026-10-13' })).toHaveLength(0);
  });

  it('moves into the next free slots after the last session, before 21:30, on study days', () => {
    const sessions = [mon, tue, tue2, thu, sat];
    const missed = [{ session: tue2, iso: '2026-10-13' }, { session: sat, iso: '2026-10-17' }, { session: thu, iso: '2026-10-15' }];
    // today = Thursday 22nd, 20:00 → no room today (would end after 21:30)
    const plan = planReschedule(missed, sessions, '2026-10-22', { nowMin: 20 * 60 + 50 });
    // Friday 23rd has no sessions in this plan → skipped; Saturday after the 10:40 end
    expect(plan.map((p) => `${p.session.id}@${p.iso}:${p.slot.iso} ${p.slot.start}-${p.slot.end}`)).toEqual([
      'tue2@2026-10-13:2026-10-24 10:40-11:20',
      'sat@2026-10-17:2026-10-24 11:20-12:00',
      'thu@2026-10-15:2026-10-26 17:40-18:20',
    ]);
  });

  it("uses today's evening when there's room and never overlaps", () => {
    const plan = planReschedule([{ session: mon, iso: '2026-10-12' }], [mon, tue, tue2], '2026-10-13', { nowMin: 15 * 60 });
    expect(plan[0]).toMatchObject({ iso: '2026-10-12', slot: { iso: '2026-10-13', start: '18:20', end: '19:00' } });
    const late = planReschedule([{ session: mon, iso: '2026-10-12' }], [mon, tue, tue2], '2026-10-13', { nowMin: 18 * 60 + 40 });
    expect(late[0].slot).toMatchObject({ iso: '2026-10-13', start: '19:00' });
  });

  it('uses a free day only when no study day has room', () => {
    const full = mk('full', { weekday: 0, start: '17:00', end: '21:20' });
    const plan = planReschedule([{ session: mon, iso: '2026-10-05' }], [full], '2026-10-06', { horizon: 7 });
    // only Mondays are study days; Monday 12th is full → falls back to Tuesday 6th at 16:00
    expect(plan[0].slot).toMatchObject({ iso: '2026-10-06', start: '16:00', end: '16:40' });
  });
});
