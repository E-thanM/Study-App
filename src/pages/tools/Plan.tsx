import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, Seg, TopBar, toast } from '../../components/ui';
import { sameSubject, studyToday } from '../../lib/goals';
import {
  BIO_TOPICS, DATE_LABELS, DEFAULT_DATES, LANG_SKILLS, MIX_LATER, MIX_NOW, NOVEMBER_HOURS, RESOURCE_MIX, SESSION_TYPES, SUBJECT_PLANS,
  addExamsToCalendar, daysBetween, examsInCalendar, getPlan, isOnTest, mixPeriod, novemberDays, phaseOn, phaseTasks, phases,
  novemberSchedule, priority, savePlan, sessionSplit, sprintEnd, subjectHours, topicChecklist, weeks, type PlanDates, type Task,
} from '../../lib/plan';
import { deckCounts } from '../../lib/collection';
import { CHECKLIST, NOT_ON_TEST, NOV_DECK_ID, syncNovemberSection } from '../../lib/novtest';
import { subjectStrengths } from '../../lib/strength';
import { get, useAll, useRec } from '../../lib/store';
import { durationMin, sessionsOn } from '../../lib/timetable';
import { addDays, isoDate, parseIso, subjectColor, weekdayMon } from '../../lib/util';
import { Dots } from './Strengths';
import './tools.css';
import './plan.css';

type Tab = 'today' | 'november' | 'mix' | 'subjects' | 'weeks' | 'dates';

