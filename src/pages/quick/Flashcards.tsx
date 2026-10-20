import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { speak } from '../../components/CardView';
import { Icon, Progress, Seg, TopBar, useKey } from '../../components/ui';
import { shuffle } from '../../lib/util';
import { FlipText, loadFlashSession, saveFlashSession, setKnown, toggleStar, useSet, useStudyTimer } from './common';

export function FlashcardsMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  useStudyTimer(id);
  // carry on from where this set was left last time (saved with the set's progress, so it syncs)
  const [saved] = useState(() => loadFlashSession(id));
  const [order, setOrder] = useState<string[] | null>(saved?.order ?? null);
  const [starredOnly, setStarredOnly] = useState(saved?.starredOnly ?? false);
  const [front, setFront] = useState<'term' | 'definition'>(saved?.front ?? 'term');
  const [track, setTrack] = useState(saved?.track ?? true);
  const [idx, setIdx] = useState(saved?.idx ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnownIds] = useState<Set<string>>(() => new Set(saved?.known));
  const [learning, setLearning] = useState<Set<string>>(() => new Set(saved?.learning));
  const [anim, setAnim] = useState('');
  const [round, setRound] = useState<string[] | null>(saved?.round ?? null);
  const [resumed, setResumed] = useState(!!saved && saved.idx > 0);
  const touch = useRef<{ x: number; y: number; swiped: boolean; axis: 'x' | 'y' | null } | null>(null);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const swipeEnd = useRef<(dx: number) => void>(() => {});

  const deckIds = useMemo(() => {
    if (!set) return [];
    const base = set.terms.filter((t) => !starredOnly || t.starred).map((t) => t.id);
    const ordered = order ? order.filter((x) => base.includes(x)) : base;
    return round ? ordered.filter((x) => round.includes(x)) : ordered;
  }, [set, starredOnly, order, round]);

  const cur = set?.terms.find((t) => t.id === deckIds[idx]);
  const finished = idx >= deckIds.length && deckIds.length > 0;

  // the set may have changed since last time: don't point past its end
  useEffect(() => { if (deckIds.length && idx > deckIds.length) setIdx(deckIds.length); }, [deckIds.length, idx]);

  const lastSaved = useRef('');
  useEffect(() => {
    if (!set) return;
    const session = { idx, order, round, known: [...known], learning: [...learning], starredOnly, front, track };
    const sig = JSON.stringify(session);
    if (sig === lastSaved.current) return;
    const first = !lastSaved.current;
    lastSaved.current = sig;
    if (first) return; // opening the set isn't a change
    saveFlashSession(id, { ...session, at: Date.now() });
  }, [set, id, idx, order, round, known, learning, starredOnly, front, track]);

  const go = (d: number) => { setResumed(false); setIdx((i) => Math.max(0, Math.min(deckIds.length - (track ? 0 : 1), i + d))); setFlipped(false); };
  const mark = (k: boolean) => {
    if (!cur) return;
    setResumed(false);
    setKnown(id, cur.id, k);
    (k ? setKnownIds : setLearning)((s) => new Set(s).add(cur.id));
    (k ? setLearning : setKnownIds)((s) => { const n = new Set(s); n.delete(cur.id); return n; });
    setAnim(k ? 'swipe-right' : 'swipe-left');
    setTimeout(() => { setAnim(''); setFlipped(false); setIdx((i) => i + 1); }, 220);
  };

  swipeEnd.current = (dx) => { if (track) mark(dx > 0); else go(dx > 0 ? -1 : 1); };

  // Swiping: once a drag is clearly sideways, only the card moves – the page doesn't scroll or pan.
  // Native listeners because React's touchmove is passive and can't cancel scrolling.
  const hasCard = !!cur;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const setD = (v: number) => { dragRef.current = v; setDrag(v); };
    const start = (e: TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, swiped: false, axis: null }; };
    const move = (e: TouchEvent) => {
      const t = touch.current;
      if (!t) return;
      const dx = e.touches[0].clientX - t.x;
      const dy = e.touches[0].clientY - t.y;
      if (!t.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (t.axis !== 'x') return; // vertical: let the card text / page scroll as normal
      if (e.cancelable) e.preventDefault();
      setD(dx);
    };
    const end = () => {
      const dx = dragRef.current;
      if (touch.current && Math.abs(dx) > 70) {
        touch.current.swiped = true;
        swipeEnd.current(dx);
      }
      setD(0);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [hasCard]);

  useKey((e) => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setFlipped((f) => !f); }
    else if (e.key === 'ArrowRight') track ? mark(true) : go(1);
    else if (e.key === 'ArrowLeft') track ? mark(false) : go(-1);
    else if (e.key.toLowerCase() === 's' && cur && set) toggleStar(set, cur.id);
  }, [cur, track, deckIds]);

  if (!set) return null;
  const restartWith = (ids: string[] | null) => { setRound(ids); setIdx(0); setFlipped(false); setKnownIds(new Set()); setLearning(new Set()); setResumed(false); };
  const showFront = front === 'term' ? cur?.term : cur?.definition;
  const showBack = front === 'term' ? cur?.definition : cur?.term;

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Flashcards' }]} />
      <div className="row between wrap fc-toolbar" style={{ margin: '12px 0 16px' }}>
        <div className="row wrap">
          <Seg value={front} onChange={setFront} options={[{ value: 'term', label: 'Term first' }, { value: 'definition', label: 'Definition first' }]} />
          <button className={`btn sm ${order ? 'primary' : ''}`} onClick={() => { setOrder(order ? null : shuffle(set.terms.map((t) => t.id))); setIdx(0); setFlipped(false); }}><Icon name="shuffle" /> Shuffle</button>
          <button className={`btn sm ${starredOnly ? 'primary' : ''}`} onClick={() => { setStarredOnly(!starredOnly); setIdx(0); setFlipped(false); }} disabled={!starredOnly && !set.terms.some((t) => t.starred)}><Icon name="star" /> Starred</button>
        </div>
        <label className="check small"><input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} /> <span className="hide-sm">Track progress</span><span className="show-sm">Track</span></label>
      </div>

      {resumed && !finished && cur && (
        <div className="callout small row between" style={{ gap: 10, padding: '6px 6px 6px 14px', marginBottom: 12 }}>
          <span>Picked up at card {idx + 1} of {deckIds.length}</span>
          <button className="btn sm ghost" onClick={() => restartWith(null)}>Start over</button>
        </div>
      )}
      {finished ? (
        <div className="panel pad center col" style={{ maxWidth: 560, margin: '30px auto', gap: 14, padding: 32 }}>
          <div style={{ fontSize: 36 }}>🎯</div>
          <h2>{track ? `You know ${known.size} of ${deckIds.length}` : 'End of the set'}</h2>
          {track && <Progress parts={[{ value: known.size, color: 'var(--good)' }, { value: learning.size, color: 'var(--warn)' }]} />}
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            {track && learning.size > 0 && <button className="btn primary" onClick={() => restartWith([...learning])}>Keep reviewing {learning.size} terms</button>}
            <button className="btn" onClick={() => restartWith(null)}>Restart</button>
            <Link className="btn" to={`/quick/${id}/learn`}>Go to Learn</Link>
          </div>
        </div>
      ) : cur ? (
        <>
          <div className="flip-stage" ref={stage}>
            {/* keyed by card: the next card appears front up instead of flipping back (which flashed its answer) */}
            <div key={`${idx}:${cur.id}`} className={anim} style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 30}deg)`, transition: 'none' } : undefined}>
              <div
                className={`flipcard ${flipped ? 'flipped' : ''}`}
                style={track && Math.abs(drag) > 30 ? { boxShadow: `0 0 0 3px ${drag > 0 ? 'var(--good)' : 'var(--warn)'}`, borderRadius: 24 } : undefined}
                onClick={() => { if (touch.current?.swiped) { touch.current = null; return; } setFlipped(!flipped); }}
              >
                <div className="side">
                  <span className="corner">{front === 'term' ? 'Term' : 'Definition'}</span>
                  <span className="star" onClick={(e) => { e.stopPropagation(); toggleStar(set, cur.id); }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill={cur.starred ? 'var(--warn)' : 'none'} stroke={cur.starred ? 'var(--warn)' : 'var(--faint)'} strokeWidth="1.6"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" /></svg>
                  </span>
                  <FlipText text={showFront || ''} />
                </div>
                <div className="side back"><span className="corner">{front === 'term' ? 'Definition' : 'Term'}</span><FlipText text={showBack || ''} /></div>
              </div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 18, gap: 14 }}>
            {track ? (
              <>
                <button className="btn lg" style={{ color: 'var(--warn)', minWidth: 150 }} onClick={() => mark(false)}>
                  <span className="pill warn">{learning.size}</span> Still learning
                </button>
                <button className="btn ghost icon" onClick={() => speak(showFront || '')} aria-label="Speak"><Icon name="speaker" /></button>
                <button className="btn lg" style={{ color: 'var(--good)', minWidth: 150 }} onClick={() => mark(true)}>
                  Know <span className="pill good">{known.size}</span>
                </button>
              </>
            ) : (
              <>
                <button className="btn icon lg" onClick={() => go(-1)} aria-label="Previous"><Icon name="back" /></button>
                <button className="btn ghost icon" onClick={() => speak(showFront || '')} aria-label="Speak"><Icon name="speaker" /></button>
                <button className="btn icon lg" onClick={() => go(1)} aria-label="Next"><Icon name="chevron" /></button>
              </>
            )}
          </div>
          <div className="center muted small mt">
            {idx + 1} / {deckIds.length}
            <span className="hide-touch"> · <kbd>Space</kbd> flip · <kbd>←</kbd><kbd>→</kbd> {track ? 'still learning / know' : 'navigate'} · <kbd>S</kbd> star</span>
            <span className="show-touch"> · tap to flip · swipe {track ? 'right if you know it, left if not' : 'to move'}</span>
          </div>
          <div style={{ maxWidth: 760, margin: '14px auto 0' }}><Progress parts={[{ value: idx, color: 'var(--ink)' }, { value: deckIds.length - idx, color: 'transparent' }]} /></div>
        </>
      ) : (
        <div className="empty">No terms to show.</div>
      )}
    </>
  );
}
