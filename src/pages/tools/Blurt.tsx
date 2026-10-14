import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AiAsk } from '../../components/AiAsk';
import { Icon, Progress, Seg, TopBar, toast } from '../../components/ui';
import { extractJson } from '../../lib/ai';
import { blurtPrompt, checkBlurt, type BlurtFeedback, type BlurtPoint } from '../../lib/blurt';
import { loadStarterDecks, type StarterDeck } from '../../lib/starter';
import { put, useAll } from '../../lib/store';
import type { Blurt } from '../../lib/types';
import { uid } from '../../lib/util';
import './tools.css';

const TIMERS = [0, 3, 5, 10];

/** Blurting: write everything you remember about a topic, then see exactly what you missed. */
export function BlurtPage() {
  const nav = useNavigate();
  const history = useAll('blurt');
  const [decks, setDecks] = useState<StarterDeck[] | null>(null);
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [sub, setSub] = useState('');
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{ id: string; points: BlurtPoint[] } | null>(null);
  const [ai, setAi] = useState<BlurtFeedback | null>(null);
  const [rawAi, setRawAi] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const [params] = useSearchParams();
  useEffect(() => {
    void loadStarterDecks().then((ds) => {
      setDecks(ds);
      // opened from the study plan with a subject and topic picked
      const want = params.get('subject');
      const d = want ? ds.find((x) => x.name.toLowerCase() === want.toLowerCase() || x.key === want.toLowerCase()) : undefined;
      if (!d) return;
      setSubject(d.key);
      const t = params.get('topic');
      if (t && d.topics.includes(t)) setTopic(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deck = decks?.find((d) => d.key === subject);
  const topics = deck?.topics || [];
  const subs = useMemo(() => [...new Set((deck?.notes || []).filter((n) => n.topic === topic && n.sub).map((n) => n.sub))], [deck, topic]);
  const notes = useMemo(() => (deck?.notes || []).filter((n) => n.topic === topic && (!sub || n.sub === sub)), [deck, topic, sub]);
  const topicName = sub ? `${topic} – ${sub}` : topic;
  const past = history.filter((b) => b.subject === deck?.name && b.topic === topicName).sort((a, b) => b.date - a.date);

  // countdown: when time is up, check automatically
  useEffect(() => {
    if (!startedAt || !minutes || result) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [startedAt, minutes, result]);
  const left = startedAt && minutes ? Math.max(0, startedAt + minutes * 60_000 - now) : null;
  useEffect(() => { if (left === 0 && !result && text.trim()) check(); });

  const check = () => {
    if (!deck || !text.trim()) return;
    const points = checkBlurt(text, notes);
    const covered = points.filter((p) => p.covered).length;
    const id = uid();
    put({ id, kind: 'blurt', subject: deck.name, topic: topicName, text, date: Date.now(), covered, total: points.length, missing: points.filter((p) => !p.covered).map((p) => p.question) } as Blurt);
    setResult({ id, points });
    setAi(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const studyGaps = () => {
    if (!result || !deck) return;
    const missed = result.points.filter((p) => !p.covered);
    const id = uid();
    put({
      id, kind: 'set', title: `Gaps: ${topicName}`, description: `From your blurt on ${new Date().toLocaleDateString('en-GB')}`, folder: deck.name,
      terms: missed.map((p) => ({ id: uid(), term: p.question, definition: p.answer })), createdAt: Date.now(),
    });
    toast(`Made a Quick Learn set with ${missed.length} points`);
    nav(`/quick/${id}`);
  };

  const readAi = (reply: string) => {
    const fb = extractJson<BlurtFeedback>(reply);
    if (!fb) { setRawAi(reply); setAi({}); return; }
    setAi(fb);
    setRawAi('');
    if (result) put({ ...(history.find((b) => b.id === result.id) as Blurt), feedback: [fb.feedback, ...(fb.mistakes || []).map((m) => `✗ ${m}`)].filter(Boolean).join('\n') });
  };

  const reset = () => { setResult(null); setText(''); setStartedAt(null); setAi(null); };

  if (result && deck) {
    const covered = result.points.filter((p) => p.covered);
    const missed = result.points.filter((p) => !p.covered);
    const pct = Math.round((covered.length / Math.max(1, result.points.length)) * 100);
    return (
      <>
        <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { to: '/tools/blurt', label: 'Blurting' }, { label: 'Results' }]} />
        <div className="page-head">
          <div>
            <h1>{pct}% recalled</h1>
            <div className="sub">{deck.name} · {topicName} – {covered.length} of {result.points.length} key points</div>
          </div>
          <div className="row wrap">
            <button className="btn" onClick={reset}>Blurt again</button>
            {missed.length > 0 && <button className="btn primary" onClick={studyGaps}><Icon name="bolt" /> Learn the {missed.length} gaps</button>}
          </div>
        </div>
        <Progress parts={[{ value: covered.length, color: 'var(--good)' }, { value: missed.length, color: 'var(--bad)' }]} />
        <div className="blurt-grid mt">
          <section className="panel">
            <div className="panel-head"><h3>Missed</h3><span className="pill bad">{missed.length}</span></div>
            <div className="list">
              {missed.length ? missed.map((p, i) => (
                <div key={i} className="list-row col" style={{ alignItems: 'stretch', gap: 4 }}>
                  <b className="small">{p.question}</b>
                  <span className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{p.answer}</span>
                </div>
              )) : <div className="list-row muted small">Nothing missed – brilliant.</div>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Covered</h3><span className="pill good">{covered.length}</span></div>
            <div className="list">
              {covered.map((p, i) => <div key={i} className="list-row small">✓ {p.question}</div>)}
              {!covered.length && <div className="list-row muted small">Nothing matched yet – keep going, it gets easier every time.</div>}
            </div>
          </section>
        </div>
        <p className="muted tiny mt">The quick check looks for each point's key words in what you wrote, so it can miss a point you explained in your own words. For a teacher-style comparison, use AI feedback below.</p>
        <section className="panel pad col mt" style={{ gap: 12 }}>
          <h3>AI feedback</h3>
          {!ai ? (
            <AiAsk prompt={blurtPrompt(deck.name, topicName, text, result.points)} onReply={readAi} label="Compare with the spec" />
          ) : rawAi ? (
            <div className="code-box">{rawAi}</div>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {typeof ai.score === 'number' && <div><b>{ai.score}%</b> <span className="muted small">of the topic recalled (AI estimate)</span></div>}
              {ai.feedback && <p>{ai.feedback}</p>}
              {!!ai.mistakes?.length && <div><b className="small">Mistakes to fix</b><ul className="small">{ai.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
              {!!ai.missing?.length && <div><b className="small">Missing</b><ul className="small">{ai.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
              {!!ai.covered?.length && <div><b className="small">You got</b><ul className="small muted">{ai.covered.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
            </div>
          )}
        </section>
        <details className="panel pad mt"><summary className="muted" style={{ cursor: 'pointer' }}>What you wrote</summary><p style={{ whiteSpace: 'pre-wrap' }}>{text}</p></details>
      </>
    );
  }

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Blurting' }]} />
      <div className="page-head">
        <div>
          <h1>Blurting</h1>
          <div className="sub">Pick a topic, write down everything you can remember without notes, then see exactly which key points you missed.</div>
        </div>
      </div>
      <section className="panel pad col" style={{ gap: 14 }}>
        <div className="form-grid">
          <label className="field">Subject
            <select value={subject} onChange={(e) => { setSubject(e.target.value); setTopic(''); setSub(''); }}>
              <option value="">{decks ? 'Choose…' : 'Loading…'}</option>
              {(decks || []).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
            </select>
          </label>
          <label className="field">Topic
            <select value={topic} onChange={(e) => { setTopic(e.target.value); setSub(''); }} disabled={!deck}>
              <option value="">Choose…</option>
              {topics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {subs.length > 1 && (
            <label className="field">Part of the topic
              <select value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">Whole topic</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
        </div>
        {topic && (
          <>
            <div className="row between wrap">
              <span className="muted small">{notes.length} key points in this {sub ? 'section' : 'topic'}{past.length ? ` · last time ${Math.round(((past[0].covered || 0) / Math.max(1, past[0].total || 1)) * 100)}%` : ''}</span>
              <div className="row" style={{ gap: 8 }}>
                <span className="small muted">Timer</span>
                <Seg value={String(minutes)} onChange={(v) => setMinutes(Number(v))} options={TIMERS.map((m) => ({ value: String(m), label: m ? `${m}m` : 'Off' }))} />
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <textarea
                ref={box}
                className="blurt-box"
                value={text}
                onChange={(e) => { setText(e.target.value); if (!startedAt) setStartedAt(Date.now()); }}
                placeholder={`Everything you remember about ${topicName}: key words, definitions, processes, equations, examples… Don't look at your notes!`}
              />
              {left !== null && <span className={`blurt-timer ${left < 30_000 ? 'low' : ''}`}>{Math.floor(left / 60000)}:{String(Math.floor(left / 1000) % 60).padStart(2, '0')}</span>}
            </div>
            <div className="row between wrap">
              <span className="muted small">{text.trim() ? `${text.trim().split(/\s+/).length} words` : 'The timer starts when you start typing.'}</span>
              <button className="btn primary lg" onClick={check} disabled={!text.trim()}><Icon name="check" /> Check what I missed</button>
            </div>
          </>
        )}
      </section>
      {history.length > 0 && (
        <section className="panel mt">
          <div className="panel-head"><h3>Previous blurts</h3></div>
          <div className="list">
            {[...history].sort((a, b) => b.date - a.date).slice(0, 12).map((b) => (
              <div key={b.id} className="list-row">
                <span className="grow ellipsis small"><b>{b.subject}</b> · {b.topic}</span>
                <span className="pill">{Math.round(((b.covered || 0) / Math.max(1, b.total || 1)) * 100)}%</span>
                <span className="faint tiny nowrap">{new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

