import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { speak } from '../../components/CardView';
import { Icon, MenuButton, Progress, TopBar, toast } from '../../components/ui';
import { get, put, remove } from '../../lib/store';
import { deckPath } from '../../lib/collection';
import { download, uid } from '../../lib/util';
import { isVocabLike, resetProgress, toggleStar, useProgress, useSet } from './common';

export function SetView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const set = useSet(id);
  const prog = useProgress(id);
  const [flipped, setFlipped] = useState(false);
  const [idx, setIdx] = useState(0);
  if (!set) return <><TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }]} /><div className="empty">Set not found.</div></>;

  const levels = set.terms.map((t) => prog.terms[t.id]?.level || 0);
  const mastered = levels.filter((l) => l >= 3).length;
  const learning = levels.filter((l) => l > 0 && l < 3).length;
  const t = set.terms[Math.min(idx, set.terms.length - 1)];
  const convertedDeck = set.convertedDeckId ? get('deck', set.convertedDeckId) : undefined;

  const modes = [
    { to: 'flashcards', icon: 'cards', label: 'Flashcards' },
    { to: 'learn', icon: 'learn', label: 'Learn' },
    { to: 'test', icon: 'test', label: 'Test' },
    { to: 'match', icon: 'match', label: 'Match' },
    // Spell types out each term, so it only suits vocabulary-style sets
    ...(isVocabLike(set.terms) ? [{ to: 'spell', icon: 'speaker', label: 'Spell' }] : []),
  ];

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { label: set.title }]} />
      <div className="page-head">
        <div>
          {set.folder && <div className="muted small">{set.folder}</div>}
          <h1>{set.title}</h1>
          {set.description && <div className="sub">{set.description}</div>}
        </div>
        <div className="row">
          <Link to={`/quick/${id}/convert`} className="btn accent"><Icon name="sparkle" /> Make long-term</Link>
          <MenuButton className="btn icon" items={[
            { label: 'Edit', icon: 'edit', onClick: () => nav(`/quick/${id}/edit`) },
            { label: 'Duplicate', icon: 'copy', onClick: () => { const n = { ...set, id: uid(), title: `${set.title} (copy)`, createdAt: Date.now(), convertedDeckId: undefined }; put(n); nav(`/quick/${n.id}`); } },
            { label: 'Export (tab separated)', icon: 'download', onClick: () => download(`${set.title}.txt`, set.terms.map((x) => `${x.term.replace(/\t|\n/g, ' ')}\t${x.definition.replace(/\t|\n/g, ' ')}`).join('\n')) },
            { label: 'Reset progress', icon: 'undo', onClick: () => { if (confirm('Reset Learn progress for this set?')) resetProgress(id); } },
            { divider: true, label: '', onClick: () => {} },
            { label: 'Delete set', icon: 'trash', danger: true, onClick: () => { if (confirm(`Delete "${set.title}"?`)) { remove('set', id); remove('setprogress', `prog-${id}`); nav('/quick'); } } },
          ]} />
        </div>
      </div>

      <div className="mode-grid mb">
        {modes.map((m) => (
          <Link key={m.to} to={`/quick/${id}/${m.to}`} className="mode-card"><Icon name={m.icon} /> {m.label}</Link>
        ))}
      </div>

      {t && (
        <div className="flip-stage mb" style={{ maxWidth: 720, margin: '0 0 18px' }}>
          <div className={`flipcard ${flipped ? 'flipped' : ''}`} style={{ aspectRatio: '16 / 8' }} onClick={() => setFlipped(!flipped)}>
            <div className="side"><span className="corner">Term</span>{t.term}</div>
            <div className="side back"><span className="corner">Definition</span>{t.definition}</div>
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn icon" onClick={() => { setIdx((idx - 1 + set.terms.length) % set.terms.length); setFlipped(false); }} aria-label="Previous"><Icon name="back" /></button>
            <span className="muted small" style={{ minWidth: 60, textAlign: 'center' }}>{idx + 1} / {set.terms.length}</span>
            <button className="btn icon" onClick={() => { setIdx((idx + 1) % set.terms.length); setFlipped(false); }} aria-label="Next"><Icon name="chevron" /></button>
          </div>
        </div>
      )}

      <div className="panel pad mb" style={{ maxWidth: 720 }}>
        <div className="row between small" style={{ marginBottom: 8 }}>
          <b>Your progress</b>
          <span className="muted">{mastered} mastered · {learning} still learning · {set.terms.length - mastered - learning} not studied</span>
        </div>
        <Progress parts={[{ value: mastered, color: 'var(--good)' }, { value: learning, color: 'var(--warn)' }, { value: set.terms.length - mastered - learning, color: 'var(--line)' }]} />
        {convertedDeck && <div className="small muted" style={{ marginTop: 10 }}>✓ Added to long-term deck <Link to={`/cards/deck/${convertedDeck.id}`} style={{ color: 'var(--accent)' }}>{deckPath(convertedDeck)}</Link></div>}
      </div>

      <div className="section-title">Terms in this set ({set.terms.length})</div>
      <div className="panel list">
        {set.terms.map((x) => {
          const lv = prog.terms[x.id]?.level || 0;
          return (
            <div key={x.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span className="dot" style={{ marginTop: 8, background: lv >= 3 ? 'var(--good)' : lv > 0 ? 'var(--warn)' : 'var(--line-strong)' }} title={lv >= 3 ? 'Mastered' : lv > 0 ? 'Learning' : 'Not studied'} />
              <div className="grow" style={{ whiteSpace: 'pre-wrap', fontWeight: 550 }}>{x.term}</div>
              <div className="grow muted" style={{ whiteSpace: 'pre-wrap' }}>{x.definition}</div>
              <button className="btn ghost icon sm" onClick={() => speak(x.term)} aria-label="Speak"><Icon name="speaker" /></button>
              <button className="btn ghost icon sm" onClick={() => { toggleStar(set, x.id); toast(x.starred ? 'Unstarred' : 'Starred'); }} aria-label="Star" style={{ color: x.starred ? 'var(--warn)' : undefined }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill={x.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" /></svg>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
