import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, MenuButton, Modal, TopBar, toast } from '../../components/ui';
import { childDecks, deckCounts, deckPath, deleteDeck, emptyFiltered, ensureDeckPath, moveDeck, rebuildFiltered, subtreeIds } from '../../lib/collection';
import { compileSearch } from '../../lib/search';
import { all, patch, put, useVersion } from '../../lib/store';
import type { Deck, FilteredConfig } from '../../lib/types';
import { dayNumber, download, fmtHours, uid } from '../../lib/util';
import { deckTotals, todayDone } from '../../lib/collection';
import { DeckOptions } from './DeckOptions';
import { StarterDecksModal } from './StarterDecks';
import { StarterUpdates } from '../../components/StarterUpdates';

export function DeckList() {
  const v = useVersion('deck', 'card', 'revlog', 'preset');
  const nav = useNavigate();
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [filteredOpen, setFilteredOpen] = useState<{ deck?: Deck; search?: string } | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);

  const top = useMemo(() => childDecks(null), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => todayDone(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalCards = useMemo(() => all('card').length, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const newDeck = (parent?: Deck) => {
    const name = prompt(parent ? `New subdeck inside "${parent.name}"` : 'New deck (use "::" for subdecks, e.g. Biology::Cells)');
    if (!name?.trim()) return;
    ensureDeckPath(parent ? `${deckPath(parent)}::${name}` : name, parent?.presetId);
  };

  return (
    <>
      <TopBar crumbs={[{ label: 'Flashcards' }]} />
      <div className="page-head">
        <div>
          <h1>Long-term Flashcards</h1>
          <div className="sub">
            {done.count ? `Studied ${done.count} cards in ${fmtHours(done.timeMs)} today` : `${totalCards} cards · FSRS spaced repetition`}
          </div>
        </div>
        <div className="row wrap">
          <Link to="/cards/add" className="btn primary"><Icon name="plus" /> Add</Link>
          <Link to="/cards/browse" className="btn"><Icon name="browse" /> <span className="hide-sm">Browse</span></Link>
          <Link to="/cards/stats" className="btn"><Icon name="stats" /> <span className="hide-sm">Stats</span></Link>
          <MenuButton
            className="btn icon"
            items={[
              { label: 'Create deck', icon: 'folder', onClick: () => newDeck() },
              { label: 'Add GCSE exam decks', icon: 'sparkle', onClick: () => setStarterOpen(true) },
              { label: 'Create filtered deck', icon: 'search', onClick: () => setFilteredOpen({}) },
              { label: 'Import (Anki, CSV, text)', icon: 'upload', onClick: () => nav('/cards/import') },
              { label: 'Note types', icon: 'note', onClick: () => nav('/cards/notetypes') },
            ]}
          />
        </div>
      </div>

      <StarterUpdates kind="cards" />

      {top.length === 0 ? (
        <div className="panel pad">
          <div className="empty">
            <h3>No decks yet</h3>
            <p>Make a deck per subject (e.g. <b>Biology</b>) with subdecks per topic (<b>Biology::Cells</b>), import an Anki deck, or convert a Quick Learn set.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setStarterOpen(true)}><Icon name="sparkle" /> Add GCSE exam decks</button>
              <button className="btn" onClick={() => newDeck()}><Icon name="folder" /> Create deck</button>
              <Link to="/cards/import" className="btn"><Icon name="upload" /> Import</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="deck-row deck-head">
            <span>Deck</span>
            <span className="num">New</span>
            <span className="num">Learn</span>
            <span className="num">Due</span>
            <span className="num hide-sm" title="Total time studied">Time</span>
            <span />
          </div>
          {top.map((d) => (
            <DeckRow key={d.id} deck={d} depth={0} onOptions={setOptionsFor} onNewSub={newDeck} onFiltered={(deck) => setFilteredOpen({ deck })} />
          ))}
        </div>
      )}

      <p className="muted small mt center hide-touch">Tip: click a deck to study. Keyboard: <kbd>Space</kbd> show answer · <kbd>1</kbd>–<kbd>4</kbd> rate · <kbd>E</kbd> edit · <kbd>Z</kbd> undo</p>
      <p className="muted small mt center show-touch" style={{ display: undefined }}>Tip: tap a deck to study · tap the arrow to see its topics · ⋯ for options</p>

      {starterOpen && <StarterDecksModal onClose={() => setStarterOpen(false)} />}
      {optionsFor && <DeckOptions deckId={optionsFor} onClose={() => setOptionsFor(null)} />}
      {filteredOpen && <FilteredDeckModal deck={filteredOpen.deck?.filtered ? filteredOpen.deck : undefined} initialSearch={filteredOpen.deck && !filteredOpen.deck.filtered ? `deck:"${deckPath(filteredOpen.deck)}"` : filteredOpen.search} onClose={() => setFilteredOpen(null)} />}
    </>
  );
}

function DeckRow({ deck, depth, onOptions, onNewSub, onFiltered }: { deck: Deck; depth: number; onOptions: (id: string) => void; onNewSub: (d: Deck) => void; onFiltered: (d: Deck) => void }) {
  const nav = useNavigate();
  const kids = childDecks(deck.id);
  const c = deckCounts(deck.id);
  const totals = deckTotals(deck.id);
  const open = !deck.collapsed;
  const n = (x: number, cls: string) => <span className={`num ${x ? cls : 'n-zero'}`}>{x}</span>;

  const exportDeck = () => {
    const ids = new Set(subtreeIds(deck.id));
    const notes = all('note').filter((nn) => ids.has(nn.deckId));
    const rows = notes.map((nn) => {
      const nt = all('notetype').find((t) => t.id === nn.noteTypeId);
      const d = all('deck').find((x) => x.id === nn.deckId);
      return { head: [nt?.name || 'Basic', deckPath(d)], fields: Object.values(nn.fields).map((f) => f.replace(/[\t\n]/g, ' ')), tags: nn.tags.join(' ') };
    });
    const fieldCols = Math.max(2, ...rows.map((r) => r.fields.length));
    const header = ['#separator:tab', '#html:true', '#notetype column:1', '#deck column:2', `#tags column:${fieldCols + 3}`];
    const body = rows.map((r) => [...r.head, ...r.fields, ...Array(fieldCols - r.fields.length).fill(''), r.tags].join('\t'));
    download(`${deck.name}.txt`, [...header, ...body].join('\n'));
  };

  return (
    <>
      <div className="deck-row">
        <div className="name" style={{ paddingLeft: depth * 20 }} onClick={() => nav(`/cards/deck/${deck.id}`)}>
          {kids.length ? (
            <button className={`twisty ${open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); patch('deck', deck.id, { collapsed: open }); }} aria-label={open ? 'Collapse' : 'Expand'}>
              <Icon name="chevron" />
            </button>
          ) : (
            <span style={{ width: 20, flex: 'none' }} />
          )}
          {deck.filtered && <Icon name="search" size={14} className="faint" />}
          <span className="label">{deck.name}</span>
        </div>
        {n(c.new, 'n-new')}
        {n(c.learn, 'n-learn')}
        {n(c.review, 'n-review')}
        <span className="num hide-sm muted small" title={`${totals.reviews} reviews`}>{totals.ms ? fmtHours(totals.ms) : '–'}</span>
        <MenuButton
          items={[
            { label: 'Study', icon: 'cards', onClick: () => nav(`/cards/review/${deck.id}`) },
            { label: 'Add cards', icon: 'plus', onClick: () => nav(`/cards/add?deck=${deck.id}`) },
            { label: 'Browse', icon: 'browse', onClick: () => nav(`/cards/browse?q=${encodeURIComponent(`deck:"${deckPath(deck)}"`)}`) },
            deck.filtered ? null : { label: 'Add subdeck', icon: 'folder', onClick: () => onNewSub(deck) },
            { label: 'Rename', icon: 'edit', onClick: () => { const name = prompt('Rename deck', deck.name); if (name?.trim()) patch('deck', deck.id, { name: name.trim().replace(/::/g, ' ') }); } },
            deck.filtered ? null : { label: 'Move to…', icon: 'folder', onClick: () => {
              const target = prompt('Move under which deck? (full name, blank for top level)', deck.parentId ? deckPath(all('deck').find((d) => d.id === deck.parentId)) : '');
              if (target === null) return;
              moveDeck(deck.id, target.trim() ? ensureDeckPath(target.trim()) : null);
            } },
            deck.filtered ? { label: 'Rebuild', icon: 'sync', onClick: () => { const n2 = rebuildFiltered(deck.id, compileSearch(deck.filtered!.search)); toast(`${n2} cards gathered`); } } : { label: 'Options', icon: 'settings', onClick: () => onOptions(deck.id) },
            deck.filtered ? { label: 'Edit search', icon: 'search', onClick: () => onFiltered(deck) } : { label: 'Custom study session…', icon: 'search', onClick: () => onFiltered(deck) },
            deck.filtered ? { label: 'Empty', icon: 'undo', onClick: () => emptyFiltered(deck.id) } : { label: 'Export (Anki text)', icon: 'download', onClick: exportDeck },
            { divider: true, label: '', onClick: () => {} },
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
              const ids = new Set(subtreeIds(deck.id));
              const count = all('card').filter((cc) => ids.has(cc.deckId)).length;
              if (confirm(deck.filtered ? `Delete filtered deck "${deck.name}"? Cards return to their original decks.` : `Delete "${deck.name}" with its subdecks and ${count} cards? This can't be undone.`)) deleteDeck(deck.id);
            } },
          ]}
        />
      </div>
      {open && kids.map((k) => <DeckRow key={k.id} deck={k} depth={depth + 1} onOptions={onOptions} onNewSub={onNewSub} onFiltered={onFiltered} />)}
    </>
  );
}

