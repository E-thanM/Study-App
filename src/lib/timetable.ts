import { all, patch } from './store';
import type { Session } from './types';
import { isoDate, parseIso, timeToMin, weekdayMon } from './util';

export function sessionsOn(date: Date | string, timetableId?: string): Session[] {
  const d = typeof date === 'string' ? parseIso(date) : date;
  const iso = isoDate(d);
  const wd = weekdayMon(d);
  return all('session')
    .filter((s) => (!timetableId || s.timetableId === timetableId) && (s.date ? s.date === iso : s.weekday === wd))
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
}

export const isDone = (s: Session, iso: string) => !!s.log?.[iso]?.done;
export const occNote = (s: Session, iso: string) => s.log?.[iso]?.note || '';

export function setDone(s: Session, iso: string, done: boolean) {
  patch('session', s.id, { log: { ...s.log, [iso]: { ...s.log?.[iso], done } } });
}

export function setOccNote(s: Session, iso: string, note: string) {
  patch('session', s.id, { log: { ...s.log, [iso]: { ...s.log?.[iso], note } } });
}

export const durationMin = (s: Pick<Session, 'start' | 'end'>) => Math.max(0, timeToMin(s.end) - timeToMin(s.start));