const MIX_COLORS = ['#8e8ea0', 'var(--accent)', '#d1913a', '#4e9f6f', '#b05ba8'];
const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => parseIso(iso).toLocaleDateString('en-GB', opts);
const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`);

function TaskRow({ t }: { t: Task }) {
  const body = <span className="grow small">{t.text}{t.min ? <span className="faint tiny"> · {t.min} min</span> : null}</span>;
  return t.to ? (
    <Link to={t.to} className="list-row link plan-task">{body}<Icon name="chevron" size={16} /></Link>
  ) : (
    <div className="list-row plan-task">{body}</div>
  );
}

/** The study plan from the spreadsheet, live: today's tasks, the November tests sprint, resource mixes and weekly targets. */
export function PlanPage() {
  useRec('plan', 'plan');
  const plan = getPlan();
  const d = plan.dates;
  const today = studyToday();
  const phase = phaseOn(d, today);
  const [tab, setTab] = useState<Tab>('today');
  useEffect(() => { void syncNovemberSection(today, sprintEnd(d)); }, [today, d.bio, d.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const countdowns = [
    { label: 'Biology test', date: d.bio },
    { label: 'English Language test', date: d.lang },
    { label: 'Mocks', date: d.mocks },
    { label: 'Exams', date: d.exams },
  ].filter((c) => c.date >= today).slice(0, 3);

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Study plan' }]} />
      <div className="page-head">
        <div>
          <h1>Study plan</h1>
          <div className="sub">What to revise, with which resource and when – from now to the summer exams. Dates are editable under Dates.</div>
        </div>
      </div>

      <section className="panel pad plan-phase mb">
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <div className="muted tiny upper">Phase {phase.n} · {fmtDay(phase.start, { day: 'numeric', month: 'short' })} – {fmtDay(phase.end, { day: 'numeric', month: 'short' })}</div>
            <h2 style={{ margin: '2px 0 4px' }}>{phase.name}</h2>
            <div className="small muted">{phase.goal}</div>
          </div>
          <div className="plan-counts">
            {countdowns.map((c) => (
              <div key={c.label} className="plan-count">
                <b>{Math.max(0, daysBetween(today, c.date))}</b>
                <span className="tiny muted">{daysBetween(today, c.date) === 1 ? 'day' : 'days'} to {c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <PhaseBar today={today} dates={d} />
      </section>

      <div className="plan-tabs mb">
        <Seg value={tab} onChange={setTab} options={[
          { value: 'today', label: 'Today' },
          { value: 'november', label: 'November tests' },
          { value: 'mix', label: 'Resource mix' },
          { value: 'subjects', label: 'Subjects' },
          { value: 'weeks', label: 'Weeks' },
          { value: 'dates', label: 'Dates' },
        ]} />
      </div>

      {tab === 'today' && <TodayTab today={today} />}
      {tab === 'november' && <NovemberTab today={today} />}
      {tab === 'mix' && <MixTab today={today} />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'weeks' && <WeeksTab today={today} />}
      {tab === 'dates' && <DatesTab />}
    </>
  );
}

function PhaseBar({ today, dates }: { today: string; dates: PlanDates }) {
  const ps = phases(dates);
  const total = Math.max(1, daysBetween(dates.start, dates.end) + 1);
  const at = Math.min(100, Math.max(0, (daysBetween(dates.start, today) / total) * 100));
  return (
    <div className="plan-bar" aria-hidden>
      {ps.map((p) => (
        <div key={p.id} className={`plan-bar-seg ${p.start <= today && today <= p.end ? 'on' : ''}`} style={{ flexGrow: Math.max(1, daysBetween(p.start, p.end) + 1) }} title={`${p.name}: ${fmtDay(p.start)} – ${fmtDay(p.end)}`}>
          <span>{p.n}</span>
        </div>
      ))}
      <i style={{ left: `${at}%` }} />
    </div>
  );
}

/* ───────────── Biology topics in priority order ───────────── */

function useBioTopics() {
  const plan = getPlan();
  const decks = useAll('deck');
  const cards = useAll('card');
  const logs = useAll('revlog');
  const blurts = useAll('blurt');
  const bio = useMemo(() => subjectStrengths(decks, cards, logs).find((s) => sameSubject(s.name, 'Biology')), [decks, cards, logs]);
  const lastBlurt = (topic: string) => {
    const b = blurts.filter((x) => sameSubject(x.subject, 'Biology') && (x.topic === topic || x.topic.startsWith(`${topic} – `))).sort((a, c) => c.date - a.date)[0];
    return b ? Math.round(((b.covered || 0) / Math.max(1, b.total || 1)) * 100) : null;
  };
  const rows = (bio ? bio.topics.map((t) => ({ name: t.name, deckId: t.deckId, confidence: t.confidence, score: t.score })) : BIO_TOPICS.map((name) => ({ name, deckId: '', confidence: 1 as const, score: 0 })))
    .map((t) => ({ ...t, on: isOnTest(plan, t.name), blurt: lastBlurt(t.name), check: topicChecklist(plan, t.name) }))
    .map((t) => ({ ...t, priority: priority(t.on, t.confidence, t.check.ratings) }))
    .sort((a, b) => b.priority - a.priority || a.score - b.score);
  return { rows, hasDeck: !!bio };
}

/** The sprint schedule with topics assigned in priority order from today. */
function useSchedule(today: string) {
  const { rows } = useBioTopics();
  const d = getPlan().dates;
  const order = rows.filter((r) => r.on).map((r) => r.name).join('\u0001');
  return useMemo(() => novemberSchedule(d, order ? order.split('\u0001') : [], today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, today, JSON.stringify(d)]);
}

/* ───────────── Today ───────────── */

function TodayTab({ today }: { today: string }) {
  const plan = getPlan();
  const d = plan.dates;
  const phase = phaseOn(d, today);
  const schedule = useSchedule(today);
  const nov = schedule.get(today) || null;
  const tasks = nov ? nov.main : phaseTasks(phase, d, today);
  const done = plan.daysDone.includes(today);
  useAll('session');
  const sessions = sessionsOn(today);
  const period = mixPeriod(phase);
  const decks = useAll('deck');
  const cards = useAll('card');
  const logs = useAll('revlog');
  const weakest = useMemo(() => {
    const subjects = subjectStrengths(decks, cards, logs);
    let ts = subjects.flatMap((s) => s.topics.map((t) => ({ ...t, subject: s.name }))).filter((t) => t.studied > 0);
    // during the November sprint, Biology topics on the test come first
    if (nov) {
      const bio = ts.filter((t) => sameSubject(t.subject, 'Biology') && isOnTest(plan, t.name));
      if (bio.length) ts = bio;
    }
    return ts.sort((a, b) => a.score - b.score).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks, cards, logs, !!nov, plan.onTest]);

  const toggleDay = () => savePlan({ daysDone: done ? plan.daysDone.filter((x) => x !== today) : [...plan.daysDone, today] });

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="panel">
        <div className="panel-head">
          <h3>{fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}{nov?.label ? ` · ${nov.label}` : ''}</h3>
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={done} onChange={toggleDay} /> Done</label>
        </div>
        <div className="list">
          {tasks.map((t, i) => <TaskRow key={i} t={t} />)}
        </div>
        {nov && nov.extra.length > 0 && (
          <>
            <div className="list-row muted tiny upper" style={{ paddingTop: 12 }}>Weekend extra sessions</div>
            <div className="list">{nov.extra.map((t, i) => <TaskRow key={i} t={t} />)}</div>
          </>
        )}
      </section>

      {sessions.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>Your timetable today</h3><Link to="/timetable" className="small" style={{ color: 'var(--accent)' }}>Timetable</Link></div>
          <div className="list">
            {sessions.map((s) => {
              const row = RESOURCE_MIX.find((r) => sameSubject(s.subject, r.subject));
              const mins = durationMin(s);
              return (
                <div key={s.id} className="list-row col" style={{ alignItems: 'stretch', gap: 6 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dot" style={{ background: subjectColor(s.subject) }} />
                    <b className="grow small">{s.subject}{s.topic && <span className="muted"> · {s.topic}</span>}</b>
                    <span className="muted tiny nowrap">{s.start}–{s.end}</span>
                  </div>
                  {row && mins > 0 ? (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {sessionSplit(row, period, mins).map((x) => (
                        x.to ? <Link key={x.label} to={x.to} className="pill accent">{x.minutes} min · {x.label}</Link> : <span key={x.label} className="pill">{x.minutes} min · {x.label}</span>
                      ))}
                    </div>
                  ) : <span className="faint tiny">No resource mix for this subject.</span>}
                </div>
              );
            })}
          </div>
          <div className="tiny faint" style={{ padding: '8px 18px 12px' }}>Split from the subject's main resource mix for this phase – see Resource mix for other topic types.</div>
        </section>
      )}

      {weakest.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>{nov ? 'Biology: revise these first' : 'Weakest topics'}</h3><Link to="/tools/strengths" className="small" style={{ color: 'var(--accent)' }}>All topics</Link></div>
          <div className="list">
            {weakest.map((t) => (
              <div key={t.deckId} className="list-row">
                <span className="grow ellipsis small"><b>{t.subject}</b> · {t.name}</span>
                <Dots n={t.confidence} />
                <Link to={`/tools/blurt?subject=${encodeURIComponent(t.subject)}&topic=${encodeURIComponent(t.name)}`} className="btn sm ghost">Blurt</Link>
                <Link to={`/cards/deck/${t.deckId}`} className="btn sm ghost">Study</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel pad small">
        <b>Every day:</b> clear all your due flashcards first (25–40 min), then follow the tasks above. 40-minute sessions with short breaks; 8–9 hours' sleep.
        <span className="muted"> Test yourself rather than rereading, space it out, and turn every lost mark into a flashcard.</span>
      </section>
    </div>
  );
}

/* ───────────── November tests ───────────── */

function NovemberTab({ today }: { today: string }) {
  const plan = getPlan();
  const d = plan.dates;
  const nav = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const { rows, hasDeck } = useBioTopics();
  const schedule = useSchedule(today);
  const onCount = rows.filter((r) => r.on).length;
  const toggle = (name: string, on: boolean) => savePlan({ onTest: { ...plan.onTest, [name]: on } });
  const novDeck = useRec('deck', NOV_DECK_ID);
  useAll('card');
  const counts = novDeck && !novDeck.deleted ? deckCounts(NOV_DECK_ID) : null;
  const studyCards = async () => {
    await syncNovemberSection(today, sprintEnd(d));
    const deck = get('deck', NOV_DECK_ID);
    if (!deck || deck.deleted) { toast(deck ? 'You removed the November test deck' : 'Add the Biology deck in Flashcards first'); return; }
    nav(`/cards/deck/${NOV_DECK_ID}`);
  };

  const skill = (id: string) => plan.skills[id] || { done: 0 };
  const setSkill = (id: string, ch: Partial<{ done: number; last: number | null; outOf: number }>) => savePlan({ skills: { ...plan.skills, [id]: { ...skill(id), ...ch } } });

  const days = novemberDays(d);
  const shown = showAll ? days : days.filter((x) => x >= today).slice(0, 7);

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="panel pad">
        <div className="row between wrap" style={{ gap: 12 }}>
          <div className="small">
            <b>Biology</b> {fmtDay(d.bio)} ({inDays(daysBetween(today, d.bio))}) · <b>English Language</b> {fmtDay(d.lang)} ({inDays(daysBetween(today, d.lang))})
            <div className="muted tiny">Biology: every statement on your Year 9–10 checklist – all of the course except stem cells, the nervous system / eye / plant responses, inheritance, and selective breeding / GM / cloning. Everything else is on flashcards only until the tests.</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {NOVEMBER_HOURS.map((h) => <span key={h.subject} className="pill">{h.subject}: {h.hours} h/week</span>)}
          </div>
        </div>
      </section>

      <section className="panel pad row between wrap" style={{ gap: 12 }}>
        <div className="small">
          <b>Flashcards → {NOV_DECK_ID && 'November test – Biology'}</b>
          <div className="muted tiny">{counts ? <>{counts.review + counts.learn} due · {counts.new} new – only the cards on your checklist. They go back to the Biology deck after the test.</> : 'Gathers just the Biology cards on your checklist into their own deck.'}</div>
        </div>
        <button className="btn primary" onClick={() => void studyCards()}><Icon name="cards" /> Study November test cards</button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Biology topics – revise in this order</h3>
          <span className="muted tiny">{onCount} on the test</span>
        </div>
        <div className="list">
          {rows.map((t) => (
            <div key={t.name} className={`list-row plan-topic ${t.priority >= 4 ? 'hot' : ''} ${t.on ? '' : 'off'}`}>
              <label className="row" style={{ gap: 8, cursor: 'pointer', minWidth: 0, flex: 1 }} title="On the test?">
                <input type="checkbox" checked={t.on} onChange={(e) => toggle(t.name, e.target.checked)} />
                <span className="col" style={{ minWidth: 0, gap: 1 }}>
                  <span className="ellipsis small">{t.name}</span>
                  {(NOT_ON_TEST[t.name] || t.check.total > 0) && <span className="tiny faint ellipsis">{t.check.total > 0 && `${t.check.green}/${t.check.total} statements green`}{t.check.total > 0 && NOT_ON_TEST[t.name] ? ' · ' : ''}{NOT_ON_TEST[t.name]}</span>}
                </span>
              </label>
              <Dots n={t.confidence} />
              <span className="tiny muted nowrap hide-sm" style={{ width: 62, textAlign: 'right' }}>{t.blurt === null ? 'no blurt' : `blurt ${t.blurt}%`}</span>
              {t.on && <Link to={`/tools/blurt?subject=Biology&topic=${encodeURIComponent(t.name)}`} className="btn sm ghost">Blurt</Link>}
            </div>
          ))}
        </div>
        <div className="tiny faint" style={{ padding: '8px 18px 12px' }}>
          From your checklist. Priority combines your flashcard confidence with how you rated the checklist statements below; orange = revise first. Blurt each topic, learn the gaps, then do its SME / PMT questions.
          {!hasDeck && ' Add the Biology starter deck in Flashcards to get confidence ratings.'}
        </div>
      </section>

      <ChecklistPanel />

      <section className="panel">
        <div className="panel-head"><h3>English Language skills</h3><Link to="/tools/mark" className="small" style={{ color: 'var(--accent)' }}>Mark my answer</Link></div>
        <div className="list">
          {LANG_SKILLS.map((s) => {
            const v = skill(s.id);
            const outOf = v.outOf ?? s.outOf;
            const pct = v.last != null && outOf ? Math.round((v.last / outOf) * 100) : null;
            return (
              <div key={s.id} className="list-row col" style={{ alignItems: 'stretch', gap: 6 }}>
                <div className="row between wrap" style={{ gap: 8 }}>
                  <b className="small">{s.name}</b>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="tiny muted">Done</span>
                    <button className="btn sm ghost icon" aria-label="One fewer" onClick={() => setSkill(s.id, { done: Math.max(0, v.done - 1) })}>−</button>
                    <b className="small" style={{ minWidth: 16, textAlign: 'center' }}>{v.done}</b>
                    <button className="btn sm ghost icon" aria-label="One more" onClick={() => setSkill(s.id, { done: v.done + 1 })}><Icon name="plus" size={14} /></button>
                    <span className="tiny muted" style={{ marginLeft: 6 }}>Last</span>
                    <input className="plan-num" type="number" min={0} value={v.last ?? ''} onChange={(e) => setSkill(s.id, { last: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Last mark" />
                    <span className="tiny muted">/</span>
                    <input className="plan-num" type="number" min={1} value={outOf} onChange={(e) => setSkill(s.id, { outOf: Number(e.target.value) || s.outOf })} aria-label="Out of" />
                    {pct !== null && <span className={`pill ${pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'bad'}`}>{pct}%</span>}
                  </div>
                </div>
                <span className="tiny muted">{s.how}</span>
              </div>
            );
          })}
        </div>
        <div className="tiny faint" style={{ padding: '8px 18px 12px' }}>Assumes Edexcel IGCSE English Language A (4EA1) – the question types are built into Mark my answer. Marks out of are a guide; change them to match your test.</div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Day by day</h3>
          <button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Next 7 days' : `All ${days.length} days`}</button>
        </div>
        <div className="list">
          {shown.map((day) => {
            const p = schedule.get(day)!;
            const done = plan.daysDone.includes(day);
            return (
              <div key={day} className={`list-row col plan-day ${day === today ? 'today' : ''} ${done ? 'done' : ''}`} style={{ alignItems: 'stretch', gap: 4 }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={done} onChange={() => savePlan({ daysDone: done ? plan.daysDone.filter((x) => x !== day) : [...plan.daysDone, day] })} />
                  <b className="small grow">{fmtDay(day)}{day === today ? ' · today' : ''}{p.label ? ` · ${p.label}` : ''}</b>
                  {daysBetween(day, d.bio) > 0 && <span className="tiny muted nowrap">{daysBetween(day, d.bio)}d to Biology</span>}
                </label>
                <ol className="small plan-ol">
                  {p.main.map((t, i) => <li key={i}>{t.to ? <Link to={t.to}>{t.text}</Link> : t.text}</li>)}
                  {p.extra.map((t, i) => <li key={`x${i}`} className="muted">{t.to ? <Link to={t.to}>{t.text}</Link> : t.text}</li>)}
                </ol>
              </div>
            );
          })}
          {!shown.length && <div className="list-row muted small">The November tests are over – the plan has moved on to January mocks.</div>}
        </div>
      </section>
    </div>
  );
}

const FACES: { v: 1 | 2 | 3; label: string; title: string; cls: string }[] = [
  { v: 1, label: '☺', title: 'I could answer an exam question on this now', cls: 'good' },
  { v: 2, label: '😐', title: 'I know some of this but have gaps', cls: 'warn' },
  { v: 3, label: '☹', title: 'I need to learn this', cls: 'bad' },
];

/** The school's Year 9–10 checklist: rate every statement, like the content audit sheet. */
function ChecklistPanel() {
  const plan = getPlan();
  const [open, setOpen] = useState<string | null>(null);
  const topics = [...new Set(CHECKLIST.map((c) => c[1]))];
  const r = Object.values(plan.checklist);
  const n = { green: r.filter((x) => x === 1).length, amber: r.filter((x) => x === 2).length, red: r.filter((x) => x === 3).length };
  const rate = (spec: string, v: 1 | 2 | 3) => {
    const next = { ...plan.checklist };
    if (next[spec] === v) delete next[spec];
    else next[spec] = v;
    savePlan({ checklist: next });
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Biology checklist</h3>
        <span className="row tiny" style={{ gap: 6 }}>
          <span className="pill good">{n.green}</span><span className="pill warn">{n.amber}</span><span className="pill bad">{n.red}</span>
          <span className="muted">of {CHECKLIST.length}</span>
        </span>
      </div>
      <div className="list">
        {topics.map((t) => {
          const c = topicChecklist(plan, t);
          const isOpen = open === t;
          return (
            <div key={t} className="col" style={{ alignItems: 'stretch' }}>
              <button className="list-row link plan-check-head" onClick={() => setOpen(isOpen ? null : t)} aria-expanded={isOpen}>
                <span className="grow small" style={{ textAlign: 'left' }}><b>{t}</b></span>
                <span className="plan-check-bar" aria-label={`${c.green} green, ${c.amber} amber, ${c.red} red of ${c.total}`}>
                  <i className="good" style={{ flexGrow: c.green }} /><i className="warn" style={{ flexGrow: c.amber }} /><i className="bad" style={{ flexGrow: c.red }} /><i style={{ flexGrow: c.total - c.green - c.amber - c.red }} />
                </span>
                <span className="tiny muted nowrap" style={{ width: 40, textAlign: 'right' }}>{c.green}/{c.total}</span>
                <Icon name="chevron" size={14} className={isOpen ? 'rot90' : ''} />
              </button>
              {isOpen && CHECKLIST.filter((x) => x[1] === t).map(([spec, , text]) => (
                <div key={spec} className="list-row plan-check-row">
                  <span className="tiny muted nowrap" style={{ width: 40 }}>{spec}</span>
                  <span className="grow small">{text}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {FACES.map((f) => (
                      <button key={f.v} className={`plan-face ${plan.checklist[spec] === f.v ? `on ${f.cls}` : ''}`} title={f.title} aria-label={f.title} aria-pressed={plan.checklist[spec] === f.v} onClick={() => rate(spec, f.v)}>{f.label}</button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="tiny faint" style={{ padding: '8px 18px 12px' }}>☺ could answer an exam question now · 😐 know some, with gaps · ☹ need to learn it. Rate honestly after blurting a topic – the topic order and the day-by-day plan update from your ratings.</div>
    </section>
  );
}

/* ───────────── Resource mix ───────────── */

function MixTab({ today }: { today: string }) {
  const phase = phaseOn(getPlan().dates, today);
  const [period, setPeriod] = useState<'now' | 'later'>(mixPeriod(phase));
  const subjects = [...new Set(RESOURCE_MIX.map((r) => r.subject))];
  const [subject, setSubject] = useState('');
  const labels = period === 'now' ? MIX_NOW : MIX_LATER;
  const rows = RESOURCE_MIX.filter((r) => !subject || r.subject === subject);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap" style={{ gap: 10 }}>
        <Seg value={period} onChange={setPeriod} options={[{ value: 'now', label: 'Now → mocks' }, { value: 'later', label: 'Mocks → exams' }]} />
        <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="row wrap plan-legend">
        {labels.map((l, i) => <span key={l} className="tiny"><i style={{ background: MIX_COLORS[i] }} />{l}</span>)}
      </div>
      {rows.map((r) => {
        const pcts = period === 'now' ? r.now : r.later;
        return (
          <section key={r.subject + r.type} className="panel pad col" style={{ gap: 8 }}>
            <div className="row between wrap" style={{ gap: 6 }}>
              <b>{r.subject} <span className="muted">· {r.type}</span></b>
              <span className="tiny faint">{r.examples}</span>
            </div>
            <div className="plan-mix">
              {pcts.map((p, i) => p > 0 && <div key={i} style={{ flexGrow: p, background: MIX_COLORS[i] }} title={`${labels[i]} ${p}%`}>{p >= 10 ? `${p}%` : ''}</div>)}
            </div>
            <div className="tiny muted">{pcts.map((p, i) => (p ? `${labels[i]} ${p}%` : '')).filter(Boolean).join(' · ')}</div>
            <div className="small"><b>Resources:</b> {r.resources}</div>
            <div className="small"><b>Full marks:</b> {r.tip}</div>
          </section>
        );
      })}
      <p className="tiny muted">SME = Save My Exams · PMT = Physics &amp; Maths Tutor (free topic questions and past papers). In the app: Flashcards, Blurting, Past papers (mistakes log → flashcards) and Mark my answer.</p>
    </div>
  );
}

/* ───────────── Subjects ───────────── */

const WEIGHTS = [{ v: 3, l: 'High' }, { v: 2, l: 'Medium' }, { v: 1.5, l: 'Low' }];

function SubjectsTab() {
  const plan = getPlan();
  const hours = subjectHours(plan.hours, plan.weights);
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="panel pad row between wrap" style={{ gap: 10 }}>
        <label className="row small" style={{ gap: 8 }}>Study hours per week
          <input className="plan-num" type="number" min={1} max={80} value={plan.hours} onChange={(e) => savePlan({ hours: Math.max(1, Number(e.target.value) || 16) })} />
        </label>
        <span className="tiny muted">From your timetable: 2 h Mon–Thu + 4 h Sat and Sun. Daily flashcards are on top.</span>
      </section>
      {SUBJECT_PLANS.map((s) => {
        const h = hours.find((x) => x.subject === s.subject)!;
        return (
          <section key={s.subject} className="panel pad col" style={{ gap: 6 }}>
            <div className="row between wrap" style={{ gap: 8 }}>
              <b className="row" style={{ gap: 8 }}><span className="dot" style={{ background: subjectColor(s.subject) }} />{s.subject}</b>
              <div className="row" style={{ gap: 8 }}>
                <select value={String(h.weight)} onChange={(e) => savePlan({ weights: { ...plan.weights, [s.subject]: Number(e.target.value) } })} aria-label="Priority">
                  {WEIGHTS.map((w) => <option key={w.v} value={String(w.v)}>{w.l} priority</option>)}
                </select>
                <span className="pill accent">{h.hours.toFixed(1)} h/week</span>
              </div>
            </div>
            <div className="tiny muted">{s.board}</div>
            <div className="small"><b>Full marks needs:</b> {s.demands}</div>
            <div className="small"><b>Best resources:</b> {s.resources}</div>
            <div className="small"><b>Traps:</b> {s.traps}</div>
            <div className="tiny muted">Target: mocks {s.mock} · final {s.final}</div>
          </section>
        );
      })}
      <section className="panel">
        <div className="panel-head"><h3>What to do in a 40-minute session</h3></div>
        <div className="list">
          {SESSION_TYPES.map((t) => (
            <div key={t.type} className="list-row col" style={{ alignItems: 'stretch', gap: 3 }}>
              <b className="small">{t.type} <span className="muted tiny">· {t.when}</span></b>
              <span className="small"><span className="faint">0–5</span> {t.start} · <span className="faint">5–30</span> {t.middle} · <span className="faint">30–40</span> {t.end}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ───────────── Weeks ───────────── */

function WeeksTab({ today }: { today: string }) {
  const plan = getPlan();
  const ws = weeks(plan.dates);
  const thisWeek = isoDate(addDays(parseIso(today), -weekdayMon(parseIso(today))));
  const [showPast, setShowPast] = useState(false);
  const shown = showPast ? ws : ws.filter((w) => w.start >= thisWeek);
  const done = plan.weeksDone.length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Week by week <span className="muted tiny">· {done} of {ws.length} done</span></h3>
        <button className="btn sm ghost" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past weeks' : 'Show past weeks'}</button>
      </div>
      <div className="list">
        {shown.map((w) => {
          const isDone = plan.weeksDone.includes(w.start);
          return (
            <div key={w.start} className={`list-row col plan-day ${w.start === thisWeek ? 'today' : ''} ${isDone ? 'done' : ''}`} style={{ alignItems: 'stretch', gap: 4 }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={isDone} onChange={() => savePlan({ weeksDone: isDone ? plan.weeksDone.filter((x) => x !== w.start) : [...plan.weeksDone, w.start] })} />
                <b className="small grow">Week {w.n} · {fmtDay(w.start, { day: 'numeric', month: 'short' })}{w.start === thisWeek ? ' · this week' : ''}</b>
                <span className="pill">{w.phase.name}</span>
              </label>
              <span className="small">{w.focus}</span>
              <span className="tiny muted">Flashcards: {w.flashcards} · {w.blurts} blurts · {w.topicSets} topic question sets · {w.papers} timed papers / essays</span>
            </div>
          );
        })}
      </div>
      <div className="tiny faint" style={{ padding: '8px 18px 12px' }}>Every Sunday: check Strengths &amp; weaknesses, pick next week's weakest topics, tick the week off and reschedule missed sessions in the Timetable.</div>
    </section>
  );
}

/* ───────────── Dates ───────────── */

function DatesTab() {
  const plan = getPlan();
  useAll('target');
  const inCal = examsInCalendar(plan.dates);
  const setDate = (k: keyof PlanDates, v: string) => {
    if (!v) return;
    savePlan({ dates: { ...plan.dates, [k]: v } });
  };
  const order = DATE_LABELS.map(([k]) => plan.dates[k]);
  const outOfOrder = order.some((x, i) => i > 0 && x < order[i - 1]);
  return (
    <section className="panel pad col" style={{ gap: 14 }}>
      <div className="small muted">The November test dates were assumed (Mon 2 / Tue 3 Nov), as were mocks w/c 4 Jan and exams mid-May to mid-June. Change them to your real dates – the phases, day-by-day plan and weeks all move with them.</div>
      <div className="form-grid">
        {DATE_LABELS.map(([k, label]) => (
          <label key={k} className="field">{label}
            <input type="date" value={plan.dates[k]} onChange={(e) => setDate(k, e.target.value)} />
          </label>
        ))}
      </div>
      {outOfOrder && <div className="callout warn small">These dates aren't in order – each should be on or after the one before it.</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" disabled={inCal} onClick={() => { const n = addExamsToCalendar(plan.dates); toast(n ? `Added ${n} dates to your calendar` : 'Already in your calendar'); }}>
          <Icon name="calendar" /> {inCal ? 'In your calendar' : 'Add tests and mocks to the calendar'}
        </button>
        <button className="btn ghost" onClick={() => { savePlan({ dates: { ...DEFAULT_DATES } }); toast('Dates reset'); }}>Reset to the original dates</button>
      </div>
      <div className="tiny faint">Calendar dates added from here move automatically when you change them above, and the next one shows as a countdown on the home page.</div>
    </section>
  );
}
