import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon, Modal, Progress, Seg, TopBar, useKey } from '../../components/ui';
import { get } from '../../lib/store';
import type { Term } from '../../lib/types';
import { answersMatch, shuffle } from '../../lib/util';
import { isLongText, qa, recordAnswer, resetProgress, useProgress, useSet, useStudyTimer, type AnswerWith } from './common';

const ROUND = 7;
interface Q { term: Term; kind: 'mc' | 'written'; prompt: string; answer: string; choices?: string[] }

export function LearnMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  const prog = useProgress(id);
  useStudyTimer(id);
  const [answerWith, setAnswerWith] = useState<AnswerWith>('definition');
  const [useMc, setUseMc] = useState(true);
  const [useWritten, setUseWritten] = useState(true);
  const [starredOnly, setStarredOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [roundTerms, setRoundTerms] = useState<string[]>([]);
  const [q, setQ] = useState<Q | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<null | 'right' | 'wrong'>(null);
  const [between, setBetween] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<string[]>([]);
  queueRef.current = queue;

  const pool = useMemo(() => (set ? set.terms.filter((t) => t.term.trim() && (!starredOnly || t.starred)) : []), [set, starredOnly]);
  const level = (tid: string) => get('setprogress', `prog-${id}`)?.terms[tid]?.level || 0;
  const masteredCount = pool.filter((t) => (prog.terms[t.id]?.level || 0) >= 3).length;
  const learningCount = pool.filter((t) => { const l = prog.terms[t.id]?.level || 0; return l > 0 && l < 3; }).length;

  const makeQ = (t: Term): Q => {
    const { prompt, answer, promptIsTerm } = qa(t, answerWith);
    const lv = level(t.id);
    // long sentence answers stay multiple choice (typing a paragraph exactly isn't useful)
    const kind: Q['kind'] = !useMc ? 'written' : !useWritten || isLongText(answer) ? 'mc' : lv >= 2 ? 'written' : 'mc';
    if (kind === 'written') return { term: t, kind, prompt, answer };
    const others = shuffle(pool.filter((o) => o.id !== t.id).map((o) => (promptIsTerm ? o.definition : o.term)))
      .filter((x, i, a) => x && x !== answer && a.indexOf(x) === i)
      .slice(0, 3);
    return { term: t, kind, prompt, answer, choices: shuffle([answer, ...others]) };
  };

  const startRound = () => {
    const remaining = pool.filter((t) => level(t.id) < 3);
    // prioritise terms already in progress, then new ones
    const sorted = [...remaining].sort((a, b) => level(b.id) - level(a.id) || 0);
    const pick = shuffle(sorted.slice(0, ROUND));
    setRoundTerms(pick.map((t) => t.id));
    setQueue(pick.map((t) => t.id));
    queueRef.current = pick.map((t) => t.id);
    setBetween(false);
    nextFrom(pick.map((t) => t.id));
  };

  const nextFrom = (qs: string[]) => {
    setPicked(null);
    setTyped('');
    setResult(null);
    const tid = qs[0];
    const t = pool.find((x) => x.id === tid);
    if (!t) { setQ(null); setBetween(true); return; }
    setQ(makeQ(t));
  };

  useEffect(() => {
    if (set && !q && !between && pool.length) startRound();
  }, [set, pool.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (q?.kind === 'written') inputRef.current?.focus(); }, [q]);

  const submit = (given: string, override?: boolean) => {
    if (!q || result) return;
    const ok = override ?? (q.kind === 'mc' ? given === q.answer : answersMatch(given, q.answer));
    // for long answers a second correct multiple-choice answer counts as mastered
    recordAnswer(id, q.term.id, ok, q.kind === 'written' || !useWritten || (isLongText(q.answer) && level(q.term.id) >= 2));
    setResult(ok ? 'right' : 'wrong');
    if (ok) setTimeout(() => advance(true), 850);
  };

  const advance = (ok: boolean) => {
    const [head, ...rest] = queueRef.current;
    let next = rest;
    if (!ok) next = [...rest.slice(0, 2), head, ...rest.slice(2)]; // see it again soon
    else if (level(head) < 3 && useWritten && useMc) next = [...rest, head]; // still needs the written step
    setQueue(next);
    queueRef.current = next;
    nextFrom(next);
  };

  const override = () => {
    if (!q) return;
    recordAnswer(id, q.term.id, true, true);
    setResult('right');
    setTimeout(() => advance(true), 300);
  };

  useKey((e) => {
    if (!q) { if (between && e.key === 'Enter') startRound(); return; }
    if (result === 'wrong' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(false); return; }
    if (q.kind === 'mc' && !result && ['1', '2', '3', '4'].includes(e.key) && q.choices?.[Number(e.key) - 1]) {
      const c = q.choices[Number(e.key) - 1];
      setPicked(c);
      submit(c);
    }
  }, [q, result, between]);

  if (!set) return null;
  const allDone = pool.length > 0 && masteredCount === pool.length;

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Learn' }]} right={<button className="btn ghost icon" onClick={() => setSettingsOpen(true)} aria-label="Options"><Icon name="list" /></button>} />
      <div style={{ maxWidth: 760, margin: '10px auto 0' }}>
        <div className="row between small muted" style={{ marginBottom: 6 }}>
          <span>{masteredCount} mastered · {learningCount} learning · {pool.length - masteredCount - learningCount} new</span>
          <span>{pool.length ? Math.round((masteredCount / pool.length) * 100) : 0}%</span>
        </div>
        <Progress parts={[{ value: masteredCount, color: 'var(--good)' }, { value: learningCount, color: 'var(--warn)' }, { value: pool.length - masteredCount - learningCount, color: 'var(--line)' }]} />

        {allDone ? (
          <div className="q-card center col mt-lg" style={{ gap: 14 }}>
            <div style={{ fontSize: 40 }}>🏆</div>
            <h2>You've mastered all {pool.length} terms!</h2>
            <p className="muted">Ready for the test? Try a practice test, or move this set into long-term flashcards so you remember it for the exam too.</p>
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link className="btn primary" to={`/quick/${id}/test`}>Practice test</Link>
              <Link className="btn accent" to={`/quick/${id}/convert`}><Icon name="sparkle" /> Make long-term</Link>
              <button className="btn" onClick={() => { resetProgress(id); setTimeout(startRound, 50); }}>Start over</button>
            </div>
          </div>
        ) : between ? (
          <div className="q-card col mt-lg" style={{ gap: 14 }}>
            <h2>Round complete – keep going!</h2>
            <div className="list">
              {roundTerms.map((tid) => {
                const t = pool.find((x) => x.id === tid);
                const lv = prog.terms[tid]?.level || 0;
                return t ? (
                  <div key={tid} className="list-row small" style={{ padding: '8px 0' }}>
                    <span className="dot" style={{ background: lv >= 3 ? 'var(--good)' : 'var(--warn)' }} />
                    <b className="grow">{t.term}</b>
                    <span className="grow muted">{t.definition}</span>
                  </div>
                ) : null;
              })}
            </div>
            <button className="btn primary lg" onClick={startRound}>Continue <kbd style={{ color: 'inherit', opacity: 0.6, borderColor: 'currentColor' }}>Enter</kbd></button>
          </div>
        ) : q ? (
          <div className="q-card mt-lg">
            <div className="row between muted small">
              <span>{q.kind === 'mc' ? 'Choose the matching answer' : 'Type the answer'}</span>
              <span>{queue.length} left this round</span>
            </div>
            <div className="q-prompt">{q.prompt}</div>
            {q.kind === 'mc' ? (
              <div className="choice-grid">
                {q.choices!.map((c, i) => {
                  const state = result ? (c === q.answer ? 'correct' : c === picked ? 'wrong' : '') : '';
                  return (
                    <button key={i} className={`choice ${state}`} disabled={!!result} onClick={() => { setPicked(c); submit(c); }}>
                      <span className="k">{i + 1}</span><span>{c}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (!result) submit(typed); }} className="col">
                <input ref={inputRef} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!!result} placeholder="Type the answer" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                {!result && (
                  <div className="row between">
                    <button type="button" className="btn ghost sm" onClick={() => submit('')}>Don't know?</button>
                    <button className="btn primary" type="submit">Answer</button>
                  </div>
                )}
              </form>
            )}
            {result === 'right' && <div className="feedback good">✓ Correct!</div>}
            {result === 'wrong' && (
              <div className="feedback bad col" style={{ gap: 8 }}>
                <div>{q.kind === 'written' && typed ? <>You said: <s>{typed}</s></> : 'Not quite.'}</div>
                <div style={{ color: 'var(--ink)' }}>Correct answer: <b>{q.answer}</b></div>
                <div className="row between">
                  {q.kind === 'written' && typed ? <button className="btn sm" onClick={override}>Override: I was right</button> : <span />}
                  <button className="btn primary sm" onClick={() => advance(false)} autoFocus>Continue</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="empty">Add some terms to this set first.</div>
        )}
      </div>

      {settingsOpen && (
        <Modal title="Learn options" onClose={() => setSettingsOpen(false)} footer={<button className="btn primary" onClick={() => { setSettingsOpen(false); startRound(); }}>Apply</button>}>
          <div className="col" style={{ gap: 14 }}>
            <div className="col" style={{ gap: 6 }}><span className="field-label">Answer with</span>
              <Seg value={answerWith} onChange={setAnswerWith} options={[{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }]} />
            </div>
            <label className="check"><input type="checkbox" checked={useMc} onChange={(e) => { setUseMc(e.target.checked); if (!e.target.checked) setUseWritten(true); }} /> Multiple choice questions</label>
            <label className="check"><input type="checkbox" checked={useWritten} onChange={(e) => { setUseWritten(e.target.checked); if (!e.target.checked) setUseMc(true); }} /> Written questions</label>
            <label className="check"><input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} disabled={!set.terms.some((t) => t.starred)} /> Study starred terms only</label>
            <button className="btn danger sm" style={{ alignSelf: 'flex-start' }} onClick={() => { if (confirm('Reset all Learn progress?')) { resetProgress(id); setSettingsOpen(false); setTimeout(startRound, 50); } }}>Reset progress</button>
          </div>
        </Modal>
      )}
    </>
  );
}
