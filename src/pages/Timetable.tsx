import { useMemo, useState } from 'react';
import { FileDrop, Icon, MenuButton, Modal, Progress, Seg, TopBar, toast } from '../components/ui';
import { parseTimetable, readSpreadsheet, type Cell, type ParsedSession } from '../lib/importers';
import { getSettings } from '../lib/seed';
import { all, patch, put, remove, useAll } from '../lib/store';
import { durationMin, isDone, occNote, sessionsOn, setDone } from '../lib/timetable';
import type { Session, Timetable } from '../lib/types';
import { WEEKDAYS, addDays, download, fmtHours, isoDate, minToTime, parseIso, startOfWeek, subjectColor, timeToMin, uid, MIN } from '../lib/util';

const LAST_TT = 'study.timetable';

export function TimetablePage() {
  const timetables = useAll('timetable');
  const sessionsAll = useAll('session');
  const [ttId, setTtId] = useState<string>(() => localStorage.getItem(LAST_TT) || '');
  const tt = timetables.find((t) => t.id === ttId) || timetables[0];
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), getSettings().weekStartsMonday));
  const [view, setView] = useState<'week' | 'list'>('week');
  const [editing, setEditing] = useState<{ session: Session | null; date?: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState('');

  const selectTt = (id: string) => {
    setTtId(id);
    localStorage.setItem(LAST_TT, id);
  };

  const sessions = useMemo(() => sessionsAll.filter((s) => s.timetableId === tt?.id), [sessionsAll, tt?.id]);
  const subjects = useMemo(() => [...new Set(sessions.map((s) => s.subject).filter(Boolean))].sort(), [sessions]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekData = useMemo(() => {
    let total = 0, done = 0, minsPlanned = 0, minsDone = 0;
    const perDay = days.map((d) => {
      const list = tt ? sessionsOn(d, tt.id).filter((s) => !subjectFilter || s.subject === subjectFilter) : [];
      const iso = isoDate(d);
      for (const s of list) {
        total++;
        minsPlanned += durationMin(s);
        if (isDone(s, iso)) { done++; minsDone += durationMin(s); }
      }
      return { d, iso, list };
    });
    return { perDay, total, done, minsPlanned, minsDone };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, tt, sessions, subjectFilter]);

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

  const todayIso = isoDate();
  const weekLabel = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

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
          <div className="row between wrap mb">
            <div className="row">
              <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><Icon name="back" /></button>
              <button className="btn sm" onClick={() => setWeekStart(startOfWeek(new Date(), getSettings().weekStartsMonday))}>This week</button>
              <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><Icon name="chevron" /></button>
              <b style={{ marginLeft: 6 }}>{weekLabel}</b>
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

          {view === 'week' ? (
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
                        <SessionChip key={s.id} s={s} iso={iso} onOpen={() => setEditing({ session: s, date: iso })} />
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
            <ListView sessions={sessions.filter((s) => !subjectFilter || s.subject === subjectFilter)} onOpen={(s, date) => setEditing({ session: s, date })} />
          )}
        </>
      )}

      {editing && tt && (
        <SessionModal timetableId={tt.id} session={editing.session} date={editing.date || todayIso} subjects={subjects} onClose={() => setEditing(null)} />
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

function SessionChip({ s, iso, onOpen }: { s: Session; iso: string; onOpen: () => void }) {
  const done = isDone(s, iso);
  const note = occNote(s, iso) || s.notes;
  return (
    <div className={`session ${done ? 'done' : ''}`} style={{ ['--c' as string]: subjectColor(s.subject) }} onClick={onOpen}>
      <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()} onChange={(e) => setDone(s, iso, e.target.checked)} aria-label="Completed" />
      <div className="grow">
        <div className="s-time">{s.start}–{s.end}</div>
        <div className="s-title">{s.subject || 'Untitled'}</div>
        {s.topic && <div className="s-topic">{s.topic}</div>}
        {note && <div className="s-note">📝 {note.length > 40 ? note.slice(0, 40) + '…' : note}</div>}
      </div>
    </div>
  );
}

function ListView({ sessions, onOpen }: { sessions: Session[]; onOpen: (s: Session, date: string) => void }) {
  const [showPast, setShowPast] = useState(false);
  const today = isoDate();
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
                <span className="grow"><b>{s.subject}</b> {s.topic && <span className="muted">· {s.topic}</span>}</span>
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
                <span className="grow" style={{ textDecoration: isDone(s, date) ? 'line-through' : undefined }}>
                  <b>{s.subject}</b> {s.topic && <span className="muted">· {s.topic}</span>}
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

function SessionModal({ timetableId, session, date, subjects, onClose }: { timetableId: string; session: Session | null; date: string; subjects: string[]; onClose: () => void }) {
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
  const set = (p: Partial<Session>) => setS((x) => ({ ...x, ...p }));

  const save = () => {
    if (timeToMin(s.end) <= timeToMin(s.start)) return toast('End time must be after start time');
    const rec: Session = {
      ...s,
      date: repeat === 'once' ? s.date || date : null,
      weekday: repeat === 'weekly' ? s.weekday ?? (parseIso(s.date || date).getDay() + 6) % 7 : null,
      log: { ...s.log, [date]: { ...s.log?.[date], note: occ || undefined, done } },
    };
    put(rec);
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New session' : 'Session'}
      onClose={onClose}
      footer={
        <>
          {!isNew && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { if (confirm('Delete this session?')) { remove('session', s.id); onClose(); } }}><Icon name="trash" /> Delete</button>}
          {!isNew && <button className="btn" onClick={() => { put({ ...s, id: uid(), log: {} }); toast('Duplicated'); onClose(); }}><Icon name="copy" /> Duplicate</button>}
          <button className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
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
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
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
        <label className="field">Notes (all occurrences)
          <textarea value={s.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Resources, past papers, page numbers…" />
        </label>
        <div className="panel pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <b className="small">{parseIso(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</b>
            <label className="check"><input type="checkbox" checked={done} onChange={(e) => setDoneLocal(e.target.checked)} /> Completed</label>
          </div>
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
                        <td><input type="text" value={p.subject} onChange={(e) => ed({ subject: e.target.value })} style={{ padding: '4px 8px', fontSize: 13 }} /></td>
                        <td><input type="text" value={p.topic} onChange={(e) => ed({ topic: e.target.value })} style={{ padding: '4px 8px', fontSize: 13 }} /></td>
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
