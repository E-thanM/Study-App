import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, Modal, TopBar, useIsMobile } from '../../components/ui';
import { all, put, useAll } from '../../lib/store';
import type { PaperMistake, PastPaper } from '../../lib/types';
import { isoDate, parseIso, plural, subjectColor, uid } from '../../lib/util';
import './papers.css';

/* ───────── grades & boundaries (shared with PaperView) ───────── */

export const GRADES = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];

/** Percentage scored, or null if the paper has no score yet. */
export function pctOf(p: PastPaper): number | null {
  return p.score != null && p.max > 0 ? (p.score / p.max) * 100 : null;
}

const hasBounds = (b?: Record<string, number>) => !!b && GRADES.some((g) => b[g] != null);
const sameTitle = (a: PastPaper, b: PastPaper) =>
  a.subject.trim().toLowerCase() === b.subject.trim().toLowerCase() && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

export interface EffBounds {
  bounds: Record<string, number>;
  /** the paper the boundaries were borrowed from (scaled to this paper's max), or null if they are its own */
  from: PastPaper | null;
}

/**
 * The boundaries to grade a paper with: its own if it has any, otherwise the most recently
 * entered boundaries for the same subject + title, scaled by total marks.
 */
export function effectiveBounds(p: PastPaper, papers: PastPaper[] = all('paper')): EffBounds | null {
  if (hasBounds(p.boundaries)) return { bounds: p.boundaries!, from: null };
  const src = papers
    .filter((x) => x.id !== p.id && x.max > 0 && hasBounds(x.boundaries) && sameTitle(x, p))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
  if (!src || !(p.max > 0)) return null;
  const k = p.max / src.max;
  const bounds: Record<string, number> = {};
  for (const g of GRADES) if (src.boundaries![g] != null) bounds[g] = Math.round(src.boundaries![g] * k);
  return { bounds, from: src };
}

/** Highest grade whose boundary the score reaches: '9'…'1', 'U' below every boundary. */
export function gradeFor(score: number, bounds: Record<string, number>): string {
  return GRADES.find((g) => bounds[g] != null && score >= bounds[g]) || 'U';
}

export const gradeNum = (g: string) => (g === 'U' ? 0 : Number(g));

/** Achieved grade for a paper plus where the boundaries came from and the marks to the next grade. */
export function paperGrade(p: PastPaper, papers?: PastPaper[]) {
  if (p.score == null) return null;
  const eb = effectiveBounds(p, papers);
  if (!eb) return null;
  const grade = gradeFor(p.score, eb.bounds);
  const next = GRADES.slice(0, GRADES.indexOf(grade) === -1 ? GRADES.length : GRADES.indexOf(grade))
    .reverse()
    .find((g) => eb.bounds[g] != null);
  return { grade, from: eb.from, next: next ? { grade: next, need: eb.bounds[next] - p.score } : null };
}

/** Predicted grade = average grade of the last 3 graded papers (own or borrowed boundaries). */
function predict(list: PastPaper[], papers: PastPaper[]) {
  const graded = list
    .filter((p) => p.score != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => ({ p, g: paperGrade(p, papers) }))
    .filter((x) => x.g)
    .slice(0, 3);
  if (!graded.length) return null;
  const avg = graded.reduce((s, x) => s + gradeNum(x.g!.grade), 0) / graded.length;
  return { grade: avg < 0.5 ? 'U' : String(Math.round(avg)), avg, used: graded, borrowed: graded.filter((x) => x.g!.from).length };
}

export const fmtDate = (iso: string) =>
  iso ? parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtPct = (n: number | null) => (n == null ? '–' : `${Math.round(n)}%`);

