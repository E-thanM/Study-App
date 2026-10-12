import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Seg, TopBar } from '../../components/ui';
import type { Term } from '../../lib/types';
import { answersMatch, shuffle } from '../../lib/util';
import { isLongText, qa, recordAnswer, useSet, useStudyTimer, type AnswerWith } from './common';

type QType = 'tf' | 'mc' | 'written' | 'match';
interface TQ { id: string; type: QType; term: Term; prompt: string; answer: string; shown?: string; choices?: string[] }
interface MatchBlock { items: TQ[]; options: string[] }

const LETTERS = 'ABCDEFGH';

export function TestMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  useStudyTimer(id);
  const [count, setCount] = useState(20);
  const [types, setTypes] = useState<Record<QType, boolean>>({ tf: true, mc: true, written: true, match: true });
  const [answerWith, setAnswerWith] = useState<AnswerWith>('definition');
  const [questions, setQuestions] = useState<TQ[] | null>(null);
  const [match, setMatch] = useState<MatchBlock | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [graded, setGraded] = useState(false);
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null);

  if (!set) return null;
  const pool = set.terms.filter((t) => t.term.trim() && t.definition.trim() && (!onlyIds || onlyIds.includes(t.id)));

  const build = (ids?: string[]) => {
    const src = shuffle(ids ? set.terms.filter((t) => ids.includes(t.id)) : pool).slice(0, Math.max(1, count));
    const enabled = (Object.keys(types) as QType[]).filter((k) => types[k]);
    if (!enabled.length) return;
    const qs: TQ[] = [];
    const matchItems: TQ[] = [];
    src.forEach((t, i) => {
      let type = enabled[i % enabled.length];
      if (type === 'match' && matchItems.length >= 6) type = enabled.find((x) => x !== 'match') || 'mc';
      if (type === 'match' && pool.length < 3) type = 'mc';
      const { prompt, answer, promptIsTerm } = qa(t, answerWith);
      if (type === 'written' && isLongText(answer) && types.mc) type = 'mc';
      const otherAnswers = shuffle(pool.filter((o) => o.id !== t.id).map((o) => (promptIsTerm ? o.definition : o.term))).filter((x) => x !== answer);
      const q: TQ = { id: t.id, type, term: t, prompt, answer };
      if (type === 'tf') q.shown = Math.random() < 0.5 || !otherAnswers.length ? answer : otherAnswers[0];
      if (type === 'mc') q.choices = shuffle([answer, ...[...new Set(otherAnswers)].slice(0, 3)]);
      if (type === 'match') matchItems.push(q);
      else qs.push(q);
    });
    setQuestions(qs);
    setMatch(matchItems.length ? { items: matchItems, options: shuffle(matchItems.map((m) => m.answer)) } : null);
    setAnswers({});
    setGraded(false);
    window.scrollTo(0, 0);
  };

  const isRight = (q: TQ): boolean => {
    const a = answers[q.id] ?? '';
    if (q.type === 'tf') return (a === 'true') === (q.shown === q.answer) && a !== '';
    if (q.type === 'mc' || q.type === 'match') return a === q.answer;
    return answersMatch(a, q.answer);
  };

  const all = [...(questions || []), ...(match?.items || [])];
  const correct = graded ? all.filter(isRight).length : 0;
  const grade = () => {
    all.forEach((q) => recordAnswer(id, q.term.id, isRight(q), q.type === 'written'));
    setGraded(true);
    window.scrollTo(0, 0);
  };
  const answered = all.filter((q) => (answers[q.id] ?? '') !== '').length;

  const header = <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Test' }]} />;

  if (!questions) {
    return (
      <>
        {header}
        <div className="q-card col" style={{ maxWidth: 560, margin: '20px auto', gap: 16 }}>
          <h2>Set up your test</h2>
          <label className="field">Questions (max {pool.length})
            <input type="number" min={1} max={pool.length} value={Math.min(count, pool.length)} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <div className="col" style={{ gap: 6 }}><span className="field-label">Answer with</span>
            <Seg value={answerWith} onChange={setAnswerWith} options={[{ value: 'definition', label: 'Definition' }, { value: 'term', label: 'Term' }, { value: 'both', label: 'Both' }]} />
          </div>
          <div className="col" style={{ gap: 8 }}>
            <span className="field-label">Question types</span>
            {([['tf', 'True / False'], ['mc', 'Multiple choice'], ['written', 'Written'], ['match', 'Matching']] as [QType, string][]).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={types[k]} onChange={(e) => setTypes({ ...types, [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
          <button className="btn primary lg" onClick={() => build()} disabled={!pool.length || !Object.values(types).some(Boolean)}>Start test</button>
        </div>
      </>
    );
  }

  const pct = all.length ? Math.round((correct / all.length) * 100) : 0;

  return (
    <>
      {header}
      <div style={{ maxWidth: 760, margin: '10px auto 0' }} className="col">
        {graded && (
          <div className="q-card row between wrap" style={{ gap: 16 }}>
            <div>
              <h2>{pct >= 90 ? 'Brilliant! 🎉' : pct >= 70 ? 'Nice work!' : 'Keep practising'}</h2>
              <div className="muted">{correct} correct · {all.length - correct} incorrect</div>
            </div>
            <div style={{ fontSize: 40, fontWeight: 700, color: pct >= 70 ? 'var(--good)' : 'var(--warn)' }}>{pct}%</div>
            <div className="row wrap" style={{ width: '100%' }}>
              {all.length - correct > 0 && <button className="btn primary" onClick={() => { const missed = all.filter((q) => !isRight(q)).map((q) => q.term.id); setOnlyIds(missed); build(missed); }}>Retake missed questions</button>}
              <button className="btn" onClick={() => { setOnlyIds(null); build(); }}>New test</button>
              <button className="btn ghost" onClick={() => { setQuestions(null); setOnlyIds(null); }}>Options</button>
            </div>
          </div>
        )}

        {questions.map((q, i) => {
          const a = answers[q.id] ?? '';
          const right = graded && isRight(q);
          const set1 = (v: string) => !graded && setAnswers({ ...answers, [q.id]: v });
          return (
            <div key={q.id + i} className="q-card" style={graded ? { borderColor: right ? 'var(--good)' : 'var(--bad)' } : undefined}>
              <div className="row between muted small"><span>{q.type === 'tf' ? 'True or false' : q.type === 'mc' ? 'Multiple choice' : 'Written'}</span><span>{i + 1} of {all.length}</span></div>
              <div className="q-prompt" style={{ marginBottom: q.type === 'tf' ? 8 : 18 }}>{q.prompt}</div>
              {q.type === 'tf' && (
                <>
                  <div className="muted small">matches</div>
                  <div className="q-prompt" style={{ fontSize: 18, marginTop: 4 }}>{q.shown}</div>
                  <div className="choice-grid">
                    {['true', 'false'].map((v) => (
                      <button key={v} className={`choice ${a === v ? (graded ? (right ? 'correct' : 'wrong') : 'correct') : ''}`} style={!graded && a === v ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined} onClick={() => set1(v)}>{v === 'true' ? 'True' : 'False'}</button>
                    ))}
                  </div>
                </>
              )}
              {q.type === 'mc' && (
                <div className="choice-grid">
                  {q.choices!.map((c, j) => {
                    const cls = graded ? (c === q.answer ? 'correct' : c === a ? 'wrong' : '') : '';
                    return (
                      <button key={j} className={`choice ${cls}`} style={!graded && a === c ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined} onClick={() => set1(c)}>
                        <span className="k">{j + 1}</span><span>{c}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === 'written' && <input type="text" value={a} onChange={(e) => set1(e.target.value)} placeholder="Type the answer" disabled={graded} />}
              {graded && !right && <div className="feedback bad" style={{ color: 'var(--ink)' }}>Correct answer: <b>{q.type === 'tf' ? (q.shown === q.answer ? 'True' : `False – ${q.answer}`) : q.answer}</b></div>}
            </div>
          );
        })}

        {match && (
          <div className="q-card">
            <div className="row between muted small"><span>Matching</span><span>{match.items.length} questions</span></div>
            <div className="grid-2 mt">
              <div className="col">
                {match.items.map((q) => {
                  const a = answers[q.id] ?? '';
                  const right = graded && isRight(q);
                  return (
                    <div key={q.id} className="row" style={{ alignItems: 'flex-start' }}>
                      <select value={a ? LETTERS[match.options.indexOf(a)] : ''} disabled={graded} onChange={(e) => setAnswers({ ...answers, [q.id]: match.options[LETTERS.indexOf(e.target.value)] ?? '' })} style={{ width: 70, flex: 'none', borderColor: graded ? (right ? 'var(--good)' : 'var(--bad)') : undefined }}>
                        <option value="">–</option>
                        {match.options.map((_, j) => <option key={j}>{LETTERS[j]}</option>)}
                      </select>
                      <div className="grow">
                        <div style={{ whiteSpace: 'pre-wrap' }}>{q.prompt}</div>
                        {graded && !right && <div className="small" style={{ color: 'var(--bad)' }}>Answer: {LETTERS[match.options.indexOf(q.answer)]}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="col">
                {match.options.map((o, j) => <div key={j} className="row small" style={{ alignItems: 'flex-start' }}><b>{LETTERS[j]}</b><span style={{ whiteSpace: 'pre-wrap' }}>{o}</span></div>)}
              </div>
            </div>
          </div>
        )}

        {!graded && (
          <div className="row between" style={{ position: 'sticky', bottom: 0, padding: '12px 0', background: 'var(--bg)' }}>
            <span className="muted small">{answered} of {all.length} answered</span>
            <button className="btn primary lg" onClick={grade}>Submit test</button>
          </div>
        )}
      </div>
    </>
  );
}
