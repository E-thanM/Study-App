import { useEffect, useState } from 'react';
import { applyFixes, dismissFixes, installSets, installStarter, loadStarterDecks, markSeen, pendingCards, pendingFixes, pendingSets, type StarterDeck } from '../lib/starter';
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
  const fixes = kind === 'cards' ? decks.map((d) => ({ d, n: pendingFixes(d) })).filter((x) => x.n > 0) : [];
  if (!pending.length && !fixes.length) return null;
  const fixTotal = fixes.reduce((s, x) => s + x.n, 0);
  const fixBanner = fixes.length > 0 && (
    <div className="callout mb" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>
        <b>Improved GCSE flashcards available</b>
        <div className="small muted">{fixes.map(({ d, n }) => `${d.name} (${n})`).join(' · ')} – better answers for cards you already have. Your progress is kept; any edits you made to those cards are replaced.</div>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={() => { let n = 0; for (const { d } of fixes) n += applyFixes(d); toast(`Updated ${n} cards`); }}>Update {fixTotal} cards</button>
        <button className="btn ghost sm" onClick={() => fixes.forEach(({ d }) => dismissFixes(d))}>Not now</button>
      </div>
    </div>
  );
  if (!pending.length) return fixBanner;

  const total = pending.reduce((s, x) => s + x.n, 0);
  const unit = kind === 'cards' ? 'cards' : 'terms';
  const add = () => {
    for (const { d } of pending) (kind === 'cards' ? installStarter(d) : installSets(d));
    toast(`Added ${total} new ${unit}`);
  };
  const dismiss = () => pending.forEach(({ d }) => markSeen(kind, d));

  return (
    <>
    {fixBanner}
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
    </>
  );
}