/** Subjects from existing papers, top-level decks and timetable sessions. */
export function subjectSuggestions(): string[] {
  const seen = new Map<string, string>();
  const add = (s: string | undefined) => {
    const t = (s || '').trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  };
  all('paper').forEach((p) => add(p.subject));
  all('deck').filter((d) => !d.parentId && !d.filtered && d.name !== 'Default').forEach((d) => add(d.name));
  all('session').forEach((s) => add(s.subject));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* ───────── boundaries editor (shared with PaperView) ───────── */

export function BoundariesEditor({ value, onChange, placeholder, max }: {
  value: Record<string, number> | undefined;
  onChange: (b: Record<string, number> | undefined) => void;
  /** scaled boundaries borrowed from another sitting, shown as placeholders */
  placeholder?: Record<string, number>;
  max?: number;
}) {
  const set = (g: string, raw: string) => {
    const next = { ...(value || {}) };
    const n = parseFloat(raw);
    if (raw.trim() === '' || isNaN(n)) delete next[g];
    else next[g] = n;
    onChange(hasBounds(next) ? next : undefined);
  };
  // boundaries should fall as the grade falls – flag any that don't
  const bad = GRADES.filter((g, i) => {
    const v = value?.[g];
    if (v == null) return false;
    if (max && v > max) return true;
    const higher = GRADES.slice(0, i).map((h) => value?.[h]).filter((x): x is number => x != null);
    return higher.some((h) => h < v);
  });
  return (
    <div>
      <div className="pp-bounds">
        {GRADES.map((g) => (
          <label key={g} className={bad.includes(g) ? 'bad' : ''}>
            <span>{g}</span>
            <input
              type="text"
              inputMode="decimal"
              value={value?.[g] ?? ''}
              placeholder={placeholder?.[g] != null ? String(placeholder[g]) : '–'}
              onChange={(e) => set(g, e.target.value)}
              aria-label={`Marks for grade ${g}`}
            />
          </label>
        ))}
      </div>
      {bad.length > 0 && <div className="tiny mt-6" style={{ color: 'var(--bad)' }}>Check grade {bad.join(', ')} – boundaries should go down as the grade goes down{max ? ` and be at most ${max}` : ''}.</div>}
    </div>
  );
}

/* ───────── trend chart ───────── */

/** Single-series line chart of % over time, sized to its container. Hover/drag to read each paper. */
export function TrendChart({ points, height = 132 }: { points: { date: string; pct: number; label: string }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 320));
    ro.observe(el);
    setW(el.clientWidth || 320);
    return () => ro.disconnect();
  }, []);
  const L = 34, R = 40, T = 12, B = 22;
  const iw = Math.max(40, w - L - R), ih = height - T - B;
  const times = points.map((p) => parseIso(p.date).getTime());
  const t0 = Math.min(...times), t1 = Math.max(...times);
  // spread by date; fall back to even spacing when every paper is on the same day
  const xAt = (i: number) => (points.length === 1 ? iw / 2 : t1 > t0 ? ((times[i] - t0) / (t1 - t0)) * iw : (i / (points.length - 1)) * iw) + L;
  const yAt = (v: number) => T + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  const xy = points.map((p, i) => [xAt(i), yAt(p.pct)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = xy.length > 1 ? `${line}L${xy[xy.length - 1][0].toFixed(1)},${T + ih}L${xy[0][0].toFixed(1)},${T + ih}Z` : '';
  const short = (iso: string) => parseIso(iso).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  const last = xy.length - 1;
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = clientX - r.left;
    let best = 0;
    xy.forEach(([px], i) => { if (Math.abs(px - x) < Math.abs(xy[best][0] - x)) best = i; });
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;
  return (
    <div ref={ref} className="pp-chart" style={{ height }}>
      <svg width={w} height={height} role="img" aria-label={`Score trend: ${points.map((p) => `${fmtDate(p.date)} ${Math.round(p.pct)}%`).join(', ')}`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={L + iw} y1={yAt(v)} y2={yAt(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 8} y={yAt(v) + 4} textAnchor="end" className="pp-axis">{v}%</text>
          </g>
        ))}
        {points.length > 1 && (
          <>
            <text x={L} y={height - 6} className="pp-axis">{short(points[0].date)}</text>
            <text x={L + iw} y={height - 6} textAnchor="end" className="pp-axis">{short(points[last].date)}</text>
          </>
        )}
        {area && <path d={area} fill="var(--accent)" opacity={0.1} />}
        {xy.length > 1 && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {h && <line x1={xy[hover!][0]} x2={xy[hover!][0]} y1={T} y2={T + ih} stroke="var(--line-strong)" strokeWidth={1} />}
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={hover === i ? 6 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        {/* label the latest value only – the tooltip and the list below carry the rest */}
        <text x={xy[last][0] + 9} y={xy[last][1] + 4} className="pp-endlabel">{Math.round(points[last].pct)}%</text>
        <rect
          x={0} y={0} width={w} height={height} fill="transparent"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && (
        <div className="pp-tip" style={{ left: Math.min(Math.max(xy[hover!][0], 70), w - 70), top: Math.max(0, xy[hover!][1] - 58) }}>
          <b>{Math.round(h.pct)}%</b>
          <span>{h.label}</span>
          <span>{fmtDate(h.date)}</span>
        </div>
      )}
    </div>
  );
}

/* ───────── add paper ───────── */

function AddPaperModal({ onClose, defaultSubject }: { onClose: () => void; defaultSubject: string }) {
  const nav = useNavigate();
  const subjects = useMemo(subjectSuggestions, []);
  const [f, setF] = useState({ subject: defaultSubject, title: '', series: '', date: isoDate(), score: '', max: '' });
  const [bounds, setBounds] = useState<Record<string, number> | undefined>();
  const [showBounds, setShowBounds] = useState(false);
  const max = parseFloat(f.max);
  const score = parseFloat(f.score);
  const draft = { id: '', kind: 'paper', subject: f.subject, title: f.title, max: isNaN(max) ? 0 : max, boundaries: bounds } as PastPaper;
  const borrowed = !bounds && f.subject.trim() && f.title.trim() ? effectiveBounds(draft) : null;
  const ok = f.subject.trim() && f.title.trim() && max > 0 && (f.score.trim() === '' || (!isNaN(score) && score >= 0 && score <= max));
  const save = () => {
    if (!ok) return;
    const id = uid();
    put({
      id, kind: 'paper', subject: f.subject.trim(), title: f.title.trim(), series: f.series.trim(), date: f.date || isoDate(),
      score: f.score.trim() === '' ? null : score, max, ...(bounds ? { boundaries: bounds } : {}), notes: '', mistakes: [], createdAt: Date.now(),
    });
    onClose();
    nav(`/tools/papers/${id}`);
  };
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      title="Add a past paper"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>Add paper</button></>}
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="form-grid">
          <label className="field">Subject
            <input type="text" list="pp-subjects" value={f.subject} onChange={set('subject')} placeholder="e.g. Physics" autoFocus />
            <datalist id="pp-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="field">Paper
            <input type="text" value={f.title} onChange={set('title')} placeholder="e.g. Paper 1 Higher" />
          </label>
          <label className="field">Exam series
            <input type="text" value={f.series} onChange={set('series')} placeholder="e.g. June 2023" />
          </label>
          <label className="field">Date sat
            <input type="date" value={f.date} onChange={set('date')} />
          </label>
          <label className="field">Score <span className="hint">leave blank if not marked yet</span>
            <input type="text" inputMode="decimal" value={f.score} onChange={set('score')} placeholder="e.g. 64" />
          </label>
          <label className="field">Out of
            <input type="text" inputMode="decimal" value={f.max} onChange={set('max')} placeholder="e.g. 100" />
          </label>
        </div>
        {f.score.trim() !== '' && max > 0 && (isNaN(score) || score > max) && <div className="tiny" style={{ color: 'var(--bad)' }}>Score must be between 0 and {max}.</div>}
        {!showBounds ? (
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowBounds(true)}><Icon name="plus" /> Grade boundaries (optional)</button>
        ) : (
          <div>
            <div className="field-label">Grade boundaries <span className="faint" style={{ fontWeight: 400 }}>marks needed – fill in the ones you know</span></div>
            <BoundariesEditor value={bounds} onChange={setBounds} placeholder={borrowed?.bounds} max={max > 0 ? max : undefined} />
          </div>
        )}
        {borrowed && (
          <div className="callout tiny">
            No boundaries entered – this paper will use the {borrowed.from!.series || fmtDate(borrowed.from!.date)} boundaries for {borrowed.from!.title}
            {borrowed.from!.max !== max ? `, scaled from ${borrowed.from!.max} to ${max} marks` : ''}.
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ───────── mistakes log ───────── */

type SortKey = 'subject' | 'paper' | 'date' | 'q' | 'topic' | 'lost';
interface LogRow { m: PaperMistake; p: PastPaper }

function MistakesLog({ papers, subject }: { papers: PastPaper[]; subject: string }) {
  const nav = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const isMobile = useIsMobile();
  const rows: LogRow[] = useMemo(() => papers.flatMap((p) => p.mistakes.map((m) => ({ m, p }))), [papers]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const val = (r: LogRow): string | number => {
      switch (sort.key) {
        case 'subject': return r.p.subject.toLowerCase();
        case 'paper': return `${r.p.title} ${r.p.series}`.toLowerCase();
        case 'date': return r.p.date;
        case 'q': return r.m.q;
        case 'topic': return r.m.topic.toLowerCase();
        case 'lost': return r.m.lost || 0;
      }
    };
    return rows
      .filter((r) => !needle || [r.p.subject, r.p.title, r.m.q, r.m.topic, r.m.why, r.m.fix].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = val(a), y = val(b);
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
        return c * sort.dir || b.p.date.localeCompare(a.p.date);
      });
  }, [rows, sort, q]);

  // marks lost per topic – merged case-insensitively, and per subject when showing every subject
  const byTopic = useMemo(() => {
    const m = new Map<string, { topic: string; subject: string; lost: number; n: number }>();
    for (const { m: x, p } of rows) {
      const topic = x.topic.trim() || 'No topic';
      const key = (subject ? '' : p.subject.toLowerCase() + '|') + topic.toLowerCase();
      const cur = m.get(key) || { topic, subject: p.subject, lost: 0, n: 0 };
      cur.lost += x.lost || 0;
      cur.n++;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.lost - a.lost || b.n - a.n);
  }, [rows, subject]);
  const topMax = byTopic[0]?.lost || 1;
  const totalLost = rows.reduce((s, r) => s + (r.m.lost || 0), 0);

  if (!rows.length) {
    return (
      <div className="panel pad">
        <div className="empty">
          <h3>No mistakes logged yet</h3>
          <p>Open a paper and fill in its mistakes spreadsheet – question, topic, marks lost, what went wrong and the fix. Every mistake from every paper shows up here, so you can see which topics cost you the most marks.</p>
        </div>
      </div>
    );
  }

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls} onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'lost' || key === 'date' ? -1 : 1 })} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const topics = showAll ? byTopic : byTopic.slice(0, 8);
  return (
    <div className="col" style={{ gap: 18 }}>
      <section className="panel pad">
        <div className="row between wrap mb">
          <h3>Marks lost by topic</h3>
          <span className="muted small">{plural(totalLost, 'mark')} lost across {plural(rows.length, 'mistake')}</span>
        </div>
        <div className="pp-topics">
          {topics.map((t) => (
            <div key={t.subject + t.topic} className="pp-topic" title={`${t.topic}: ${t.lost} marks lost in ${plural(t.n, 'mistake')}`}>
              <div className="pp-topic-name">
                <span className="ellipsis">{t.topic}</span>
                {!subject && <span className="faint tiny ellipsis">{t.subject}</span>}
              </div>
              <div className="pp-topic-bar"><i style={{ width: `${Math.max(2, (t.lost / topMax) * 100)}%` }} /></div>
              <div className="pp-topic-val"><b>{t.lost}</b> <span className="faint tiny">· {t.n}×</span></div>
            </div>
          ))}
        </div>
        {byTopic.length > 8 && <button className="btn sm ghost mt-6" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show top 8' : `Show all ${byTopic.length} topics`}</button>}
      </section>

      <section className="panel">
        <div className="panel-head pp-log-head">
          <h3>All mistakes <span className="faint" style={{ fontWeight: 500 }}>{shown.length}</span></h3>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mistakes" />
          {isMobile && (
            <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); }} aria-label="Sort mistakes">
              <option value="date:-1">Newest papers first</option>
              <option value="date:1">Oldest papers first</option>
              <option value="lost:-1">Most marks lost</option>
              <option value="topic:1">Topic A–Z</option>
              <option value="subject:1">Subject A–Z</option>
              <option value="q:1">Question number</option>
            </select>
          )}
        </div>
        {isMobile ? (
          <div className="list">
            {shown.map(({ m, p }) => (
              <Link key={p.id + m.id} to={`/tools/papers/${p.id}`} className="list-row link pp-mcard">
                <div className="grow col" style={{ gap: 3 }}>
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <b style={{ overflowWrap: 'anywhere' }}>{m.q && `Q${m.q.replace(/^q/i, '')} · `}{m.topic || 'No topic'}</b>
                    <span className="pill bad" style={{ flex: 'none' }}>−{m.lost || 0}</span>
                  </div>
                  {m.why && <div className="small"><span className="muted">Wrong: </span>{m.why}</div>}
                  {m.fix && <div className="small"><span className="muted">Fix: </span>{m.fix}</div>}
                  <div className="tiny faint row" style={{ gap: 6 }}>
                    <span className="dot" style={{ background: subjectColor(p.subject) }} />
                    <span className="ellipsis">{p.subject} · {p.title}{p.series ? ` · ${p.series}` : ''}</span>
                    {m.noteId && <span className="pill good" style={{ flex: 'none' }}>✓ card</span>}
                  </div>
                </div>
              </Link>
            ))}
            {!shown.length && <div className="empty">No mistakes match “{q}”.</div>}
          </div>
        ) : (
        <div className="pp-scroll">
          <table className="tbl pp-log">
            <thead>
              <tr>
                {!subject && th('subject', 'Subject')}
                {th('paper', 'Paper')}
                {th('date', 'Date')}
                {th('q', 'Q')}
                {th('topic', 'Topic')}
                {th('lost', 'Lost', 'num')}
                <th>What went wrong</th>
                <th>Fix</th>
                <th>Card</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ m, p }) => (
                <tr key={p.id + m.id} className="pp-click" onClick={() => nav(`/tools/papers/${p.id}`)}>
                  {!subject && <td><span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: subjectColor(p.subject) }} />{p.subject}</span></td>}
                  <td className="pp-nowrap">{p.title}{p.series ? <span className="faint"> · {p.series}</span> : null}</td>
                  <td className="pp-nowrap muted">{fmtDate(p.date)}</td>
                  <td>{m.q}</td>
                  <td>{m.topic}</td>
                  <td className="num"><b>{m.lost || 0}</b></td>
                  <td className="pp-wide">{m.why}</td>
                  <td className="pp-wide">{m.fix}</td>
                  <td>{m.noteId && <span className="pill good">✓</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <div className="empty">No mistakes match “{q}”.</div>}
        </div>
        )}
      </section>
    </div>
  );
}

