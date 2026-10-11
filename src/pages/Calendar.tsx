import { useMemo, useState } from 'react';
import { Icon, Seg, TopBar } from '../components/ui';
import { getSettings } from '../lib/seed';
import { patch, put, remove, useAll } from '../lib/store';
import { isDone, sessionsOn } from '../lib/timetable';
import type { Target } from '../lib/types';
import { MONTHS, isoDate, parseIso, subjectColor, uid } from '../lib/util';

const TYPE_LABEL: Record<Target['type'], string> = { target: 'Target', exam: 'Exam', event: 'Event' };

export function CalendarPage() {
  const targets = useAll('target');
  useAll('session');
  const today = isoDate();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [sel, setSel] = useState(today);
  const mondayFirst = getSettings().weekStartsMonday;

  const byDate = useMemo(() => {
    const m = new Map<string, Target[]>();
    for (const t of targets) m.set(t.date, [...(m.get(t.date) || []), t]);
    return m;
  }, [targets]);

  const yearStats = useMemo(() => {
    const ys = targets.filter((t) => t.date.startsWith(String(year)) && t.type === 'target');
    const due = ys.filter((t) => t.date <= today);
    return { total: ys.length, met: ys.filter((t) => t.done).length, dueMet: due.filter((t) => t.done).length, due: due.length };
  }, [targets, year, today]);

  const upcoming = useMemo(() => targets.filter((t) => t.date >= today && !t.done).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8), [targets, today]);
  const overdue = useMemo(() => targets.filter((t) => t.date < today && !t.done && t.type === 'target').sort((a, b) => b.date.localeCompare(a.date)), [targets, today]);

  const dayClass = (iso: string) => {
    const list = byDate.get(iso) || [];
    const cls: string[] = [];
    const goals = list.filter((t) => t.type === 'target');
    if (goals.length) {
      if (goals.every((t) => t.done)) cls.push('has-met');
      else if (iso < today) cls.push('has-missed');
      else cls.push('has-pending');
    } else if (list.some((t) => t.type === 'event') && iso >= today) cls.push('has-pending');
    if (list.some((t) => t.type === 'exam')) cls.push('has-exam');
    if (iso === today) cls.push('today');
    else if (iso < today && !goals.length) cls.push('past');
    if (iso === sel) cls.push('sel');
    return cls.join(' ');
  };

  const wdLabels = mondayFirst ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <>
      <TopBar crumbs={[{ label: 'Revision Calendar' }]} />
      <div className="page-head">
        <div>
          <h1>Revision Calendar</h1>
          <div className="sub">
            {yearStats.due ? `${yearStats.dueMet} of ${yearStats.due} targets met so far in ${year}` : `Plan targets and exams for ${year}`}
            {overdue.length > 0 && <span style={{ color: 'var(--bad)' }}> · {overdue.length} missed</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn icon" onClick={() => setYear(year - 1)} aria-label="Previous year"><Icon name="back" /></button>
          <b style={{ minWidth: 48, textAlign: 'center' }}>{year}</b>
          <button className="btn icon" onClick={() => setYear(year + 1)} aria-label="Next year"><Icon name="chevron" /></button>
          {year !== new Date().getFullYear() && <button className="btn sm" onClick={() => { setYear(new Date().getFullYear()); setSel(today); }}>Today</button>}
        </div>
      </div>

      <div className="split">
        <div>
          <div className="legend mb">
            <span><i style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> Met</span>
            <span><i style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }} /> Planned</span>
            <span><i style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> Missed</span>
            <span><i style={{ background: 'var(--warn)', borderRadius: '50%', width: 6, height: 6 }} /> Exam</span>
          </div>
          <div className="year-grid">
            {MONTHS.map((name, m) => {
              const first = new Date(year, m, 1);
              const offset = mondayFirst ? (first.getDay() + 6) % 7 : first.getDay();
              const daysIn = new Date(year, m + 1, 0).getDate();
              const monthTargets = targets.filter((t) => t.date.startsWith(`${year}-${String(m + 1).padStart(2, '0')}`) && t.type === 'target');
              return (
                <div key={m} className="month">
                  <h3>
                    <span>{name}</span>
                    {monthTargets.length > 0 && <span className="faint tiny" style={{ fontWeight: 500 }}>{monthTargets.filter((t) => t.done).length}/{monthTargets.length}</span>}
                  </h3>
                  <div className="month-days">
                    {wdLabels.map((w, i) => <div key={i} className="wd">{w}</div>)}
                    {Array.from({ length: offset }, (_, i) => <div key={'e' + i} />)}
                    {Array.from({ length: daysIn }, (_, i) => {
                      const iso = isoDate(new Date(year, m, i + 1));
                      return (
                        <button key={iso} className={`cal-day ${dayClass(iso)}`} onClick={() => setSel(iso)} title={(byDate.get(iso) || []).map((t) => t.title).join(', ')}>
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="sticky-side col" style={{ gap: 16 }}>
          <DayPanel iso={sel} targets={byDate.get(sel) || []} />
          {overdue.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Missed targets</h3><span className="pill bad">{overdue.length}</span></div>
              <div className="list">
                {overdue.slice(0, 6).map((t) => <TargetRow key={t.id} t={t} showDate onSelect={() => { setSel(t.date); setYear(Number(t.date.slice(0, 4))); }} />)}
              </div>
            </div>
          )}
          <div className="panel">
            <div className="panel-head"><h3>Coming up</h3></div>
            <div className="list">
              {upcoming.length ? upcoming.map((t) => <TargetRow key={t.id} t={t} showDate onSelect={() => { setSel(t.date); setYear(Number(t.date.slice(0, 4))); }} />) : <div className="list-row muted small">Nothing planned – pick a day to add a target.</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function TargetRow({ t, showDate, onSelect }: { t: Target; showDate?: boolean; onSelect?: () => void }) {
  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      {t.type === 'target' ? (
        <input type="checkbox" checked={t.done} onChange={(e) => patch('target', t.id, { done: e.target.checked })} style={{ marginTop: 2 }} aria-label="Met" />
      ) : (
        <span className="pill warn" style={{ fontSize: 10 }}>{TYPE_LABEL[t.type]}</span>
      )}
      <div className="grow" style={{ cursor: onSelect ? 'pointer' : undefined }} onClick={onSelect}>
        <div style={{ textDecoration: t.done ? 'line-through' : undefined, opacity: t.done ? 0.6 : 1, fontWeight: 550 }}>{t.title}</div>
        <div className="row small muted" style={{ gap: 6 }}>
          {t.subject && <><span className="dot" style={{ background: subjectColor(t.subject) }} />{t.subject}</>}
          {showDate && <span>{parseIso(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
        </div>
        {t.notes && <div className="faint small">{t.notes}</div>}
      </div>
    </div>
  );
}

function DayPanel({ iso, targets }: { iso: string; targets: Target[] }) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [type, setType] = useState<Target['type']>('target');
  const [editing, setEditing] = useState<string | null>(null);
  const allTargets = useAll('target');
  const subjects = useMemo(() => [...new Set(allTargets.map((t) => t.subject).filter(Boolean))], [allTargets]);
  const sessions = sessionsOn(iso);
  const add = () => {
    if (!title.trim()) return;
    put({ id: uid(), kind: 'target', date: iso, title: title.trim(), subject: subject.trim(), type, done: false, notes: '' });
    setTitle('');
  };
  const d = parseIso(iso);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>{d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {iso === isoDate() && <div className="tiny muted">Today</div>}
        </div>
      </div>
      <div className="list">
        {targets.map((t) =>
          editing === t.id ? (
            <TargetEditor key={t.id} t={t} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.id} className="row" style={{ paddingRight: 10 }}>
              <div className="grow"><TargetRow t={t} /></div>
              <button className="btn ghost icon sm" onClick={() => setEditing(t.id)} aria-label="Edit"><Icon name="edit" /></button>
            </div>
          ),
        )}
      </div>
      <div style={{ padding: 14, borderTop: targets.length ? '1px solid var(--line)' : undefined }} className="col">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a target, e.g. Finish 2 past papers" />
        <div className="row">
          <input type="text" list="cal-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          <datalist id="cal-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
          <Seg value={type} onChange={setType} options={[{ value: 'target', label: 'Target' }, { value: 'exam', label: 'Exam' }, { value: 'event', label: 'Event' }]} />
        </div>
        <button className="btn primary" onClick={add} disabled={!title.trim()}><Icon name="plus" /> Add</button>
      </div>
      {sessions.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 6 }}>TIMETABLE</div>
          {sessions.map((s) => (
            <div key={s.id} className="row small" style={{ padding: '3px 0' }}>
              <span className="dot" style={{ background: subjectColor(s.subject) }} />
              <span className="grow" style={{ textDecoration: isDone(s, iso) ? 'line-through' : undefined }}>{s.subject}{s.topic ? ` · ${s.topic}` : ''}</span>
              <span className="faint">{s.start}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TargetEditor({ t, onDone }: { t: Target; onDone: () => void }) {
  const [x, setX] = useState(t);
  return (
    <div className="col" style={{ padding: 14, borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
      <input type="text" value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} />
      <div className="row">
        <input type="text" value={x.subject} onChange={(e) => setX({ ...x, subject: e.target.value })} placeholder="Subject" />
        <input type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} />
      </div>
      <Seg value={x.type} onChange={(type) => setX({ ...x, type })} options={[{ value: 'target', label: 'Target' }, { value: 'exam', label: 'Exam' }, { value: 'event', label: 'Event' }]} />
      <textarea value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} placeholder="Notes" style={{ minHeight: 50 }} />
      <div className="row between">
        <button className="btn danger sm" onClick={() => { remove('target', t.id); onDone(); }}><Icon name="trash" /> Delete</button>
        <div className="row">
          <button className="btn sm" onClick={onDone}>Cancel</button>
          <button className="btn primary sm" onClick={() => { put(x); onDone(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
