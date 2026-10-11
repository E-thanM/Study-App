import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AiCardsPanel } from '../../components/AiCards';
import { TopBar } from '../../components/ui';
import { deckByPath, ensureDeckPath } from '../../lib/collection';
import { get, patch } from '../../lib/store';
import { useSet } from './common';

/** Turn a short-term set into long-term spaced-repetition cards. */
export function ConvertPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const set = useSet(id);
  const terms = useMemo(() => set?.terms.filter((t) => t.term.trim()).map((t) => ({ term: t.term, definition: t.definition })) || [], [set]);
  // default target: Folder::Title (e.g. Biology::Cell structure) – created only if chosen
  const defaultDeck = useMemo(() => {
    if (!set) return '';
    if (set.convertedDeckId && get('deck', set.convertedDeckId)) return set.convertedDeckId;
    const path = [set.folder, set.title].filter(Boolean).join('::');
    return deckByPath(path)?.id || '';
  }, [set]);
  if (!set) return null;
  const suggested = [set.folder, set.title].filter(Boolean).join('::');

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { to: `/quick/${id}`, label: set.title }, { label: 'Make long-term' }]} />
      <div style={{ maxWidth: 860, margin: '18px auto 0' }} className="col">
        <div>
          <h1>Move “{set.title}” into long-term memory</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Quick Learn gets it into your head for tomorrow. Spaced-repetition cards keep it there until the exam. AI rewrites the terms into atomic questions and cloze deletions – the format that's proven to stick.
          </p>
        </div>
        {!defaultDeck && (
          <div className="callout small row between wrap">
            <span>Suggested deck: <b>{suggested}</b></span>
            <button className="btn sm" onClick={() => { const d = ensureDeckPath(suggested); patch('set', id, { convertedDeckId: d }); }}>Create it</button>
          </div>
        )}
        <div className="panel pad">
          <AiCardsPanel
            key={defaultDeck}
            terms={terms}
            subject={[set.folder, set.title].filter(Boolean).join(' – ')}
            defaultDeckId={defaultDeck}
            tags={[set.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')].filter(Boolean)}
            onAdded={(_n, deckId) => { patch('set', id, { convertedDeckId: deckId }); nav(`/cards/deck/${deckId}`); }}
          />
        </div>
        <p className="muted small center">Prefer to keep it simple? Choose <b>No AI</b> to copy the terms across as they are. <Link to={`/quick/${id}`} style={{ color: 'var(--accent)' }}>Back to set</Link></p>
      </div>
    </>
  );
}