/* ───────── page ───────── */

export function PapersPage() {
  const papers = useAll('paper');
  useAll('deck');
  const [tab, setTab] = useState<'papers' | 'mistakes'>(() => (sessionStorage.getItem('pp-tab') as 'mistakes') || 'papers');
  const [subject, setSubject] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => { try { sessionStorage.setItem('pp-tab', tab); } catch { /* private mode */ } }, [tab]);

  const subjects = useMemo(() => {
    const m = new Map<string, PastPaper[]>();
    for (const p of papers) {
      const k = p.subject.trim() || 'Other';
      m.set(k, [...(m.get(k) || []), p]);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [papers]);
  // forget a filter whose subject no longer exists
  const sel = subjects.some(([s]) => s === subject) ? subject : '';
  const shownSubjects = sel ? subjects.filter(([s]) => s === sel) : subjects;
  const filtered = sel ? papers.filter((p) => (p.subject.trim() || 'Other') === sel) : papers;
  const mistakeCount = filtered.reduce((n, p) => n + p.mistakes.length, 0);

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Past papers' }]} />
      <div className="page-head">
        <div>
          <h1>Past papers</h1>
          <div className="sub">Log every paper you sit, track your predicted grade and learn from every mark you drop.</div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add paper</button>
        </div>
      </div>

      {!papers.length ? (
        <div className="panel pad">
          <div className="empty">
            <h3>No past papers yet</h3>
            <p>After you sit a past paper, add it here with your score (and the grade boundaries if you have them). You'll see your predicted grade and trend for each subject, and can log every mistake in a spreadsheet that turns into flashcards.</p>
            <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><Icon name="plus" /> Add your first paper</button>
          </div>
        </div>
      ) : (
        <>
          <div className="tabs">
            <button className={tab === 'papers' ? 'on' : ''} onClick={() => setTab('papers')}>Papers & grades</button>
            <button className={tab === 'mistakes' ? 'on' : ''} onClick={() => setTab('mistakes')}>Mistakes log <span className="faint">{mistakeCount}</span></button>
          </div>
          {subjects.length > 1 && (
            <div className="pill-scroll mb">
              <button className={`btn sm ${!sel ? 'primary' : ''}`} onClick={() => setSubject('')}>All subjects</button>
              {subjects.map(([s, list]) => (
                <button key={s} className={`btn sm ${sel === s ? 'primary' : ''}`} onClick={() => setSubject(s)}>
                  <span className="dot" style={{ background: subjectColor(s) }} />{s} <span className="faint">{list.length}</span>
                </button>
              ))}
            </div>
          )}
          {tab === 'papers' ? (
            <div className="col" style={{ gap: 18 }}>
              {shownSubjects.map(([s, list]) => <SubjectPanel key={s} subject={s} list={list} papers={papers} />)}
              <p className="tiny muted pp-explain">
                <b>How the predicted grade works:</b> it's the average grade of your 3 most recent marked papers that can be graded.
                A paper is graded with its own boundaries; if it has none, it borrows the most recent boundaries you entered for the same subject and paper title, scaled to its total marks (shown as e.g. “Grade 6*”).
                Papers with no boundaries to use only show a percentage.
              </p>
            </div>
          ) : (
            <MistakesLog papers={filtered} subject={sel} />
          )}
        </>
      )}
      {adding && <AddPaperModal onClose={() => setAdding(false)} defaultSubject={sel} />}
    </>
  );
}

