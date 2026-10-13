import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon, TopBar } from '../components/ui';
import { childDecks, deckCounts } from '../lib/collection';
import { getSettings } from '../lib/seed';
import { activityByDay, streak, weekMs } from '../lib/stats';
import { useAll, useVersion } from '../lib/store';
import { useSyncStatus } from '../lib/sync';
import { isDone, sessionsOn, setDone } from '../lib/timetable';
import { HOUR, fmtHours, isoDate, parseIso, subjectColor } from '../lib/util';

const DAY_LETTERS_MON = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LETTERS_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function Home() {
  const v = useVersion('revlog', 'studylog', 'session', 'card', 'deck', 'target', 'set', 'settings');
  const targets = useAll('target');
  const sets = useAll('set');
  const settings = getSettings();

  const data = useMemo(() => {
    const act = activityByDay();
    const st = streak(act);
    const wk = weekMs(act);
    let due = 0, newC = 0;
    for (const d of childDecks(null)) {
      const c = deckCounts(d.id);
      due += c.review + c.learn;
      newC += c.new;
    }
    const today = isoDate();
    const todaySessions = sessionsOn(today);
    return { st, wk, due, newC, today, todaySessions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  const nextTarget = useMemo(() => {
    const today = isoDate();
    return targets.filter((t) => t.date >= today && !t.done).sort((a, b) => a.date.localeCompare(b.date))[0];
  }, [targets]);
  const nextExam = useMemo(() => {
    const today = isoDate();
    return targets.filter((t) => t.type === 'exam' && t.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  }, [targets]);
  const daysUntil = (iso: string) => Math.round((parseIso(iso).getTime() - parseIso(isoDate()).getTime()) / 86400000);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const doneToday = data.todaySessions.filter((s) => isDone(s, data.today)).length;
  const maxDay = Math.max(...data.wk.perDay, 1);
  const todayIdx = settings.weekStartsMonday ? (new Date().getDay() + 6) % 7 : new Date().getDay();
  const DAY_LETTERS = settings.weekStartsMonday ? DAY_LETTERS_MON : DAY_LETTERS_SUN;
  const goalMs = settings.weeklyGoalHours * HOUR;
  const sync = useSyncStatus();
  const lastSet = [...sets].sort((a, b) => (b.lastStudied || b.createdAt) - (a.lastStudied || a.createdAt))[0];

  return (
    <>
      <TopBar />
      {sync.configured && !sync.user && sync.state === 'signed-out' && (
        <Link to="/settings" className="callout row between mb" style={{ display: 'flex' }}>
          <span>You're signed out – sign in to see your progress.</span>
          <b>Sign in</b>
        </Link>
      )}
      <div className="hero">
        <div>
          <div className="muted small">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting}</h1>
          {nextExam && (
            <div className="muted" style={{ marginTop: 4 }}>
              {nextExam.title} in <b style={{ color: 'var(--ink)' }}>{daysUntil(nextExam.date)} days</b>
            </div>
          )}
        </div>
        <div className="stats-strip">
          <div className="stat">
            <div className="label row" style={{ gap: 5 }}><Icon name="flame" size={14} /> Streak</div>
            <div className="value">
              {data.st.current}
              <small>{data.st.current === 1 ? 'day' : 'days'}{!data.st.studiedToday && data.st.current > 0 ? ' · study today to keep it' : ''}</small>
            </div>
          </div>
          <div className="stat" style={{ minWidth: 190 }}>
            <div className="label row between">
              <span className="row" style={{ gap: 5 }}><Icon name="clock" size={14} /> This week</span>
              <span className="faint">goal {settings.weeklyGoalHours}h</span>
            </div>
            <div className="value">
              {fmtHours(data.wk.total)}
              <small>{Math.min(100, Math.round((data.wk.total / goalMs) * 100))}%</small>
            </div>
            <div className="week-bars" style={{ height: 28, marginTop: 6 }}>
              {data.wk.perDay.map((ms, i) => (
                <div key={i} className={`bar ${ms ? '' : 'zero'} ${i === todayIdx ? 'today' : ''}`} style={{ height: `${Math.max(8, (ms / maxDay) * 100)}%` }} title={fmtHours(ms)} />
              ))}
            </div>
            <div className="week-labels">{DAY_LETTERS.map((d, i) => <span key={i} style={i === todayIdx ? { color: 'var(--ink)', fontWeight: 700 } : undefined}>{d}</span>)}</div>
          </div>
        </div>
      </div>

      <nav className="tiles">
        <Link to="/timetable" className="tile">
          <Icon name="arrow" className="tile-arrow" />
          <div className="tile-icon"><Icon name="timetable" /></div>
          <div>
            <h2>Revision Timetable</h2>
            <p>Import your spreadsheet, tick off sessions and keep notes.</p>
          </div>
          <div className="tile-meta">
            {data.todaySessions.length ? <span><b>{doneToday}/{data.todaySessions.length}</b> done today</span> : <span>Nothing planned today</span>}
          </div>
        </Link>
        <Link to="/cards" className="tile">
          <Icon name="arrow" className="tile-arrow" />
          <div className="tile-icon"><Icon name="cards" /></div>
          <div>
            <h2>Long-term Flashcards</h2>
            <p>Spaced repetition (FSRS) for exam-proof memory, Anki compatible.</p>
          </div>
          <div className="tile-meta">
            <span><b className="n-review">{data.due}</b> due</span>
            <span><b className="n-new">{data.newC}</b> new</span>
          </div>
        </Link>
        <Link to="/calendar" className="tile">
          <Icon name="arrow" className="tile-arrow" />
          <div className="tile-icon"><Icon name="calendar" /></div>
          <div>
            <h2>Revision Calendar</h2>
            <p>Plan the year, set targets and check them off.</p>
          </div>
          <div className="tile-meta">
            {nextTarget ? (
              <span className="ellipsis">Next: <b>{nextTarget.title}</b> · {daysUntil(nextTarget.date) === 0 ? 'today' : `${daysUntil(nextTarget.date)}d`}</span>
            ) : (
              <span>No upcoming targets</span>
            )}
          </div>
        </Link>
        <Link to="/quick" className="tile">
          <Icon name="arrow" className="tile-arrow" />
          <div className="tile-icon"><Icon name="bolt" /></div>
          <div>
            <h2>Quick Learn</h2>
            <p>Flashcards, Learn, Test and Match for tomorrow's test.</p>
          </div>
          <div className="tile-meta">
            <span><b>{sets.length}</b> {sets.length === 1 ? 'set' : 'sets'}</span>
            {lastSet && <span className="ellipsis">Last: <b>{lastSet.title}</b></span>}
          </div>
        </Link>
      </nav>

      {data.todaySessions.length > 0 && (
        <>
          <div className="section-title">Today's sessions</div>
          <div className="panel list">
            {data.todaySessions.map((s) => {
              const done = isDone(s, data.today);
              return (
                <label key={s.id} className="list-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={done} onChange={(e) => setDone(s, data.today, e.target.checked)} />
                  <span className="dot" style={{ background: subjectColor(s.subject) }} />
                  <span className="grow" style={{ textDecoration: done ? 'line-through' : undefined, opacity: done ? 0.6 : 1 }}>
                    <b>{s.subject}</b> {s.topic && <span className="muted">· {s.topic}</span>}
                  </span>
                  <span className="muted small nowrap">{s.start}–{s.end}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

