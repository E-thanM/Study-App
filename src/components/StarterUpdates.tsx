import { useEffect, useState } from 'react';
import { applyFixes, applyRetired, dismissFixes, dismissRetired, pendingRetired, installSets, installStarter, loadStarterDecks, markSeen, pendingCards, pendingFixes, pendingSets, starterLabel, type StarterDeck } from '../lib/starter';
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
    void loadStarterDecks(true).then(setDecks);
  }, []);

  const pending = decks
    .map((d) => ({ d, n: kind === 'cards' ? pendingCards(d) : pendingSets(d) }))
    .filter((x) => x.n > 0);
  const trims = kind === 'cards' ? decks.map((d) => ({ d, ...pendingRetired(d) })).filter((x) => x.total > 0) : [];
  const fixes = kind === 'cards' ? decks.map((d) => ({ d, n: pendingFixes(d) })).filter((x) => x.n > 0) : [];
  if (!pending.length && !fixes.length && !trims.length) return null;
  const fixTotal = fixes.reduce((s, x) => s + x.n, 0);
  const fixBanner = fixes.length > 0 && (
    <div className="callout mb" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>
        <b>Improved GCSE flashcards available</b>
        <div className="small muted">{fixes.map(({ d, n }) => `${starterLabel(d)} (${n})`).join(' · ')} – better answers for cards you already have. Your progress is kept; any edits you made to those cards are replaced.</div>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={() => { let n = 0; for (const { d } of fixes) n += applyFixes(d); toast(`Updated ${n} cards`); }}>Update {fixTotal} cards</button>
        <button className="btn ghost sm" onClick={() => fixes.forEach(({ d }) => dismissFixes(d))}>Not now</button>
      </div>
    </div>
  );
  const trimTotal = trims.reduce((s, x) => s + x.total, 0);
  const trimStudied = trims.reduce((s, x) => s + x.studied, 0);
  const trimBanner = trims.length > 0 && (
    <div className="callout mb" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>
        <b>Trim flashcards that are more detailed than the exam needs</b>
        <div className="small muted">
          {trims.map(({ d, total }) => `${starterLabel(d)}${d.notes.length ? '' : ' – whole subject removed'} (${total})`).join(' · ')} – trivia and extra detail beyond the specification. {trimStudied > 0 ? `${trimStudied} of them you've already studied; their review history will go too.` : "You haven't studied any of them."}
        </div>
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={() => { let n = 0; for (const { d } of trims) n += applyRetired(d); toast(`Removed ${n} cards`); }}>Remove {trimTotal} cards</button>
        <button className="btn ghost sm" onClick={() => trims.forEach(({ d }) => dismissRetired(d))}>Keep them</button>
      </div>
    </div>
  );
  const extras = <>{fixBanner}{trimBanner}</>;
  if (!pending.length) return extras;

  const total = pending.reduce((s, x) => s + x.n, 0);
  const unit = kind === 'cards' ? 'cards' : 'terms';
  const add = () => {
    for (const { d } of pending) (kind === 'cards' ? installStarter(d) : installSets(d));
    toast(`Added ${total} new ${unit}`);
  };
  const dismiss = () => pending.forEach(({ d }) => markSeen(kind, d));

  return (
    <>
    {extras}
    <div className="callout mb" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 200 }}>
        <b>New GCSE {kind === 'cards' ? 'flashcards' : 'topic sets'} available</b>
        <div className="small muted">
          {pending.map(({ d, n }) => `${starterLabel(d)} (+${n})`).join(' · ')}
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
