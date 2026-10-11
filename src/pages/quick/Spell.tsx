import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { speak } from '../../components/CardView';
import { Icon, Progress, TopBar } from '../../components/ui';
import { answersMatch, shuffle } from '../../lib/util';
import { recordAnswer, useSet, useStudyTimer } from './common';

/** Quizlet "Spell": hear the term, type it. Missed terms come back until spelled correctly. */
export function SpellMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  useStudyTimer(id);
  const initial = useMemo(() => (set ? shuffle(set.terms.filter((t) => t.term.trim()).map((t) => t.id)) : []), [set?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [queue, setQueue] = useState<string[]>(initial);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<null | boolean>(null);
  const [doneCount, setDoneCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const cur = set?.terms.find((t) => t.id === queue[0]);

  useEffect(() => { setQueue(initial); }, [initial]);
  useEffect(() => {
    if (cur) { speak(cur.term); input.current?.focus(); }
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!set) return null;
  const total = initial.length;

  const check = () => {
    if (!cur) return;
    if (result !== null) {
      setQueue(([h, ...rest]) => (result ? rest : [...rest, h]));
      if (result) setDoneCount((d) => d + 1);
      setResult(null);
      setTyped('');
      return;
    }
    const ok = answersMatch(typed, cur.term);
    recordAnswer(id, cur.id, ok, true);
    setResult(ok);
    if (!ok) speak(cur.term);
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Spell' }]} />
      <div style={{ maxWidth: 640, margin: '10px auto 0' }}>
        <Progress parts={[{ value: doneCount, color: 'var(--good)' }, { value: total - doneCount, color: 'var(--line)' }]} />
        {!cur ? (
          <div className="q-card center col mt-lg" style={{ gap: 12 }}>
            <div style={{ fontSize: 40 }}>✍️</div>
            <h2>All {total} terms spelled correctly!</h2>
            <button className="btn primary" style={{ alignSelf: 'center' }} onClick={() => { setQueue(shuffle(initial)); setDoneCount(0); }}>Go again</button>
          </div>
        ) : (
          <div className="q-card mt-lg col" style={{ gap: 14 }}>
            <div className="row between">
              <button className="btn" onClick={() => speak(cur.term)}><Icon name="speaker" /> Replay</button>
              <span className="muted small">{queue.length} left</span>
            </div>
            <div className="muted small">Definition</div>
            <div className="q-prompt" style={{ margin: 0, fontSize: 19 }}>{cur.definition}</div>
            <form onSubmit={(e) => { e.preventDefault(); check(); }} className="col">
              <input ref={input} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={result !== null} placeholder="Type what you hear" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              {result === true && <div className="feedback good">✓ Correct</div>}
              {result === false && <div className="feedback bad" style={{ color: 'var(--ink)' }}>Correct spelling: <b>{cur.term}</b></div>}
              <button className="btn primary" type="submit">{result === null ? 'Check' : 'Continue'}</button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