const PRESETS: { label: string; search: string; order: FilteredConfig['order']; name: string }[] = [
  { label: 'Review forgotten cards (last 1 day)', search: 'rated:1:1', order: 'due', name: 'Forgotten today' },
  { label: 'Review ahead (due in next 7 days)', search: 'prop:due<=7 prop:due>0', order: 'due', name: 'Review ahead' },
  { label: 'Cram everything for a test', search: '-is:new', order: 'random', name: 'Cram' },
  { label: 'Preview new cards', search: 'is:new', order: 'added', name: 'Preview new' },
  { label: 'Weakest cards (low recall)', search: 'prop:r<0.85', order: 'lapses', name: 'Weak cards' },
  { label: 'Leeches', search: 'tag:leech', order: 'lapses', name: 'Leeches' },
];

export function FilteredDeckModal({ deck, initialSearch, onClose }: { deck?: Deck; initialSearch?: string; onClose: () => void }) {
  const nav = useNavigate();
  const base = initialSearch || '';
  const [name, setName] = useState(deck?.name || 'Custom Study Session');
  const [search, setSearch] = useState(deck?.filtered?.search || (base ? `${base} is:due` : 'is:due'));
  const [limit, setLimit] = useState(deck?.filtered?.limit || 100);
  const [order, setOrder] = useState<FilteredConfig['order']>(deck?.filtered?.order || 'due');
  const [extendNew, setExtendNew] = useState(0);
  const sourceDeckId = !deck && base ? all('deck').find((d) => `deck:"${deckPath(d)}"` === base)?.id : undefined;

  let matchCount = 0;
  try {
    const p = compileSearch(search);
    matchCount = all('card').filter((c) => c.queue !== 'suspended' && !c.odid && p(c)).length;
  } catch { /* ignore */ }

  const build = () => {
    const d: Deck = deck
      ? { ...deck, name, filtered: { search, limit, order, reschedule: true } }
      : { id: uid(), kind: 'deck', updatedAt: 0, name, parentId: null, presetId: 'preset-default', filtered: { search, limit, order, reschedule: true }, createdAt: Date.now() };
    put(d);
    const n = rebuildFiltered(d.id, compileSearch(search));
    toast(`${n} cards in "${name}"`);
    onClose();
    nav(`/cards/deck/${d.id}`);
  };

  return (
    <Modal
      title={deck ? 'Edit filtered deck' : 'Custom study'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={build} disabled={!search.trim()}>{deck ? 'Rebuild' : 'Build'}</button></>}
    >
      <div className="col" style={{ gap: 14 }}>
        {!deck && sourceDeckId && (
          <div className="panel pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Increase today's limits</div>
            <div className="row">
              <input type="number" value={extendNew} min={0} onChange={(e) => setExtendNew(Number(e.target.value))} style={{ width: 90 }} />
              <span className="muted small grow">extra new cards today</span>
              <button className="btn sm" disabled={!extendNew} onClick={() => {
                const d = all('deck').find((x) => x.id === sourceDeckId)!;
                const today = dayNumber();
                const cur = d.extend && d.extend.day === today ? d.extend : { day: today, newExtra: 0, revExtra: 0 };
                patch('deck', d.id, { extend: { ...cur, day: today, newExtra: cur.newExtra + extendNew } });
                toast(`+${extendNew} new cards today`);
                onClose();
              }}>Apply</button>
            </div>
          </div>
        )}
        {!deck && (
          <div className="col" style={{ gap: 6 }}>
            {PRESETS.map((p) => (
              <button key={p.label} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => { setSearch(`${base} ${p.search}`.trim()); setOrder(p.order); setName(p.name); }}>{p.label}</button>
            ))}
          </div>
        )}
        <label className="field">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Search <span className="hint">Anki search syntax, e.g. <code>deck:Biology tag:cells is:due</code> · {matchCount} matching cards</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">Limit<input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
          <label className="field">Order
            <select value={order} onChange={(e) => setOrder(e.target.value as FilteredConfig['order'])}>
              <option value="due">Due date</option>
              <option value="random">Random</option>
              <option value="added">Order added</option>
              <option value="lapses">Most lapses</option>
              <option value="interval">Shortest interval</option>
            </select>
          </label>
        </div>
        <p className="muted small">Answers in filtered decks reschedule cards normally; cards return to their home deck once they graduate or when the filtered deck is emptied/deleted.</p>
      </div>
    </Modal>
  );
}
