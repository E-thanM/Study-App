import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDrop, Icon, MenuButton, Modal, Progress, Seg, TopBar, toast, useIsMobile } from '../components/ui';
import { deckCounts, deckPath } from '../lib/collection';
import {
  GOAL_TYPES, applyMove, autoCompleteGoals, findMissed, fmtSlot, goalDeckId, goalLabel, goalRoute, isMoved, isSkipped, matchDeck,
  movedTarget, nowMinutes, occurrenceProgress, planReschedule, skipOccurrence, studyDayIso, studyToday, suggestFromStore,
  toggleGoalDone, unmoveOccurrence, useGoalIndex, type GoalIndex, type Missed, type Slot,
} from '../lib/goals';
import { guessDelimiter, parseCsv, parseTimetable, readSpreadsheet, type Cell, type ParsedSession } from '../lib/importers';
import { getSettings } from '../lib/seed';
import { all, get, patch, put, remove, useAll } from '../lib/store';
import { durationMin, isDone, occNote, sessionsOn, setDone } from '../lib/timetable';
import type { Session, SessionGoal, Timetable } from '../lib/types';
import { WEEKDAYS, addDays, download, fmtHours, getDayStartHour, isoDate, minToTime, parseIso, startOfWeek, subjectColor, timeToMin, uid, MIN } from '../lib/util';
import './timetable-goals.css';

const LAST_TT = 'study.timetable';

/** minutes since midnight for "today's" slots – after midnight but before the day rollover counts as late evening */
const studyNowMin = () => {
  const n = nowMinutes();
  return n < getDayStartHour() * 60 ? n + 1440 : n;
};

