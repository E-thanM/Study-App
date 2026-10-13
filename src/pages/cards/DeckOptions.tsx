import { useState } from 'react';
import { Modal, Seg, toast } from '../../components/ui';
import { subtreeIds } from '../../lib/collection';
import { validSteps } from '../../lib/scheduler';
import { DEFAULT_PRESET, getPreset } from '../../lib/seed';
import { all, get, patch, put, remove, useAll } from '../../lib/store';
import type { Preset } from '../../lib/types';
import { uid } from '../../lib/util';

function Num({ label, value, onChange, step = 1, min = 0, max, hint }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="field">
      {label}
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function DeckOptions({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const deck = get('deck', deckId)!;
  const presets = useAll('preset');
  const [presetId, setPresetId] = useState(deck.presetId);
  const [p, setP] = useState<Preset>(() => getPreset(deck.presetId));
  const [learnText, setLearnText] = useState(p.learningSteps.join(' '));
  const [relearnText, setRelearnText] = useState(p.relearningSteps.join(' '));
  const [tab, setTab] = useState<'daily' | 'algo' | 'advanced'>('daily');
  const set = (x: Partial<Preset>) => setP((cur) => ({ ...cur, ...x }));
  const usage = (id: string) => all('deck').filter((d) => d.presetId === id).length;

  const switchPreset = (id: string) => {
    setPresetId(id);
    const np = getPreset(id);
    setP(np);
    setLearnText(np.learningSteps.join(' '));
    setRelearnText(np.relearningSteps.join(' '));
  };

  const save = (applyToChildren = false) => {
    const learningSteps = learnText.split(/\s+/).filter(Boolean);
    const relearningSteps = relearnText.split(/\s+/).filter(Boolean);
    if (!validSteps(learningSteps) || !validSteps(relearningSteps)) return toast('Steps look like "1m 10m 1h 1d"');
    if (p.desiredRetention < 0.7 || p.desiredRetention > 0.99) return toast('Desired retention should be between 0.70 and 0.99');
    put({ ...p, id: presetId, learningSteps, relearningSteps });
    patch('deck', deckId, { presetId });
    if (applyToChildren) put(subtreeIds(deckId).map((id) => get('deck', id)!).map((d) => ({ ...d, presetId })));
    toast('Options saved');
    onClose();
  };

  return (
    <Modal
      title={`Options – ${deck.name}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" style={{ marginRight: 'auto' }} onClick={() => save(true)}>Save to all subdecks</button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => save(false)}>Save</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="row wrap">
          <label className="field grow" style={{ flex: '1 1 220px', minWidth: 200 }}>Preset
            <select value={presetId} onChange={(e) => switchPreset(e.target.value)}>
              {presets.map((x) => <option key={x.id} value={x.id}>{x.name} (used by {usage(x.id)})</option>)}
            </select>
          </label>
          <div className="row wrap" style={{ alignSelf: 'flex-end' }}>
            <button className="btn sm" onClick={() => { const name = prompt('New preset name', `${p.name} copy`); if (!name) return; const np = { ...p, id: uid(), name }; put(np); switchPreset(np.id); }}>Clone</button>
            <button className="btn sm" onClick={() => { const name = prompt('Rename preset', p.name); if (name) set({ name }); }}>Rename</button>
            <button className="btn sm" onClick={() => { const np = { ...DEFAULT_PRESET, id: presetId, name: p.name }; setP(np); setLearnText(np.learningSteps.join(' ')); setRelearnText(np.relearningSteps.join(' ')); }}>Defaults</button>
            {presetId !== DEFAULT_PRESET.id && (
              <button className="btn sm danger" onClick={() => {
                if (!confirm('Delete this preset? Decks using it will switch to Default.')) return;
                put(all('deck').filter((d) => d.presetId === presetId).map((d) => ({ ...d, presetId: DEFAULT_PRESET.id })));
                remove('preset', presetId);
                switchPreset(DEFAULT_PRESET.id);
              }}>Delete</button>
            )}
          </div>
        </div>

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'daily' ? 'on' : ''} onClick={() => setTab('daily')}>Daily limits & steps</button>
          <button className={tab === 'algo' ? 'on' : ''} onClick={() => setTab('algo')}>Scheduler</button>
          <button className={tab === 'advanced' ? 'on' : ''} onClick={() => setTab('advanced')}>Lapses, burying & display</button>
        </div>

        {tab === 'daily' && (
          <div className="form-grid">
            <Num label="New cards/day" value={p.newPerDay} onChange={(n) => set({ newPerDay: n })} hint="Each new card creates ~10 reviews over the next weeks." />
            <Num label="Maximum reviews/day" value={p.reviewsPerDay} onChange={(n) => set({ reviewsPerDay: n })} />
            <label className="field">Learning steps<input type="text" value={learnText} onChange={(e) => setLearnText(e.target.value)} /><span className="hint">e.g. "1m 10m" – s, m, h, d units</span></label>
            <label className="field">Relearning steps<input type="text" value={relearnText} onChange={(e) => setRelearnText(e.target.value)} /><span className="hint">for cards you forget</span></label>
            <label className="field">New card order
              <select value={p.newCardOrder} onChange={(e) => set({ newCardOrder: e.target.value as Preset['newCardOrder'] })}>
                <option value="added">Order added</option>
                <option value="random">Random</option>
              </select>
            </label>
            <label className="field">New/review order
              <select value={p.newReviewMix} onChange={(e) => set({ newReviewMix: e.target.value as Preset['newReviewMix'] })}>
                <option value="mix">Mix with reviews</option>
                <option value="after">Show after reviews</option>
                <option value="before">Show before reviews</option>
              </select>
            </label>
          </div>
        )}

        {tab === 'algo' && (
          <div className="col" style={{ gap: 14 }}>
            <Seg value={p.algorithm} onChange={(algorithm) => set({ algorithm })} options={[{ value: 'fsrs', label: 'FSRS (recommended)' }, { value: 'sm2', label: 'SM-2 (legacy Anki)' }]} />
            {p.algorithm === 'fsrs' ? (
              <>
                <label className="field">
                  Desired retention: <b style={{ color: 'var(--ink)' }}>{Math.round(p.desiredRetention * 100)}%</b>
                  <input type="range" min={0.7} max={0.99} step={0.01} value={p.desiredRetention} onChange={(e) => set({ desiredRetention: Number(e.target.value) })} />
                  <span className="hint">The chance you'll remember a card when it comes up. 90% is the sweet spot; 92–95% before exams costs noticeably more reviews.</span>
                </label>
                <div className="form-grid">
                  <Num label="Maximum interval (days)" value={p.maxInterval} onChange={(n) => set({ maxInterval: n })} min={1} hint="Lower this to e.g. 180 so nothing drifts past your exams." />
                </div>
                <label className="field">FSRS parameters (optional)
                  <input type="text" value={(p.fsrsWeights || []).join(', ')} onChange={(e) => set({ fsrsWeights: e.target.value.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite) })} placeholder="Leave blank for defaults, or paste optimised parameters from Anki" />
                  <span className="hint">FSRS uses well-tested default parameters. If you've optimised parameters in desktop Anki (Deck options → FSRS → Optimise), paste them here.</span>
                </label>
              </>
            ) : (
              <div className="form-grid">
                <Num label="Graduating interval (days)" value={p.graduatingInterval} onChange={(n) => set({ graduatingInterval: n })} min={1} />
                <Num label="Easy interval (days)" value={p.easyInterval} onChange={(n) => set({ easyInterval: n })} min={1} />
                <Num label="Starting ease" value={p.startingEase} step={0.05} onChange={(n) => set({ startingEase: n })} min={1.3} />
                <Num label="Easy bonus" value={p.easyBonus} step={0.05} onChange={(n) => set({ easyBonus: n })} min={1} />
                <Num label="Interval modifier" value={p.intervalModifier} step={0.05} onChange={(n) => set({ intervalModifier: n })} min={0.1} />
                <Num label="Hard interval" value={p.hardInterval} step={0.05} onChange={(n) => set({ hardInterval: n })} min={1} />
                <Num label="New interval (after lapse)" value={p.newInterval} step={0.05} onChange={(n) => set({ newInterval: n })} max={1} />
                <Num label="Minimum interval (days)" value={p.minInterval} onChange={(n) => set({ minInterval: n })} min={1} />
                <Num label="Maximum interval (days)" value={p.maxInterval} onChange={(n) => set({ maxInterval: n })} min={1} />
              </div>
            )}
          </div>
        )}

        {tab === 'advanced' && (
          <div className="col" style={{ gap: 14 }}>
            <div className="form-grid">
              <Num label="Leech threshold (lapses)" value={p.leechThreshold} onChange={(n) => set({ leechThreshold: n })} />
              <label className="field">Leech action
                <select value={p.leechAction} onChange={(e) => set({ leechAction: e.target.value as Preset['leechAction'] })}>
                  <option value="tag">Tag only</option>
                  <option value="suspend">Suspend card</option>
                </select>
              </label>
              <Num label="Maximum answer seconds" value={p.maxAnswerSeconds} onChange={(n) => set({ maxAnswerSeconds: n })} min={5} hint="Time beyond this isn't counted in stats." />
            </div>
            <label className="check"><input type="checkbox" checked={p.buryNewSiblings} onChange={(e) => set({ buryNewSiblings: e.target.checked })} /> Bury new siblings until tomorrow</label>
            <label className="check"><input type="checkbox" checked={p.buryReviewSiblings} onChange={(e) => set({ buryReviewSiblings: e.target.checked })} /> Bury review siblings until tomorrow</label>
            <label className="check"><input type="checkbox" checked={p.showTimer} onChange={(e) => set({ showTimer: e.target.checked })} /> Show answer timer</label>
            <label className="check"><input type="checkbox" checked={p.autoplayAudio} onChange={(e) => set({ autoplayAudio: e.target.checked })} /> Play audio automatically</label>
          </div>
        )}
      </div>
    </Modal>
  );
}
