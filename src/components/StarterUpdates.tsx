import { useEffect, useState } from 'react';
import { installSets, installStarter, loadStarterDecks, markSeen, pendingCards, pendingSets, type StarterDeck } from '../lib/starter';
import { useVersion } from '../lib/store';
import { toast } from './ui';

/**
 * "New GCSE content available" banner. Appears when the app has been updated with extra starter
 * cards (or topic sets) for a subject the user already added. Nothing is added without a tap.
 */
export function StarterUpdates({ kind }: { kind: 'cards' | 'sets' }) {
  const [decks, setDecks] = useState<StarterDeck[]>([]);
  useVersion('note', 'set', 'settings');
  useEffect(() => {
    void loadStarterDecks().then(setDecks);
  }, []);

  const pending = decks
    .map((d) => ({ d, n: kind === 'cards' ? pendingCards(d) : pendingSets(d) }))
    .filter((x) => x.n > 0);
  if (!pending.length) return null;

  const total = pending.reduce((s, x) => s + x.n, 0);
  const unit = kind === 'cards' ? 'cards' : 'terms';
  const add = () => {
    for (const { d } of pending) (kind === 'cards' ? installStarter(d) : installSets(d));
    toast(`Added ${total} new ${unit}`);
  };
  const dismiss = () => pending.forEach(({ d }) => markSeen(kind, d));

  return (
    <div className="callout mb" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>
        <b>New GCSE {kind === 'cards' ? 'flashcards' : 'topic sets'} available</b>
        <div className="small muted">
          {pending.map(({ d, n }) => `${d.name} (+${n})`).join(' · ')}
        </div>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={add}>Add {total} {unit}</button>
        <button className="btn ghost sm" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
