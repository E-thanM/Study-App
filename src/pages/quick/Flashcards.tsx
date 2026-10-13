import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { speak } from '../../components/CardView';
import { Icon, Progress, Seg, TopBar, useKey } from '../../components/ui';
import { shuffle } from '../../lib/util';
import { FlipText, setKnown, toggleStar, useSet, useStudyTimer } from './common';

export function FlashcardsMode() {
  const { id = '' } = useParams();
  const set = useSet(id);
  useStudyTimer(id);
  const [order, setOrder] = useState<string[] | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [front, setFront] = useState<'term' | 'definition'>('term');
  const [track, setTrack] = useState(true);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnownIds] = useState<Set<string>>(new Set());
  const [learning, setLearning] = useState<Set<string>>(new Set());
  const [anim, setAnim] = useState('');
  const [round, setRound] = useState<string[] | null>(null);
  const touch = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const [drag, setDrag] = useState(0);

  const deckIds = useMemo(() => {
    if (!set) return [];
    const base = set.terms.filter((t) => !starredOnly || t.starred).map((t) => t.id);
    const ordered = order ? order.filter((x) => base.includes(x)) : base;
    return round ? ordered.filter((x) => round.includes(x)) : ordered;
  }, [set, starredOnly, order, round]);

  const cur = set?.terms.find((t) => t.id === deckIds[idx]);
  const finished = idx >= deckIds.length && deckIds.length > 0;

  const go = (d: number) => { setIdx((i) => Math.max(0, Math.min(deckIds.length - (track ? 0 : 1), i + d))); setFlipped(false); };
  const mark = (k: boolean) => {
    if (!cur) return;
    setKnown(id, cur.id, k);
    (k ? setKnownIds : setLearning)((s) => new Set(s).add(cur.id));
    (k ? setLearning : setKnownIds)((s) => { const n = new Set(s); n.delete(cur.id); return n; });
    setAnim(k ? 'swipe-right' : 'swipe-left');
    setTimeout(() => { setAnim(''); setFlipped(false); setIdx((i) => i + 1); }, 220);
  };

  useKey((e) => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setFlipped((f) => !f); }
    else if (e.key === 'ArrowRight') track ? mark(true) : go(1);
    else if (e.key === 'ArrowLeft') track ? mark(false) : go(-1);
    else if (e.key.toLowerCase() === 's' && cur && set) toggleStar(set, cur.id);
  }, [cur, track, deckIds]);

  if (!set) return null;
  const restartWith = (ids: string[] | null) => { setRound(ids); setIdx(0); setFlipped(false); setKnownIds(new Set()); setLearning(new Set()); };
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
          <div
            className="flip-stage"
            onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, swiped: false }; }}
            onTouchMove={(e) => {
              if (!touch.current) return;
              const dx = e.touches[0].clientX - touch.current.x;
              const dy = e.touches[0].clientY - touch.current.y;
              if (Math.abs(dx) > Math.abs(dy)) setDrag(dx);
            }}
            onTouchEnd={() => {
              if (touch.current && Math.abs(drag) > 70) {
                touch.current.swiped = true;
                if (track) mark(drag > 0); else go(drag > 0 ? -1 : 1);
              }
              setDrag(0);
            }}
          >
            <div className={anim} style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 30}deg)`, transition: 'none' } : undefined}>
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
