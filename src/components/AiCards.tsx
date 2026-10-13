import { useEffect, useMemo, useState } from 'react';
import { buildPrompt, convertOffline, generateWithClaude, getAiSettings, parseAiReply, type AiCard } from '../lib/ai';
import { addNote, deckPath, ensureDeckPath } from '../lib/collection';
import { all } from '../lib/store';
import { escapeHtml } from '../lib/util';
import { Icon, Seg, toast } from './ui';

export function DeckSelect({ value, onChange, allowNew = true }: { value: string; onChange: (id: string) => void; allowNew?: boolean }) {
  const decks = all('deck').filter((d) => !d.filtered).map((d) => ({ id: d.id, path: deckPath(d) })).sort((a, b) => a.path.localeCompare(b.path));
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === '__new') {
          const name = prompt('New deck (use :: for subdecks, e.g. Biology::Cells)');
          if (name?.trim()) onChange(ensureDeckPath(name.trim()));
        } else onChange(e.target.value);
      }}
    >
      {!value && <option value="">Choose a deck…</option>}
      {decks.map((d) => <option key={d.id} value={d.id}>{d.path}</option>)}
      {allowNew && <option value="__new">+ New deck…</option>}
    </select>
  );
}

/** Add AI/offline-generated cards as notes. Plain text is escaped; maths and cloze markers are kept. */
export function addAiCards(cards: AiCard[], deckId: string, extraTags: string[] = []): number {
  const html = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
  let n = 0;
  for (const c of cards) {
    const tags = [...extraTags, ...(c.tags || [])];
    const r =
      c.type === 'cloze'
        ? addNote({ noteTypeId: 'nt-cloze', deckId, fields: { Text: html(c.text || ''), 'Back Extra': html(c.extra || '') }, tags })
        : addNote({
            noteTypeId: c.type === 'reversed' ? 'nt-basic-reversed' : 'nt-basic',
            deckId,
            fields: { Front: html(c.front), Back: html(c.back) + (c.extra ? `<br><br><span style="opacity:.7">${html(c.extra)}</span>` : '') },
            tags,
          });
    if (r) n += r.cards.length;
  }
  return n;
}

