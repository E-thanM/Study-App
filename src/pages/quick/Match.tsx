import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TopBar } from '../../components/ui';
import { patch } from '../../lib/store';
import { shuffle } from '../../lib/util';
import { isLongText, useSet, useStudyTimer } from './common';

interface Tile { key: string; termId: string; text: string }

export function MatchMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  useStudyTimer(id);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<Set<string>>(new Set());
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [penalty, setPenalty] = useState(0);
  const [done, setDone] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const begin = () => {
    if (!set) return;
    const usable = set.terms.filter((t) => t.term.trim() && t.definition.trim());
    // tiles are small, so prefer short terms and definitions when the set has enough of them
    const short = usable.filter((t) => t.term.length <= 70 && t.definition.length <= 70 && !isLongText(t.term));
    const picks = shuffle(short.length >= 6 ? short : usable).slice(0, 6);
    setTiles(shuffle(picks.flatMap((t) => [{ key: t.id + ':t', termId: t.id, text: t.term }, { key: t.id + ':d', termId: t.id, text: t.definition }])));
    setGone(new Set());
    setSel(null);
    setPenalty(0);
    setDone(null);
    setStart(Date.now());
  };

  useEffect(() => {
    if (start && done === null) {
      timer.current = setInterval(() => setNow(Date.now()), 100);
      return () => { if (timer.current) clearInterval(timer.current); };
    }
  }, [start, done]);

  if (!set) return null;
  const elapsed = start ? (done ?? now - start + penalty) : 0;
  const best = set.bestMatchMs;

  const click = (t: Tile) => {
    if (gone.has(t.key) || done !== null) return;
    if (!sel) return setSel(t.key);
    if (sel === t.key) return setSel(null);
    const other = tiles.find((x) => x.key === sel)!;
    if (other.termId === t.termId) {
      const g = new Set(gone).add(t.key).add(other.key);
      setGone(g);
      setSel(null);
      if (g.size === tiles.length) {
        const final = Date.now() - start! + penalty;
        setDone(final);
        if (!best || final < best) patch('set', id, { bestMatchMs: final });
      }
    } else {
      setWrong(new Set([t.key, other.key]));
      setPenalty((p) => p + 1000);
      setSel(null);
      setTimeout(() => setWrong(new Set()), 350);
    }
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Match' }]} />
      {!start ? (
        <div className="q-card center col" style={{ maxWidth: 520, margin: '40px auto', gap: 14 }}>
          <div style={{ fontSize: 40 }}>⚡</div>
          <h2>Ready to play?</h2>
          <p className="muted">Match all the terms with their definitions as fast as you can. Wrong matches add 1 second.</p>
          {best && <p className="small">Your best: <b>{(best / 1000).toFixed(1)}s</b></p>}
          <button className="btn primary lg" onClick={begin}>Start game</button>
        </div>
      ) : (
        <div style={{ maxWidth: 900, margin: '10px auto 0' }}>
          <div className="row between mb">
            <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{(elapsed / 1000).toFixed(1)}s</span>
            {penalty > 0 && <span className="pill bad">+{penalty / 1000}s penalty</span>}
            <button className="btn sm" onClick={begin}>Restart</button>
          </div>
          {done !== null ? (
            <div className="q-card center col" style={{ gap: 12 }}>
              <h2>{!best || done <= best ? 'New record! 🏁' : 'Nice!'}</h2>
              <div style={{ fontSize: 38, fontWeight: 700 }}>{(done / 1000).toFixed(1)}s</div>
              {best && <div className="muted">Best: {(Math.min(best, done) / 1000).toFixed(1)}s</div>}
              <button className="btn primary" onClick={begin} style={{ alignSelf: 'center' }}>Play again</button>
            </div>
          ) : (
            <div className="match-grid">
              {tiles.map((t) => (
                <button key={t.key} className={`match-tile ${sel === t.key ? 'sel' : ''} ${wrong.has(t.key) ? 'wrong' : ''} ${gone.has(t.key) ? 'gone' : ''}`} onClick={() => click(t)}>
                  {t.text.length > 120 ? t.text.slice(0, 120) + '…' : t.text}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