export function TimetablePage() {
  const timetables = useAll('timetable');
  const sessionsAll = useAll('session');
  const [ttId, setTtId] = useState<string>(() => localStorage.getItem(LAST_TT) || '');
  const tt = timetables.find((t) => t.id === ttId) || timetables[0];
  const [weekStart, setWeekStart] = useState(() => startOfWeek(parseIso(studyToday()), getSettings().weekStartsMonday));
  const [view, setView] = useState<'week' | 'list'>('week');
  const [editing, setEditing] = useState<{ session: Session | null; date?: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState('');
  const isMobile = useIsMobile();
  const todayIdx = () => {
    const d = parseIso(studyToday());
    return getSettings().weekStartsMonday ? (d.getDay() + 6) % 7 : d.getDay();
  };
  const [dayIdx, setDayIdx] = useState(todayIdx);
  const idx = useGoalIndex();

  const selectTt = (id: string) => {
    setTtId(id);
    localStorage.setItem(LAST_TT, id);
  };

  const sessions = useMemo(() => sessionsAll.filter((s) => s.timetableId === tt?.id), [sessionsAll, tt?.id]);
  const subjects = useMemo(() => [...new Set(sessions.map((s) => s.subject).filter(Boolean))].sort(), [sessions]);
  const todayIso = studyToday();

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekData = useMemo(() => {
    let total = 0, done = 0, minsPlanned = 0, minsDone = 0;
    const perDay = days.map((d) => {
      const list = tt ? sessionsOn(d, tt.id).filter((s) => !subjectFilter || s.subject === subjectFilter) : [];
      const iso = isoDate(d);
      for (const s of list) {
        // a moved or dismissed occurrence doesn't count – its replacement does
        if (isMoved(s, iso) || isSkipped(s, iso)) continue;
        total++;
        minsPlanned += durationMin(s);
        if (isDone(s, iso)) { done++; minsDone += durationMin(s); }
      }
      return { d, iso, list };
    });
    return { perDay, total, done, minsPlanned, minsDone };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, tt, sessions, subjectFilter]);

  // tick sessions automatically once all their goals are met (this week up to today, plus today itself)
  useEffect(() => {
    const occ: { session: Session; iso: string }[] = [];
    for (const { iso, list } of weekData.perDay) if (iso <= todayIso) for (const s of list) occ.push({ session: s, iso });
    if (tt) for (const s of sessionsOn(todayIso, tt.id)) occ.push({ session: s, iso: todayIso });
    const n = autoCompleteGoals(occ, idx);
    if (n) toast(n === 1 ? 'Goals met – session ticked off ✓' : `Goals met – ${n} sessions ticked off ✓`);
  }, [idx, weekData, todayIso, tt]);

  const missed = useMemo(
    () => (tt ? findMissed(sessions, todayIso, { since: studyDayIso(tt.createdAt) }) : []),
    [sessions, todayIso, tt],
  );
  const missedKeys = useMemo(() => new Set(missed.map((m) => `${m.session.id}:${m.iso}`)), [missed]);

  const createTt = (name = 'My timetable') => {
    const t: Timetable = { id: uid(), kind: 'timetable', updatedAt: 0, name, createdAt: Date.now() };
    put(t);
    selectTt(t.id);
    return t;
  };

  const exportCsv = () => {
    if (!tt) return;
    const rows = [['Date', 'Day', 'Start', 'End', 'Subject', 'Topic', 'Notes', 'Done dates']];
    for (const s of sessions) rows.push([s.date || '', s.date ? '' : WEEKDAYS[s.weekday ?? 0], s.start, s.end, s.subject, s.topic, s.notes, Object.entries(s.log || {}).filter(([, v]) => v.done).map(([k]) => k).join(' ')]);
    download(`${tt.name}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };

  const weekLabel = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const chipCtx: ChipCtx = { idx, todayIso, sessions: sessionsAll, missedKeys };

  return (
    <>
      <TopBar crumbs={[{ label: 'Revision Timetable' }]} />
      <div className="page-head">
        <div>
          <h1>Revision Timetable</h1>
          <div className="sub">
            {tt ? `${weekData.done}/${weekData.total} sessions this week · ${fmtHours(weekData.minsDone * MIN)} of ${fmtHours(weekData.minsPlanned * MIN)} done` : 'Import a spreadsheet or build one from scratch.'}
          </div>
        </div>
        <div className="row wrap">
          {timetables.length > 1 && (
            <select value={tt?.id} onChange={(e) => selectTt(e.target.value)} style={{ width: 'auto' }}>
              {timetables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button className="btn" onClick={() => setImportOpen(true)}><Icon name="upload" /> Import</button>
          <button className="btn primary" onClick={() => { if (!tt) createTt(); setEditing({ session: null, date: todayIso }); }}><Icon name="plus" /> Session</button>
          {tt && (
            <MenuButton
              className="btn icon"
              items={[
                { label: 'Rename timetable', icon: 'edit', onClick: () => { const n = prompt('Timetable name', tt.name); if (n) patch('timetable', tt.id, { name: n }); } },
                { label: 'New timetable', icon: 'plus', onClick: () => { const n = prompt('Name', 'New timetable'); if (n) createTt(n); } },
                { label: 'Export as CSV', icon: 'download', onClick: exportCsv },
                { label: 'Clear all ticks', icon: 'undo', onClick: () => { if (confirm('Untick every session in this timetable?')) put(sessions.map((s) => ({ ...s, log: Object.fromEntries(Object.entries(s.log || {}).map(([k, v]) => [k, { ...v, done: false }])) }))); } },
                { divider: true, label: '', onClick: () => {} },
                { label: 'Delete timetable', icon: 'trash', danger: true, onClick: () => { if (confirm(`Delete "${tt.name}" and all its sessions?`)) { remove('session', sessions.map((s) => s.id)); remove('timetable', tt.id); } } },
              ]}
            />
          )}
        </div>
      </div>

      {!tt ? (
        <div className="panel pad">
          <div className="empty">
            <h3>No timetable yet</h3>
            <p>Import an Excel (.xlsx) or CSV file – a grid with days across the top and times down the side, or a list with Date / Time / Subject columns both work.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="btn primary" onClick={() => setImportOpen(true)}><Icon name="upload" /> Import spreadsheet</button>
              <button className="btn" onClick={() => createTt()}>Start empty</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <MissedBanner missed={missed} sessions={sessionsAll} todayIso={todayIso} />
          <div className="row between wrap mb tt-toolbar">
            <div className="row">
              <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><Icon name="back" /></button>
              <button className="btn sm" onClick={() => { setWeekStart(startOfWeek(parseIso(studyToday()), getSettings().weekStartsMonday)); setDayIdx(todayIdx()); }}>This week</button>
              <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><Icon name="chevron" /></button>
              <b style={{ marginLeft: 'auto' }} className="small nowrap">{weekLabel}</b>
            </div>
            <div className="row">
              {subjects.length > 1 && (
                <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All subjects</option>
                  {subjects.map((s) => <option key={s}>{s}</option>)}
                </select>
              )}
              <Seg value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'list', label: 'List' }]} />
            </div>
          </div>
          <div className="mb"><Progress parts={[{ value: weekData.done, color: 'var(--good)' }, { value: weekData.total - weekData.done, color: 'transparent' }]} /></div>

          {view === 'week' && isMobile ? (
            <MobileDay data={weekData.perDay} dayIdx={dayIdx} setDayIdx={setDayIdx} ctx={chipCtx} onOpen={(s, iso) => setEditing({ session: s, date: iso })} />
          ) : view === 'week' ? (
            <div className="panel" style={{ overflow: 'hidden' }}>
              <div className="week-grid">
                {weekData.perDay.map(({ d, iso, list }) => (
                  <div key={iso} className="day-col">
                    <div className={`day-head ${iso === todayIso ? 'today' : ''}`}>
                      <div className="muted tiny">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                      <div className="d">{d.getDate()}</div>
                    </div>
                    <div className="day-body">
                      {list.map((s) => (
                        <SessionChip key={s.id} s={s} iso={iso} ctx={chipCtx} onOpen={() => setEditing({ session: s, date: iso })} />
                      ))}
                      <button className="btn ghost sm" style={{ color: 'var(--faint)', justifyContent: 'flex-start' }} onClick={() => setEditing({ session: null, date: iso })}>
                        <Icon name="plus" /> Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ListView sessions={sessions.filter((s) => !subjectFilter || s.subject === subjectFilter)} ctx={chipCtx} onOpen={(s, date) => setEditing({ session: s, date })} />
          )}
        </>
      )}

      {editing && tt && (
        <SessionModal
          timetableId={tt.id}
          session={editing.session}
          date={editing.date || todayIso}
          subjects={subjects}
          ctx={chipCtx}
          onClose={() => setEditing(null)}
        />
      )}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          currentTt={tt}
          onDone={(id) => { selectTt(id); setImportOpen(false); }}
          createTt={createTt}
        />
      )}
    </>
  );
}

interface ChipCtx {
  idx: GoalIndex;
  todayIso: string;
  /** every session (to find where a missed one was moved to) */
  sessions: Session[];
  /** `${sessionId}:${iso}` of missed occurrences */
  missedKeys: Set<string>;
}

/* ───────────── missed sessions ───────────── */

function MissedBanner({ missed, sessions, todayIso }: { missed: Missed<Session>[]; sessions: Session[]; todayIso: string }) {
  const [open, setOpen] = useState(false);
  // one joint plan, so each row suggests a different free slot
  const plan = useMemo(() => {
    const m = new Map<string, Slot>();
    for (const p of planReschedule(missed, sessions, todayIso, { nowMin: studyNowMin() })) m.set(`${p.session.id}:${p.iso}`, p.slot);
    return m;
  }, [missed, sessions, todayIso]);
  if (!missed.length) return null;
  const n = missed.length;
  const rescheduleAll = () => {
    const plan = planReschedule(missed, sessions, todayIso, { nowMin: studyNowMin() });
    for (const p of plan) applyMove(p.session, p.iso, p.slot);
    const left = n - plan.length;
    if (!plan.length) toast('No free time in the next week – move them by hand or dismiss them');
    else {
      const first = plan.slice(0, 3).map((p) => `${p.session.subject || 'Session'} → ${fmtSlot(p.slot.iso, p.slot.start)}`).join(', ');
      const more = plan.length > 3 ? ` +${plan.length - 3} more` : '';
      toast(`Moved ${plan.length} ${plan.length === 1 ? 'session' : 'sessions'}: ${first}${more}${left ? ` · ${left} didn't fit` : ''}`, undefined, 6000);
    }
  };
  return (
    <div className="missed-banner" role="status">
      <div className="missed-head">
        <span className="missed-ic" aria-hidden>!</span>
        <div className="grow">
          <b>{n} {n === 1 ? 'session' : 'sessions'} missed</b>
          <div className="small muted">In the last week. Move {n === 1 ? 'it' : 'them'} into free time in the next few days?</div>
        </div>
      </div>
      <div className="missed-actions">
        <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Choose'}</button>
        <button className="btn sm primary" onClick={rescheduleAll}><Icon name="calendar" /> Reschedule</button>
      </div>
      {open && (
        <div className="missed-list">
          {missed.map((m) => {
            const k = `${m.session.id}:${m.iso}`;
            const sl = plan.get(k);
            return <MissedRow key={`${k}:${sl?.iso}:${sl?.start}`} m={m} suggestion={sl} todayIso={todayIso} />;
          })}
        </div>
      )}
    </div>
  );
}

function MissedRow({ m, suggestion, todayIso }: { m: Missed<Session>; suggestion?: Slot; todayIso: string }) {
  const [date, setDate] = useState(suggestion?.iso || todayIso);
  const [start, setStart] = useState(suggestion?.start || '17:00');
  const dur = Math.max(15, durationMin(m.session));
  const move = () => {
    if (date < todayIso) return toast('Pick today or a later day');
    const end = timeToMin(start) + dur;
    if (end > 24 * 60) return toast('That runs past midnight – pick an earlier time');
    const clash = sessionsOn(date).find((x) => x.id !== m.session.id && !isMoved(x, date) && timeToMin(x.start) < end && timeToMin(x.end) > timeToMin(start));
    if (clash) return toast(`Clashes with ${clash.subject || 'a session'} ${clash.start}–${clash.end}`);
    applyMove(m.session, m.iso, { iso: date, start, end: minToTime(end) });
    toast(`${m.session.subject || 'Session'} moved to ${fmtSlot(date, start)}`);
  };
  return (
    <div className="missed-row">
      <div className="missed-what">
        <span className="dot" style={{ background: subjectColor(m.session.subject) }} />
        <span className="grow ellipsis"><b>{m.session.subject || 'Untitled'}</b>{m.session.topic && <span className="muted"> · {m.session.topic}</span>}</span>
        <span className="muted small nowrap">{parseIso(m.iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} {m.session.start}</span>
      </div>
      <div className="missed-move">
        {!suggestion && <span className="missed-nofit">No free slot in the next week – pick a time or dismiss it.</span>}
        <input type="date" value={date} min={todayIso} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="New start time" />
        <button className="btn sm primary" onClick={move}>Move</button>
        <button className="btn sm ghost" onClick={() => { skipOccurrence(m.session, m.iso); toast('Dismissed', { label: 'Undo', fn: () => unmoveOccurrence(m.session, m.iso) }); }}>Dismiss</button>
      </div>
    </div>
  );
}

/* ───────────── goals on a session ───────────── */

/** Each goal with a progress bar / count and a "Go" link. Used on chips, in the editor and on Home. */
export function GoalLines({ s, iso, idx, todayIso, onToggle, compact }: {
  s: Session;
  iso: string;
  idx: GoalIndex;
  todayIso: string;
  onToggle?: (goalId: string, on: boolean) => void;
  compact?: boolean;
}) {
  if (!s.goals?.length) return null;
  const future = iso > todayIso;
  const { list } = occurrenceProgress(s, iso, idx);
  const matched = matchDeck(s.subject, idx.decks)?.id;
  return (
    <ul className={`goal-lines ${compact ? 'compact' : ''}`}>
      {list.map(({ goal, p }) => {
        const deckId = goalDeckId(goal, s.subject, idx.decks);
        const deck = goal.deckId && goal.deckId !== matched ? get('deck', goal.deckId)?.name : undefined;
        const set = goal.setId ? get('set', goal.setId)?.title : undefined;
        const label = goalLabel(goal, { deck, set });
        const route = goalRoute(goal, deckId);
        const custom = goal.type === 'custom';
        return (
          <li key={goal.id} className={`goal-line ${p.met ? 'met' : ''}`}>
            {custom ? (
              <input
                type="checkbox"
                checked={p.met}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => (onToggle ? onToggle(goal.id, e.target.checked) : toggleGoalDone(s, iso, goal.id, e.target.checked))}
                aria-label={label}
              />
            ) : (
              <span className="goal-tick" aria-hidden>{p.met ? '✓' : ''}</span>
            )}
            <div className="goal-main">
              <div className="goal-top">
                <span className="goal-label">{label}</span>
                {!custom && !future && <span className="goal-count">{p.done}/{p.target}</span>}
              </div>
              {!custom && !future && <div className="goal-bar" aria-hidden><i style={{ width: `${p.frac * 100}%` }} /></div>}
            </div>
            {route && !p.met && (
              <Link to={route} className="goal-go" onClick={(e) => e.stopPropagation()} aria-label={`Go: ${label}`}>Go</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "moved to Tue 14:00" / "dismissed" / "missed" / "moved from Mon" */
function OccStatus({ s, iso, ctx }: { s: Session; iso: string; ctx: ChipCtx }) {
  if (isSkipped(s, iso)) return <span className="occ-status skipped">Dismissed</span>;
  if (isMoved(s, iso)) {
    const to = movedTarget(s, iso, ctx.sessions);
    return <span className="occ-status moved">Moved to {fmtSlot(s.log[iso].moved!, to?.start)}</span>;
  }
  if (ctx.missedKeys.has(`${s.id}:${iso}`)) return <span className="occ-status missed">Missed</span>;
  if (s.date) {
    const from = ctx.sessions.find((x) => x.id !== s.id && x.timetableId === s.timetableId && x.subject === s.subject && x.topic === s.topic && Object.entries(x.log || {}).some(([, v]) => v.moved === s.date));
    if (from) {
      const fromIso = Object.entries(from.log).find(([, v]) => v.moved === s.date)![0];
      return <span className="occ-status from">Moved from {fmtSlot(fromIso)}</span>;
    }
  }
  return null;
}

/** Phones: pick a day from the week strip and see that day's sessions full-width. */
function MobileDay({ data, dayIdx, setDayIdx, ctx, onOpen }: {
  data: { d: Date; iso: string; list: Session[] }[];
  dayIdx: number;
  setDayIdx: (i: number) => void;
  ctx: ChipCtx;
  onOpen: (s: Session | null, iso: string) => void;
}) {
  const day = data[dayIdx] || data[0];
  const active = day.list.filter((s) => !isMoved(s, day.iso) && !isSkipped(s, day.iso));
  const done = active.filter((s) => isDone(s, day.iso)).length;
  return (
    <>
      <div className="day-picker">
        {data.map(({ d, iso, list }, i) => (
          <button key={iso} className={`${i === dayIdx ? 'on' : ''} ${iso === ctx.todayIso ? 'today' : ''}`} onClick={() => setDayIdx(i)} aria-label={d.toDateString()}>
            <span className="wd">{d.toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
            <span className="d">{d.getDate()}</span>
            <span className="dots">{list.slice(0, 4).map((s) => <i key={s.id} className={isDone(s, iso) ? 'done' : ctx.missedKeys.has(`${s.id}:${iso}`) ? 'missed' : ''} />)}</span>
          </button>
        ))}
      </div>
      <div className="row between" style={{ margin: '4px 2px 10px' }}>
        <b>{day.d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
        {active.length > 0 && <span className="muted small">{done}/{active.length} done</span>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {day.list.length ? day.list.map((s) => <SessionChip key={s.id} s={s} iso={day.iso} big ctx={ctx} onOpen={() => onOpen(s, day.iso)} />) : <div className="panel pad center muted">Nothing planned – a day off 🎉</div>}
        <button className="btn" onClick={() => onOpen(null, day.iso)}><Icon name="plus" /> Add session</button>
      </div>
    </>
  );
}

function SessionChip({ s, iso, onOpen, big, ctx }: { s: Session; iso: string; onOpen: () => void; big?: boolean; ctx: ChipCtx }) {
  const done = isDone(s, iso);
  const note = occNote(s, iso) || s.notes;
  const away = isMoved(s, iso) || isSkipped(s, iso);
  return (
    <div className={`session ${done ? 'done' : ''} ${big ? 'big' : ''} ${away ? 'away' : ''}`} style={{ ['--c' as string]: subjectColor(s.subject) }} onClick={onOpen}>
      <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()} onChange={(e) => setDone(s, iso, e.target.checked)} aria-label="Completed" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="s-time">{s.start}–{s.end}</div>
        <div className="s-title">{s.subject || 'Untitled'}</div>
        {s.topic && <div className="s-topic">{s.topic}</div>}
        <OccStatus s={s} iso={iso} ctx={ctx} />
        {!away && <GoalLines s={s} iso={iso} idx={ctx.idx} todayIso={ctx.todayIso} compact={!big} />}
        {note && <div className="s-note">📝 {!big && note.length > 40 ? note.slice(0, 40) + '…' : note}</div>}
      </div>
    </div>
  );
}

function ListView({ sessions, onOpen, ctx }: { sessions: Session[]; onOpen: (s: Session, date: string) => void; ctx: ChipCtx }) {
  const [showPast, setShowPast] = useState(false);
  const today = ctx.todayIso;
  const dated = sessions.filter((s) => s.date && (showPast || s.date >= today)).sort((a, b) => a.date!.localeCompare(b.date!) || timeToMin(a.start) - timeToMin(b.start));
  const weekly = sessions.filter((s) => !s.date).sort((a, b) => (a.weekday! - b.weekday!) || timeToMin(a.start) - timeToMin(b.start));
  const groups = new Map<string, Session[]>();
  for (const s of dated) groups.set(s.date!, [...(groups.get(s.date!) || []), s]);
  return (
    <div className="col" style={{ gap: 16 }}>
      {weekly.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h3>Every week</h3></div>
          <div className="list">
            {weekly.map((s) => (
              <div key={s.id} className="list-row link" onClick={() => onOpen(s, today)}>
                <span className="dot" style={{ background: subjectColor(s.subject) }} />
                <span style={{ width: 90 }} className="muted small">{WEEKDAYS[s.weekday!]}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b>{s.subject}</b> {s.topic && <span className="muted">· {s.topic}</span>}
                  {!!s.goals?.length && <div className="faint small goal-summary">🎯 {s.goals.map((g) => goalLabel(g, { set: g.setId ? get('set', g.setId)?.title : undefined })).join(' · ')}</div>}
                </span>
                <span className="muted small">{s.start}–{s.end}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="row between">
        <div className="section-title" style={{ margin: 0 }}>{showPast ? 'All dated sessions' : 'Upcoming'}</div>
        <label className="check small"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past</label>
      </div>
      {[...groups].map(([date, list]) => (
        <div key={date} className="panel">
          <div className="panel-head">
            <h3>{parseIso(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <span className="muted small">{list.filter((s) => isDone(s, date)).length}/{list.length}</span>
          </div>
          <div className="list">
            {list.map((s) => (
              <div key={s.id} className="list-row link" onClick={() => onOpen(s, date)}>
                <input type="checkbox" checked={isDone(s, date)} onClick={(e) => e.stopPropagation()} onChange={(e) => setDone(s, date, e.target.checked)} />
                <span className="dot" style={{ background: subjectColor(s.subject) }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span style={{ textDecoration: isDone(s, date) ? 'line-through' : undefined }}>
                    <b>{s.subject}</b> {s.topic && <span className="muted">· {s.topic}</span>}
                  </span>
                  <div><OccStatus s={s} iso={date} ctx={ctx} /></div>
                  {!isMoved(s, date) && !isSkipped(s, date) && <GoalLines s={s} iso={date} idx={ctx.idx} todayIso={today} />}
                  {(occNote(s, date) || s.notes) && <div className="faint small">📝 {occNote(s, date) || s.notes}</div>}
                </span>
                <span className="muted small nowrap">{s.start}–{s.end}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!groups.size && !weekly.length && <div className="empty">No sessions.</div>}
    </div>
  );
}

/* ───────────── editor ───────────── */

const DEFAULT_TARGET: Record<SessionGoal['type'], number> = { review: 50, new: 10, set: 10, paper: 1, blurt: 1, quotes: 10, custom: 1 };

function GoalEditor({ s, goals, onChange }: { s: Session; goals: SessionGoal[]; onChange: (g: SessionGoal[]) => void }) {
  const decks = useAll('deck');
  const sets = useAll('set');
  const deckOpts = useMemo(
    () => decks.filter((d) => !d.filtered).map((d) => ({ id: d.id, path: deckPath(d) })).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })),
    [decks],
  );
  const setOpts = useMemo(() => [...sets].sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.title.localeCompare(b.title)), [sets]);
  const matched = matchDeck(s.subject, decks);
  const upd = (i: number, p: Partial<SessionGoal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const add = (type: SessionGoal['type']) => {
    const g: SessionGoal = { id: uid(), type, target: DEFAULT_TARGET[type] };
    if (type === 'set') {
      const forSubject = setOpts.find((x) => x.folder && matchDeck(s.subject, [{ id: x.id, name: x.folder, parentId: null }]));
      g.setId = (forSubject || setOpts[0])?.id;
    }
    if (type === 'custom') g.text = '';
    onChange([...goals, g]);
  };
  const suggest = () => {
    // goals on the subject's own deck stay on "Auto", so they follow the subject if it changes
    const g = suggestFromStore(s, matched?.id, (id) => deckCounts(id)).map((x) => (x.deckId && x.deckId === matched?.id ? { ...x, deckId: undefined } : x));
    if (!g.length) return toast(matched ? `Nothing due in ${matched.name} – add a goal yourself` : 'No matching deck or set – add a goal yourself');
    // keep the student's own checklist items
    onChange([...g, ...goals.filter((x) => x.type === 'custom' && x.text?.trim())]);
    toast('Goals suggested from what’s due');
  };
  return (
    <div className="goal-editor">
      <div className="row between wrap" style={{ gap: 8 }}>
        <b className="small">Goals for this session</b>
        <button type="button" className="btn sm" onClick={suggest}>✨ Suggest goals</button>
      </div>
      {!goals.length && (
        <div className="muted small">
          Set what “done” means, e.g. review 60 cards or learn 20 new ones. Progress fills in automatically and the session ticks itself off when every goal is met.
        </div>
      )}
      {goals.map((g, i) => (
        <div key={g.id} className="goal-edit-row">
          <select value={g.type} onChange={(e) => { const type = e.target.value as SessionGoal['type']; upd(i, { type, target: DEFAULT_TARGET[type] }); }} aria-label="Goal type">
            {GOAL_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
          {g.type !== 'custom' && (
            <label className="goal-target">
              <input type="number" inputMode="numeric" min={1} max={2000} value={g.target || ''} onChange={(e) => upd(i, { target: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label="Target" />
              <span className="muted small">{GOAL_TYPES.find((t) => t.type === g.type)?.unit}</span>
            </label>
          )}
          {(g.type === 'review' || g.type === 'new') && (
            <select className="goal-wide" value={g.deckId || ''} onChange={(e) => upd(i, { deckId: e.target.value || undefined })} aria-label="Deck">
              <option value="">{matched ? `Auto: ${deckPath(matched)}` : 'Auto (no deck matches the subject)'}</option>
              {deckOpts.map((d) => <option key={d.id} value={d.id}>{d.path}</option>)}
            </select>
          )}
          {g.type === 'set' && (
            <select className="goal-wide" value={g.setId || ''} onChange={(e) => upd(i, { setId: e.target.value || undefined })} aria-label="Quick Learn set">
              <option value="">Choose a set…</option>
              {setOpts.map((x) => <option key={x.id} value={x.id}>{x.folder ? `${x.folder} · ` : ''}{x.title}</option>)}
            </select>
          )}
          {g.type === 'custom' && (
            <input className="goal-wide" type="text" value={g.text || ''} onChange={(e) => upd(i, { text: e.target.value })} placeholder="e.g. Write a 6-mark answer" aria-label="Checklist item" />
          )}
          <button type="button" className="btn ghost icon sm" onClick={() => onChange(goals.filter((_, j) => j !== i))} aria-label="Remove goal"><Icon name="x" /></button>
        </div>
      ))}
      <div className="row wrap" style={{ gap: 6 }}>
        <select value="" onChange={(e) => e.target.value && add(e.target.value as SessionGoal['type'])} aria-label="Add a goal" className="goal-add">
          <option value="">+ Add a goal…</option>
          {GOAL_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function SessionModal({ timetableId, session, date, subjects, ctx, onClose }: { timetableId: string; session: Session | null; date: string; subjects: string[]; ctx: ChipCtx; onClose: () => void }) {
  const isNew = !session;
  const [s, setS] = useState<Session>(
    () =>
      session || {
        id: uid(), kind: 'session', updatedAt: 0, timetableId, date, weekday: null,
        start: '16:00', end: '17:00', subject: '', topic: '', notes: '', log: {},
      },
  );
  const [repeat, setRepeat] = useState<'once' | 'weekly'>(session && !session.date ? 'weekly' : 'once');
  const [occ, setOcc] = useState(session ? occNote(session, date) : '');
  const [done, setDoneLocal] = useState(session ? isDone(session, date) : false);
  const [goalsDone, setGoalsDone] = useState<string[]>(session?.log?.[date]?.goalsDone || []);
  const set = (p: Partial<Session>) => setS((x) => ({ ...x, ...p }));
  const goals = s.goals || [];
  // live view of the store record (a move/skip from here changes it)
  const live = (session && all('session').find((x) => x.id === session.id)) || s;
  const missed = !!session && ctx.missedKeys.has(`${session.id}:${date}`);
  const moved = !!session && (isMoved(live, date) || isSkipped(live, date));

  const preview: Session = { ...s, log: { ...s.log, [date]: { ...s.log?.[date], goalsDone } } };
  const prog = goals.length ? occurrenceProgress(preview, date, ctx.idx) : null;

  const save = () => {
    if (timeToMin(s.end) <= timeToMin(s.start)) return toast('End time must be after start time');
    const cleanGoals = goals.filter((g) => g.type !== 'custom' || g.text?.trim()).map((g) => ({ ...g, target: g.type === 'custom' ? 1 : Math.max(1, g.target || 1) }));
    const ids = new Set(cleanGoals.map((g) => g.id));
    const cur = (session && all('session').find((x) => x.id === session.id)) || s;
    const rec: Session = {
      ...s,
      goals: cleanGoals.length ? cleanGoals : undefined,
      date: repeat === 'once' ? s.date || date : null,
      weekday: repeat === 'weekly' ? s.weekday ?? (parseIso(s.date || date).getDay() + 6) % 7 : null,
      // keep log changes made elsewhere meanwhile (e.g. a move), then this occurrence's edits
      log: { ...cur.log, [date]: { ...cur.log?.[date], note: occ || undefined, done, goalsDone: goalsDone.filter((x) => ids.has(x)) } },
    };
    put(rec);
    onClose();
  };

  const moveNext = () => {
    if (!session) return;
    const p = planReschedule([{ session: live, iso: date }], all('session'), ctx.todayIso, { nowMin: studyNowMin() })[0];
    if (!p) return toast('No free slot in the next week');
    applyMove(live, date, p.slot);
    toast(`Moved to ${fmtSlot(p.slot.iso, p.slot.start)}`);
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New session' : 'Session'}
      onClose={onClose}
      footer={
        <>
          {!isNew && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { if (confirm('Delete this session?')) { remove('session', s.id); onClose(); } }}><Icon name="trash" /> Delete</button>}
          {!isNew && <button className="btn" onClick={() => { put({ ...s, id: uid(), log: {}, goals: s.goals?.map((g) => ({ ...g, id: uid() })) }); toast('Duplicated'); onClose(); }}><Icon name="copy" /> Duplicate</button>}
          <button className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {missed && !moved && (
          <div className="callout warn row between wrap" style={{ gap: 8 }}>
            <span>You missed this session.</span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm primary" onClick={moveNext}>Move to next free slot</button>
              <button className="btn sm" onClick={() => { skipOccurrence(live, date); onClose(); }}>Dismiss</button>
            </span>
          </div>
        )}
        {session && moved && (
          <div className="callout row between wrap" style={{ gap: 8 }}>
            <span>{isSkipped(live, date) ? 'Dismissed – not rescheduled.' : <>Moved to <b>{fmtSlot(live.log[date].moved!, movedTarget(live, date, all('session'))?.start)}</b>.</>}</span>
            <button className="btn sm" onClick={() => { unmoveOccurrence(live, date); toast(isSkipped(live, date) ? 'Restored' : 'Restored – delete the rescheduled copy if you no longer need it'); }}>Undo</button>
          </div>
        )}
        <div className="form-grid">
          <label className="field">Subject
            <input type="text" list="subject-list" value={s.subject} onChange={(e) => set({ subject: e.target.value })} autoFocus={isNew} placeholder="e.g. Biology" />
            <datalist id="subject-list">{subjects.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          <label className="field">Topic
            <input type="text" value={s.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. Cell division" />
          </label>
        </div>
        <div className="row wrap">
          <Seg value={repeat} onChange={setRepeat} options={[{ value: 'once', label: 'One-off' }, { value: 'weekly', label: 'Every week' }]} />
        </div>
        <div className="form-grid time-grid">
          {repeat === 'once' ? (
            <label className="field">Date<input type="date" value={s.date || date} onChange={(e) => set({ date: e.target.value })} /></label>
          ) : (
            <label className="field">Day
              <select value={s.weekday ?? (parseIso(date).getDay() + 6) % 7} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </label>
          )}
          <label className="field">Start<input type="time" value={s.start} onChange={(e) => { const d = timeToMin(s.end) - timeToMin(s.start); set({ start: e.target.value, end: minToTime(timeToMin(e.target.value) + Math.max(15, d)) }); }} /></label>
          <label className="field">End<input type="time" value={s.end} onChange={(e) => set({ end: e.target.value })} /></label>
        </div>
        <GoalEditor s={s} goals={goals} onChange={(g) => set({ goals: g })} />
        <label className="field">Notes (all occurrences)
          <textarea value={s.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Resources, past papers, page numbers…" />
        </label>
        <div className="panel pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <b className="small">{parseIso(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</b>
            <label className="check"><input type="checkbox" checked={done} onChange={(e) => setDoneLocal(e.target.checked)} /> Completed</label>
          </div>
          {prog && (
            <div style={{ marginBottom: 10 }}>
              <div className="muted small" style={{ marginBottom: 4 }}>{prog.met}/{prog.total} goals met{date > ctx.todayIso ? ' (upcoming)' : ''}</div>
              <GoalLines
                s={preview}
                iso={date}
                idx={ctx.idx}
                todayIso={ctx.todayIso}
                onToggle={(id, on) => setGoalsDone((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)))}
              />
            </div>
          )}
          <textarea value={occ} onChange={(e) => setOcc(e.target.value)} placeholder="How did it go? What to revisit…" style={{ minHeight: 60 }} />
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, currentTt, onDone, createTt }: { onClose: () => void; currentTt?: Timetable; onDone: (id: string) => void; createTt: (name: string) => Timetable }) {
  const [sheets, setSheets] = useState<{ name: string; rows: Cell[][] }[] | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'new' | 'append' | 'replace'>(currentTt ? 'append' : 'new');
  const [error, setError] = useState('');

  const parsed = useMemo(() => (sheets ? parseTimetable(sheets[sheetIdx]?.rows || []) : null), [sheets, sheetIdx]);
  const [edits, setEdits] = useState<Record<number, Partial<ParsedSession>>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());

  const load = async (f: File) => {
    setError('');
    try {
      const s = await readSpreadsheet(f);
      setSheets(s);
      setSheetIdx(0);
      setFileName(f.name.replace(/\.[^.]+$/, ''));
      setEdits({});
      setSkip(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadBuiltIn = async () => {
    setError('');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}revision-timetable.csv`);
      if (!res.ok) throw new Error('Could not load the built-in timetable');
      const text = await res.text();
      setSheets([{ name: 'GCSE revision timetable', rows: parseCsv(text, guessDelimiter(text)) }]);
      setSheetIdx(0);
      setFileName('GCSE revision timetable');
      setEdits({});
      setSkip(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doImport = () => {
    if (!parsed) return;
    let tt = currentTt;
    if (mode === 'new' || !tt) tt = createTt(fileName || 'Imported timetable');
    if (mode === 'replace') remove('session', all('session').filter((s) => s.timetableId === tt!.id).map((s) => s.id));
    const recs: Session[] = parsed.sessions
      .map((p, i) => ({ ...p, ...edits[i] }))
      .filter((_, i) => !skip.has(i))
      .map((p) => ({ ...p, id: uid(), kind: 'session' as const, updatedAt: 0, timetableId: tt!.id }));
    put(recs);
    toast(`Imported ${recs.length} sessions`);
    onDone(tt.id);
  };

  return (
    <Modal
      title="Import timetable"
      size="wide"
      onClose={onClose}
      footer={
        parsed && (
          <>
            {currentTt && (
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={{ width: 'auto', marginRight: 'auto' }}>
                <option value="new">Create a new timetable</option>
                <option value="append">Add to "{currentTt.name}"</option>
                <option value="replace">Replace "{currentTt.name}"</option>
              </select>
            )}
            <button className="btn" onClick={() => setSheets(null)}>Choose another file</button>
            <button className="btn primary" disabled={!parsed.sessions.length} onClick={doImport}>Import {parsed.sessions.length - skip.size} sessions</button>
          </>
        )
      }
    >
      {!sheets ? (
        <div className="col">
          <button className="btn primary" onClick={loadBuiltIn}>Use my GCSE timetable (16 h/week, Friday off)</button>
          <div className="center muted small">or</div>
          <FileDrop accept=".xlsx,.xlsm,.csv,.tsv,.txt" onFile={load} label={<><b>Drop your spreadsheet here</b><div className="small">Excel (.xlsx) or CSV · Google Sheets: File → Download → .xlsx</div></>} />
          {error && <div className="callout warn">{error}</div>}
          <div className="callout small">
            <b>Layouts that work:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li><b>Grid:</b> days (Mon–Sun or dates) across the top row, times down the first column, subjects in the cells. “Biology – Cells” splits into subject and topic.</li>
              <li><b>List:</b> columns like Date / Day, Start, End (or Time “9:00–10:00”), Subject, Topic, Notes, Done.</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="col">
          <div className="row wrap between">
            <span className="muted small">Detected layout: <b>{parsed?.layout}</b> · {parsed?.sessions.length} sessions</span>
            {sheets.length > 1 && (
              <select value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))} style={{ width: 'auto' }}>
                {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
              </select>
            )}
          </div>
          {parsed && parsed.sessions.length ? (
            <div className="preview-box" style={{ maxHeight: 380 }}>
              <table className="tbl">
                <thead><tr><th></th><th>When</th><th>Time</th><th>Subject</th><th>Topic</th></tr></thead>
                <tbody>
                  {parsed.sessions.map((p0, i) => {
                    const p = { ...p0, ...edits[i] };
                    const ed = (patch: Partial<ParsedSession>) => setEdits((e) => ({ ...e, [i]: { ...e[i], ...patch } }));
                    return (
                      <tr key={i} style={{ opacity: skip.has(i) ? 0.4 : 1 }}>
                        <td><input type="checkbox" checked={!skip.has(i)} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} /></td>
                        <td className="nowrap small">{p.date ? parseIso(p.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : `Every ${WEEKDAYS[p.weekday ?? 0]}`}</td>
                        <td className="nowrap small">{p.start}–{p.end}</td>
                        <td><input type="text" value={p.subject} onChange={(e) => ed({ subject: e.target.value })} style={{ padding: '4px 8px', fontSize: 13, minWidth: 120 }} /></td>
                        <td><input type="text" value={p.topic} onChange={(e) => ed({ topic: e.target.value })} style={{ padding: '4px 8px', fontSize: 13, minWidth: 150 }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="callout warn">Couldn't find any sessions in this sheet. Make sure it has days or dates in the first row or first column, or Date/Subject column headings.</div>
          )}
        </div>
      )}
    </Modal>
  );
}