function SubjectPanel({ subject, list, papers }: { subject: string; list: PastPaper[]; papers: PastPaper[] }) {
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const marked = sorted.filter((p) => pctOf(p) != null);
  const latest = marked[0];
  const pred = predict(list, papers);
  const points = [...marked].reverse().map((p) => ({ date: p.date, pct: pctOf(p)!, label: [p.title, p.series].filter(Boolean).join(' · ') }));
  return (
    <section className="panel pp-subject">
      <div className="panel-head">
        <h2 className="row" style={{ gap: 8, fontSize: 18, minWidth: 0 }}>
          <span className="dot" style={{ background: subjectColor(subject), width: 10, height: 10 }} />
          <span className="ellipsis">{subject}</span>
        </h2>
        <span className="muted small">{plural(list.length, 'paper')}</span>
      </div>
      <div className="pp-subject-body">
        <div className="pp-figures">
          <div className="stat">
            <div className="label">Latest</div>
            <div className="value">{fmtPct(latest ? pctOf(latest) : null)}</div>
            <div className="tiny faint">{latest ? <>{latest.score}/{latest.max} marks<br />{fmtDate(latest.date)}</> : 'No scores yet'}</div>
          </div>
          <div className="stat">
            <div className="label">Predicted grade</div>
            <div className="value">{pred ? pred.grade : '–'}{pred && pred.used.length > 1 && <small>avg {pred.avg.toFixed(1)}</small>}</div>
            <div className="tiny faint">
              {pred
                ? `from ${plural(pred.used.length, 'paper')}${pred.borrowed ? ` · ${pred.borrowed} borrowed` : ''}`
                : 'Add grade boundaries to predict'}
            </div>
          </div>
        </div>
        <div className="pp-trend">
          {points.length ? (
            <>
              <div className="tiny muted" style={{ marginBottom: 2 }}>Score % over time</div>
              <TrendChart points={points} />
            </>
          ) : (
            <div className="pp-chart-empty muted small">Add a score to see your trend.</div>
          )}
        </div>
      </div>
      <div className="list">
        {sorted.map((p) => {
          const g = paperGrade(p, papers);
          const pc = pctOf(p);
          return (
            <Link key={p.id} to={`/tools/papers/${p.id}`} className="list-row link pp-row">
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 550 }}>{p.title || 'Untitled paper'}{p.series && <span className="muted" style={{ fontWeight: 400 }}> · {p.series}</span>}</div>
                <div className="tiny muted">
                  {fmtDate(p.date)}
                  {p.mistakes.length > 0 && <> · {plural(p.mistakes.length, 'mistake')}</>}
                </div>
              </div>
              <div className="pp-row-score">
                <b>{pc == null ? 'Not marked' : fmtPct(pc)}</b>
                {p.score != null && <span className="tiny muted">{p.score}/{p.max}</span>}
              </div>
              <span className={`pill pp-grade ${g ? (g.from ? 'warn' : 'accent') : ''}`} title={g?.from ? `Graded with borrowed boundaries (${g.from.series || fmtDate(g.from.date)})` : g ? 'Grade from this paper’s boundaries' : 'No boundaries – % only'}>
                {g ? `Grade ${g.grade}${g.from ? '*' : ''}` : '% only'}
              </span>
              <Icon name="chevron" size={16} className="faint hide-sm" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
