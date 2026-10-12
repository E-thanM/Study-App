import { useEffect, useState } from 'react';
import { Modal, toast } from '../../components/ui';
import { buildSets, installSets, installedSetCount, loadStarterDecks, type StarterDeck } from '../../lib/starter';
import { useAll } from '../../lib/store';

/** Adds one Quick Learn set per exam-board topic, filed under each subject. */
export function StarterSetsModal({ onClose }: { onClose: () => void }) {
  const [decks, setDecks] = useState<StarterDeck[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useAll('set');

  useEffect(() => {
    void loadStarterDecks().then((d) => {
      setDecks(d);
      setChosen(new Set(d.filter((x) => installedSetCount(x) < buildSets(x).length).map((x) => x.key)));
    });
  }, []);

  const info = (d: StarterDeck) => {
    const sets = buildSets(d);
    return { sets: sets.length, terms: sets.reduce((s, x) => s + x.terms.length, 0), installed: installedSetCount(d) };
  };

  const install = () => {
    if (!decks) return;
    let sets = 0, terms = 0, updated = 0;
    for (const d of decks.filter((x) => chosen.has(x.key))) {
      const r = installSets(d);
      sets += r.sets;
      terms += r.terms;
      updated += r.updated;
    }
    toast(sets || updated ? `Added ${sets} sets (${terms} terms)${updated ? `, updated ${updated}` : ''}` : 'Everything was already added');
    onClose();
  };

  const picked = decks?.filter((d) => chosen.has(d.key)) || [];
  const newSets = picked.reduce((s, d) => s + Math.max(0, info(d).sets - info(d).installed), 0);

  return (
    <Modal
      title="GCSE topic sets"
      size="wide"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!chosen.size} onClick={install}>{newSets ? `Add ${newSets} sets` : 'Add / update'}</button></>}
    >
      {!decks ? (
        <div className="row"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <p className="muted small">
            One set for every topic in your exam boards' specifications, filed under the subject. Open a set and use Flashcards, Learn, Test, Match or Spell to cram it for a test. Your progress is kept if you add them again later.
          </p>
          <div className="panel list" style={{ boxShadow: 'none' }}>
            {decks.map((d) => {
              const i = info(d);
              return (
                <label key={d.key} className="list-row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={chosen.has(d.key)} onChange={() => setChosen((c) => { const n = new Set(c); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })} style={{ marginTop: 3 }} />
                  <div className="grow">
                    <div className="row between"><b>{d.name}</b><span className="muted small">{i.sets} sets · {i.terms} terms{i.installed ? ` · ${i.installed} added` : ''}</span></div>
                    <div className="muted small">{d.board}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="callout small">
            These sets are separate from your long-term flashcard decks. Studying a set here doesn't change your spaced-repetition schedule. To keep something for good, open the set and tap <b>Make long-term</b>.
          </div>
        </div>
      )}
    </Modal>
  );
}
