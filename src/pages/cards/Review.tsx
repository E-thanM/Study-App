import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CardInfoModal, EditNoteModal } from '../../components/CardModals';
import { CardView, FLAG_COLORS } from '../../components/CardView';
import { Icon, MenuButton, TopBar, toast, useKey } from '../../components/ui';
import { answerCard, bury, buildQueue, cardsOfNote, deckPath, deleteNotes, nextCard, setFlag, suspend, undoLastReview } from '../../lib/collection';
import { previewAll, type Rating } from '../../lib/scheduler';
import { getPreset } from '../../lib/seed';
import { get, useVersion } from '../../lib/store';
import { CardState, type Card } from '../../lib/types';
import { fmtInterval } from '../../lib/util';

const LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
const CLS: Record<Rating, string> = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

export function Review() {
  const { id = '' } = useParams();
  const deck = get('deck', id);
  const v = useVersion('card', 'note', 'notetype', 'deck', 'preset');
  const [card, setCard] = useState<Card | null>(() => nextCard(id));
  const [showAnswer, setShowAnswer] = useState(false);
  const [typed, setTyped] = useState('');
  const [modal, setModal] = useState<'edit' | 'info' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const shownAt = useRef(Date.now());
  const [waitUntil, setWaitUntil] = useState<number | null>(null);

  // re-read the live card (edits, flags) while keeping the same one on screen
  const live = card ? get('card', card.id) || null : null;
  const note = live ? get('note', live.noteId) : undefined;
  const nt = note ? get('notetype', note.noteTypeId) : undefined;
  const preset = getPreset(get('deck', live?.odid || live?.deckId)?.presetId || deck?.presetId);
  const counts = useMemo(() => {
    const q = buildQueue(id);
    return { new: q.new.length, learn: q.learnNow.length + q.learnAhead.length, review: q.review.length };
  }, [id, v]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = useCallback((skipId?: string) => {
    const nxt = nextCard(id, Date.now(), skipId);
    setCard(nxt);
    setShowAnswer(false);
    setTyped('');
    shownAt.current = Date.now();
    if (!nxt) {
      const q = buildQueue(id);
      // learning cards due later today: wait and come back
      const soon = [...q.learnAhead].sort((a, b) => a.due - b.due)[0];
      setWaitUntil(soon ? soon.due : null);
    } else setWaitUntil(null);
  }, [id]);

  // card deleted/suspended elsewhere
  useEffect(() => {
    if (card && (!live || live.queue === 'suspended')) advance();
  }, [card, live, advance]);

  // poll for learning cards when waiting
  useEffect(() => {
    if (card || !waitUntil) return;
    const t = setInterval(() => { if (Date.now() >= waitUntil - 1000) advance(); }, 5000);
    return () => clearInterval(t);
  }, [card, waitUntil, advance]);

  useEffect(() => {
    if (!preset.showTimer) return;
    const t = setInterval(() => setElapsed(Date.now() - shownAt.current), 1000);
    return () => clearInterval(t);
  }, [preset.showTimer, card]);

  const intervals = useMemo(() => (live && showAnswer ? previewAll(live, preset) : null), [live, showAnswer, preset]);

  const answer = (rating: Rating) => {
    if (!live || !showAnswer) return;
    const { card: after, leech } = answerCard(live, rating, Date.now() - shownAt.current);
    const nextIn = fmtInterval(Math.max(0, after.due - Date.now()));
    toast(`Next review in ${nextIn} · reviewed ${after.reps}×${leech ? ' · leech!' : ''}`, { label: 'Undo', fn: () => doUndo() }, 2200);
    advance();
  };

  const doUndo = () => {
    const restored = undoLastReview();
    if (restored) {
      setCard(restored);
      setShowAnswer(false);
      setTyped('');
      shownAt.current = Date.now();
      toast('Review undone');
    } else toast('Nothing to undo');
  };

  const reveal = () => {
    if (!live) return;
    setShowAnswer(true);
  };

  useKey((e) => {
    if (modal) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && /^[0-7]$/.test(k) && live) { e.preventDefault(); setFlag([live.id], live.flag === Number(k) ? 0 : Number(k)); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!showAnswer && (k === ' ' || k === 'Enter')) { e.preventDefault(); reveal(); return; }
    if (showAnswer && (k === ' ' || k === 'Enter')) { e.preventDefault(); answer(3); return; }
    if (showAnswer && ['1', '2', '3', '4'].includes(k)) { answer(Number(k) as Rating); return; }
    if (!live) return;
    switch (k.toLowerCase()) {
      case 'e': setModal('edit'); break;
      case 'i': setModal('info'); break;
      case 'z': doUndo(); break;
      case '-': bury([live.id]); toast('Card buried'); advance(live.id); break;
      case '=': bury(cardsOfNote(live.noteId).map((c) => c.id)); toast('Note buried'); advance(live.id); break;
      case '@': suspend([live.id]); toast('Card suspended', { label: 'Undo', fn: () => suspend([live.id], false) }); advance(live.id); break;
      case '!': suspend(cardsOfNote(live.noteId).map((c) => c.id)); toast('Note suspended'); advance(live.id); break;
      case 'r': { const btn = document.querySelector<HTMLElement>('.card-face .audio-btn, .card-face .tts-btn'); btn?.click(); break; }
    }
  }, [showAnswer, live, modal, intervals]);

  if (!deck) return <><TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }]} /><div className="empty">Deck not found.</div></>;

  const crumbs = [{ to: '/cards', label: 'Flashcards' }, { to: `/cards/deck/${id}`, label: deck.name }, { label: 'Study' }];

  if (!live || !note || !nt) {
    return (
      <>
        <TopBar crumbs={crumbs} />
        <div className="panel pad center col" style={{ maxWidth: 560, margin: '40px auto', gap: 14, padding: 36 }}>
          <div style={{ fontSize: 40 }}>{waitUntil ? '⏳' : '🎉'}</div>
          <h2>{waitUntil ? 'Waiting for learning cards' : 'Done for now!'}</h2>
          <p className="muted">
            {waitUntil ? `The next learning card is ready in ${fmtInterval(Math.max(0, waitUntil - Date.now()))}. Stay here and it will appear automatically.` : "You've finished everything due in this deck today. Come back tomorrow – spacing is what makes it stick."}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={doUndo}><Icon name="undo" /> Undo last</button>
            <Link className="btn primary" to={`/cards/deck/${id}`}>Back to deck</Link>
          </div>
        </div>
      </>
    );
  }

  const isNew = live.state === CardState.New;
  const isLearn = live.state === CardState.Learning || live.state === CardState.Relearning;

  return (
    <>
      <TopBar
        crumbs={crumbs}
        right={
          <MenuButton
            className="btn icon"
            items={[
              { label: 'Edit note (E)', icon: 'edit', onClick: () => setModal('edit') },
              { label: 'Card info (I)', icon: 'note', onClick: () => setModal('info') },
              { label: 'Undo (Z)', icon: 'undo', onClick: doUndo },
              { divider: true, label: '', onClick: () => {} },
              ...[1, 2, 3, 4, 5, 6, 7].map((f) => ({ label: `${live.flag === f ? 'Remove' : 'Set'} ${['', 'red', 'orange', 'green', 'blue', 'pink', 'turquoise', 'purple'][f]} flag (Ctrl+${f})`, icon: 'flag', onClick: () => setFlag([live.id], live.flag === f ? 0 : f) })).slice(0, 4),
              { label: 'Bury card (-)', icon: 'pause', onClick: () => { bury([live.id]); advance(live.id); } },
              { label: 'Bury note (=)', icon: 'pause', onClick: () => { bury(cardsOfNote(live.noteId).map((c) => c.id)); advance(live.id); } },
              { label: 'Suspend card (@)', icon: 'pause', onClick: () => { suspend([live.id]); advance(live.id); } },
              { label: 'Suspend note (!)', icon: 'pause', onClick: () => { suspend(cardsOfNote(live.noteId).map((c) => c.id)); advance(live.id); } },
              { divider: true, label: '', onClick: () => {} },
              { label: 'Delete note', icon: 'trash', danger: true, onClick: () => { if (confirm('Delete this note and its cards?')) { deleteNotes([live.noteId]); advance(); } } },
            ]}
          />
        }
      />
      <div className="review-wrap">
        <div className="review-top">
          <div className="review-counts">
            <span className={`n-new ${isNew ? 'cur' : ''}`}>{counts.new}</span>
            <span className={`n-learn ${isLearn ? 'cur' : ''}`}>{counts.learn}</span>
            <span className={`n-review ${!isNew && !isLearn ? 'cur' : ''}`}>{counts.review}</span>
          </div>
          <div className="row small muted" style={{ gap: 12 }}>
            {live.flag > 0 && <span className="dot" style={{ background: FLAG_COLORS[live.flag] }} />}
            <span title="Times this card has been reviewed">Cycle {live.reps + 1}</span>
            {preset.showTimer && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(elapsed / 60000)}:{String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}</span>}
            <span className="hide-sm ellipsis" style={{ maxWidth: 220 }}>{deckPath(get('deck', live.odid || live.deckId))}</span>
          </div>
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
          onClick={(e) => {
            // tapping the card reveals the answer – but not when tapping the answer box, audio or a hint
            if ((e.target as HTMLElement).closest('input, button, a, details, summary')) return;
            if (!showAnswer) reveal();
          }}
        >
          <CardView
            note={note}
            noteType={nt}
            ord={live.ord}
            side={showAnswer ? 'back' : 'front'}
            deckName={deckPath(get('deck', live.odid || live.deckId))}
            typed={typed}
            onTyped={setTyped}
            onEnter={reveal}
            flag={live.flag}
            autoplay={preset.autoplayAudio}
          />
        </div>

        {showAnswer && intervals ? (
          <div className="answer-bar">
            {([1, 2, 3, 4] as Rating[]).map((r) => (
              <button key={r} className={`ease-btn ${CLS[r]}`} onClick={() => answer(r)}>
                <span className="t">{fmtInterval(intervals[r])}</span>
                <span className="l">{LABELS[r]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="answer-bar single">
            <button className="btn primary show-btn" onClick={reveal}>Show answer <kbd style={{ marginLeft: 6, color: 'inherit', opacity: 0.6 }}>Space</kbd></button>
          </div>
        )}
      </div>
      {modal === 'edit' && <EditNoteModal note={note} onClose={() => setModal(null)} />}
      {modal === 'info' && <CardInfoModal card={live} onClose={() => setModal(null)} />}
    </>
  );
}
