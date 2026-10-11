import { all } from './store';
import { getSettings } from './seed';
import { DAY, MIN, dayNumber, dayStart, parseIso, startOfWeek, timeToMin } from './util';

/** Study time per study-day (dayNumber → ms), from flashcards, quick-learn sets and completed timetable sessions. */
export function activityByDay(includeTimetable = getSettings().countTimetableHours): Map<number, { ms: number; reviews: number }> {
  const m = new Map<number, { ms: number; reviews: number }>();
  const add = (day: number, ms: number, reviews = 0) => {
    const cur = m.get(day) || { ms: 0, reviews: 0 };
    cur.ms += ms;
    cur.reviews += reviews;
    m.set(day, cur);
  };
  for (const r of all('revlog')) add(dayNumber(r.review), r.timeMs, 1);
  for (const s of all('studylog')) add(dayNumber(s.start), s.ms);
  for (const s of all('session')) {
    const dur = Math.max(0, timeToMin(s.end) - timeToMin(s.start)) * MIN;
    for (const [date, entry] of Object.entries(s.log || {})) {
      if (!entry.done) continue;
      const d = parseIso(date);
      d.setHours(12);
      add(dayNumber(d.getTime()), includeTimetable ? dur : 0, 0);
      // a ticked session always counts toward the streak even when its time is excluded
      if (!includeTimetable) m.get(dayNumber(d.getTime()))!.reviews += 1;
    }
  }
  return m;
}

export function streak(act = activityByDay()): { current: number; best: number; studiedToday: boolean } {
  const today = dayNumber();
  const active = (d: number) => {
    const a = act.get(d);
    return !!a && (a.ms > 0 || a.reviews > 0);
  };
  const studiedToday = active(today);
  let current = 0;
  for (let d = studiedToday ? today : today - 1; active(d); d--) current++;
  let best = 0, run = 0;
  const days = [...act.keys()].sort((a, b) => a - b);
  let prev = -Infinity;
  for (const d of days) {
    if (!active(d)) continue;
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current), studiedToday };
}

export function weekMs(act = activityByDay()): { total: number; perDay: number[] } {
  const monday = startOfWeek(new Date(), getSettings().weekStartsMonday);
  const perDay: number[] = [];
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    d.setHours(12);
    const ms = act.get(dayNumber(d.getTime()))?.ms || 0;
    perDay.push(ms);
    total += ms;
  }
  return { total, perDay };
}

/** Number of reviews due in each of the next `days` days. */
export function forecast(days = 30): number[] {
  const today = dayNumber();
  const out = new Array(days).fill(0);
  for (const c of all('card')) {
    if (c.queue === 'suspended' || c.state === 0) continue;
    const d = Math.max(0, dayNumber(c.due) - today);
    if (d < days) out[d]++;
  }
  return out;
}

export function trueRetention(daysBack = 30): { young: number | null; mature: number | null; total: number } {
  const since = dayStart(dayNumber() - daysBack + 1);
  let yP = 0, yN = 0, mP = 0, mN = 0;
  for (const r of all('revlog')) {
    if (r.review < since || r.state !== 2) continue;
    const mature = r.lastInterval >= 21;
    if (r.rating > 1) mature ? mP++ : yP++;
    else mature ? mN++ : yN++;
  }
  return {
    young: yP + yN ? yP / (yP + yN) : null,
    mature: mP + mN ? mP / (mP + mN) : null,
    total: yP + yN + mP + mN,
  };
}

export const DAY_MS = DAY;
