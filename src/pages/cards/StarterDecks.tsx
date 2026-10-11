import { useEffect, useState } from 'react';
import { Modal, toast } from '../../components/ui';
import { ensureStarterPreset, installStarter, loadStarterDecks, type StarterDeck } from '../../lib/starter';
import { all } from '../../lib/store';

export function StarterDecksModal({ onClose }: { onClose: () => void }) {
  const [decks, setDecks] = useState<StarterDeck[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [perDay, setPerDay] = useState(6);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadStarterDecks().then((d) => {
      setDecks(d);
      setChosen(new Set(d.map((x) => x.key)));
    });
  }, []);

  const installed = (d: StarterDeck) => {
    const prefix = `starter:${d.key}:`;
    return all('note').filter((n) => n.guid?.startsWith(prefix)).length;
  };

  const install = () => {
    if (!decks) return;
    setBusy(true);
    ensureStarterPreset(perDay);
    let cards = 0, skipped = 0;
    for (const d of decks.filter((x) => chosen.has(x.key))) {
      const r = installStarter(d);
      cards += r.cards;
      skipped += r.skipped;
    }
    setBusy(false);
    toast(`Added ${cards} cards${skipped ? ` (${skipped} already installed)` : ''}`);
    onClose();
  };

  const total = decks?.filter((d) => chosen.has(d.key)).reduce((s, d) => s + d.notes.length, 0) || 0;
  const days = Math.ceil(Math.max(...(decks || []).filter((d) => chosen.has(d.key)).map((d) => d.notes.length), 0) / Math.max(1, perDay));

  return (
    <Modal
      title="GCSE exam decks"
      size="wide"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!chosen.size || busy} onClick={install}>Add {total} notes</button></>}
    >
      {!decks ? (
        <div className="row"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <p className="muted small">
            Ready-made decks built from each specification, organised into subject → topic subdecks. They use spaced repetition, so new cards are introduced a few a day and reviewed just before you'd forget them.
          </p>
          <div className="panel list" style={{ boxShadow: 'none' }}>
            {decks.map((d) => {
              const inst = installed(d);
              return (
                <label key={d.key} className="list-row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={chosen.has(d.key)} onChange={() => setChosen((c) => { const n = new Set(c); if (n.has(d.key)) n.delete(d.key); else n.add(d.key); return n; })} style={{ marginTop: 3 }} />
                  <div className="grow">
                    <div className="row between"><b>{d.name}</b><span className="muted small">{d.notes.length} notes{inst ? ` · ${inst} installed` : ''}</span></div>
                    <div className="muted small">{d.board}</div>
                    <div className="faint tiny" style={{ marginTop: 2 }}>{d.topics.join(' · ')}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <label className="field">
            New cards per subject per day: <b style={{ color: 'var(--ink)' }}>{perDay}</b> (about {perDay * chosen.size} a day in total)
            <input type="range" min={2} max={20} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} />
            <span className="hint">At this pace every chosen deck is fully introduced in about {days} days. You can change it later in deck Options.</span>
          </label>
          <div className="callout small">
            History uses the most common Edexcel options (Medicine + Western Front, Early Elizabethan England, Cold War, Weimar & Nazi Germany) – delete any subdeck you don't study. Edit any card with <kbd>E</kbd> while reviewing to match your teacher's notes.
          </div>
        </div>
      )}
    </Modal>
  );
}