export function AiCardsPanel({
  terms, notes: initialNotes, subject, defaultDeckId, onAdded, tags = [],
}: {
  terms?: { term: string; definition: string }[];
  notes?: string;
  subject?: string;
  defaultDeckId?: string;
  onAdded?: (count: number, deckId: string) => void;
  tags?: string[];
}) {
  const ai = getAiSettings();
  const [route, setRoute] = useState<'claudeai' | 'api' | 'offline'>(ai.apiKey ? 'api' : 'claudeai');
  const [notes, setNotes] = useState(initialNotes || '');
  const [reply, setReply] = useState('');
  const [cards, setCards] = useState<AiCard[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [offlineMode, setOfflineMode] = useState<'auto' | 'basic' | 'reversed' | 'cloze'>('auto');
  const [deckId, setDeckId] = useState(defaultDeckId || '');
  // a deck created after the panel opened (e.g. "Create it") becomes the choice without losing generated cards
  useEffect(() => { if (defaultDeckId) setDeckId(defaultDeckId); }, [defaultDeckId]);
  const prompt = useMemo(() => buildPrompt({ subject, terms, notes }), [subject, terms, notes]);
  const hasInput = (terms && terms.length > 0) || notes.trim().length > 0;

  const show = (cs: AiCard[]) => {
    setCards(cs);
    setKeep(new Set(cs.map((_, i) => i)));
    if (!cs.length) toast("Couldn't find any cards in that reply");
  };

  const run = async () => {
    if (route === 'offline') {
      const src = terms?.length ? terms : notes.split(/\r?\n/).filter((l) => l.includes('\t') || l.includes(' - ')).map((l) => {
        const [a, ...b] = l.split(/\t| - /);
        return { term: a, definition: b.join(' - ') };
      });
      show(convertOffline(src, offlineMode));
      return;
    }
    if (route === 'claudeai') {
      show(parseAiReply(reply));
      return;
    }
    setBusy(true);
    try {
      show(await generateWithClaude(prompt, ai));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), undefined, 6000);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!cards || !deckId) return toast('Choose a deck first');
    const chosen = cards.filter((_, i) => keep.has(i));
    const n = addAiCards(chosen, deckId, tags);
    toast(`Added ${n} cards`);
    onAdded?.(n, deckId);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Prompt copied – paste it into Claude');
    } catch {
      toast('Select the prompt and copy it manually');
    }
  };

  const update = (i: number, p: Partial<AiCard>) => setCards((cs) => cs!.map((c, j) => (j === i ? { ...c, ...p } : c)));

  return (
    <div className="col" style={{ gap: 14 }}>
      {terms === undefined && (
        <label className="field">Your notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste class notes, a revision guide page or a list of facts…" style={{ minHeight: 140 }} />
        </label>
      )}
      <Seg value={route} onChange={setRoute} options={[{ value: 'claudeai', label: 'Claude.ai (free)' }, { value: 'api', label: 'Claude API' }, { value: 'offline', label: 'No AI' }]} />

      {route === 'claudeai' && (
        <div className="col">
          <div className="small muted">1. Copy this prompt → 2. paste it into <a href="https://claude.ai/new" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>claude.ai</a> → 3. paste Claude's reply below.</div>
          <div className="code-box">{hasInput ? prompt : 'Add some material first.'}</div>
          <div className="row">
            <button className="btn" onClick={copy} disabled={!hasInput}><Icon name="copy" /> Copy prompt</button>
            <a className="btn ghost" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open Claude.ai ↗</a>
          </div>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste Claude's reply here (the JSON list)…" style={{ minHeight: 100, fontFamily: 'var(--mono)', fontSize: 12 }} />
        </div>
      )}
      {route === 'api' && (
        <div className="small muted">
          {ai.apiKey ? <>Uses <b>{ai.model}</b> with your API key. </> : <span style={{ color: 'var(--bad)' }}>Add an API key in Settings first. </span>}
          Cards are split into atomic facts, clozes are made for definitions and processes, and exam keywords are kept.
        </div>
      )}
      {route === 'offline' && (
        <div className="row wrap">
          <span className="small muted">Card type:</span>
          <Seg value={offlineMode} onChange={setOfflineMode} options={[{ value: 'auto', label: 'Auto' }, { value: 'basic', label: 'Basic' }, { value: 'reversed', label: 'Both ways' }, { value: 'cloze', label: 'Cloze' }]} />
        </div>
      )}

      <button className="btn primary" onClick={run} disabled={busy || !hasInput || (route === 'claudeai' && !reply.trim()) || (route === 'api' && !ai.apiKey)}>
        {busy ? <><span className="spinner" /> Generating…</> : route === 'claudeai' ? 'Read reply' : <><Icon name="sparkle" /> Generate cards</>}
      </button>

      {cards && (
        <div className="col">
          <div className="row between">
            <b>{keep.size} of {cards.length} cards selected</b>
            <button className="btn ghost sm" onClick={() => setKeep(keep.size === cards.length ? new Set() : new Set(cards.map((_, i) => i)))}>{keep.size === cards.length ? 'None' : 'All'}</button>
          </div>
          <div className="preview-box" style={{ maxHeight: 360 }}>
            {cards.map((c, i) => (
              <div key={i} className="list-row" style={{ alignItems: 'flex-start', opacity: keep.has(i) ? 1 : 0.45 }}>
                <input type="checkbox" checked={keep.has(i)} onChange={() => setKeep((k) => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n; })} style={{ marginTop: 6 }} />
                <div className="grow col" style={{ gap: 6 }}>
                  <div className="row"><span className="pill accent">{c.type}</span>{c.tags?.map((t) => <span key={t} className="pill">{t}</span>)}</div>
                  {c.type === 'cloze' ? (
                    <textarea value={c.text} onChange={(e) => update(i, { text: e.target.value })} style={{ minHeight: 50 }} />
                  ) : (
                    <div className="form-grid">
                      <textarea value={c.front} onChange={(e) => update(i, { front: e.target.value })} style={{ minHeight: 50 }} />
                      <textarea value={c.back} onChange={(e) => update(i, { back: e.target.value })} style={{ minHeight: 50 }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="row wrap">
            <div className="grow"><DeckSelect value={deckId} onChange={setDeckId} /></div>
            <button className="btn primary" disabled={!keep.size || !deckId} onClick={add}>Add {keep.size} to deck</button>
          </div>
        </div>
      )}
    </div>
  );
}
