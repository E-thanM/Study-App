import { describe, expect, it } from 'vitest';
import {
  BIO_TOPICS, DEFAULT_DATES, RESOURCE_MIX, SUBJECT_PLANS, defaultOnTest, mixPeriod, novemberDay, novemberDays, phaseOn, phases, sessionSplit, subjectHours, weeks,
} from '../plan';

const d = DEFAULT_DATES;

describe('study plan', () => {
  it('every resource mix adds up to 100%', () => {
    for (const r of RESOURCE_MIX) {
      expect(r.now.reduce((a, b) => a + b, 0), `${r.subject} ${r.type} now`).toBe(100);
      expect(r.later.reduce((a, b) => a + b, 0), `${r.subject} ${r.type} later`).toBe(100);
    }
    // every subject has a plan and at least one mix row
    for (const s of SUBJECT_PLANS) expect(RESOURCE_MIX.some((r) => r.subject === s.subject), s.subject).toBe(true);
  });

  it('phases are back to back and cover the whole plan', () => {
    const ps = phases(d);
    expect(ps[0].start).toBe(d.start);
    expect(ps[ps.length - 1].end).toBe(d.end);
    for (let i = 1; i < ps.length; i++) {
      const prevEnd = new Date(ps[i - 1].end + 'T12:00');
      prevEnd.setDate(prevEnd.getDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(ps[i].start);
    }
    expect(phaseOn(d, '2026-10-20').id).toBe('november');
    expect(phaseOn(d, '2026-11-04').id).toBe('secure');
    expect(phaseOn(d, '2027-01-05').id).toBe('mocks');
    expect(mixPeriod(phaseOn(d, '2027-02-01'))).toBe('later');
    expect(phaseOn(d, '2020-01-01').id).toBe('november');
  });

  it('November sprint follows the timetable and the test dates', () => {
    const days = novemberDays(d);
    expect(days[0]).toBe('2026-10-14');
    expect(days[days.length - 1]).toBe('2026-11-03');
    expect(novemberDay(d, '2026-11-02')!.label).toBe('Biology test');
    expect(novemberDay(d, '2026-11-01')!.label).toBe('Day before');
    expect(novemberDay(d, '2026-10-16')!.label).toBe('Light day'); // Friday off
    const sat = novemberDay(d, '2026-10-17')!;
    expect(sat.main.length + sat.extra.length).toBe(7); // 4 h weekend
    expect(novemberDay(d, '2026-10-14')!.main.length).toBe(4); // Wednesday
    expect(novemberDay(d, '2026-11-04')).toBeNull();
    // moving the test moves the plan
    expect(novemberDay({ ...d, bio: '2026-11-05', lang: '2026-11-06' }, '2026-11-05')!.label).toBe('Biology test');
    // Biology after English Language: the sprint runs to the later test
    const late = { ...d, bio: '2026-11-05' };
    expect(novemberDays(late).at(-1)).toBe('2026-11-05');
    expect(phaseOn(late, '2026-11-04').id).toBe('november');
    expect(novemberDay(late, '2026-11-05')!.label).toBe('Biology test');
  });

  it('guesses Year 9–10 Biology topics for the test', () => {
    expect(BIO_TOPICS.filter(defaultOnTest)).toHaveLength(9);
    expect(defaultOnTest('2h Transport')).toBe(true);
    expect(defaultOnTest('2i Excretion')).toBe(false);
  });

  it('splits hours and sessions without losing time', () => {
    const h = subjectHours(16, {});
    expect(h.reduce((a, s) => a + s.hours, 0)).toBeCloseTo(16);
    expect(h.find((s) => s.subject === 'Biology')!.hours).toBeGreaterThan(h.find((s) => s.subject === 'Maths')!.hours);
    for (const r of RESOURCE_MIX) for (const m of [40, 60, 120]) {
      expect(sessionSplit(r, 'now', m).reduce((a, x) => a + x.minutes, 0)).toBe(m);
      expect(sessionSplit(r, 'later', m).reduce((a, x) => a + x.minutes, 0)).toBe(m);
    }
  });

  it('weeks start on Mondays and run to the last exam', () => {
    const ws = weeks(d);
    expect(ws[0].start).toBe('2026-10-12');
    expect(ws[ws.length - 1].start <= d.end).toBe(true);
    expect(ws.length).toBe(36);
    expect(ws[0].phase.id).toBe('november');
  });
});
