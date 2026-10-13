import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DeckSelect } from '../../components/AiCards';
import { CardInfoModal } from '../../components/CardModals';
import { FLAG_COLORS } from '../../components/CardView';
import { NoteFields } from '../../components/NoteFields';
import { Icon, MenuButton, Modal, TagInput, TopBar, toast } from '../../components/ui';
import { bury, changeDeck, changeNoteType, deckPath, deleteNotes, forget, reposition, setDueDate, setFlag, suspend, updateNote } from '../../lib/collection';
import { compileSearch } from '../../lib/search';
import { all, get, put, useVersion } from '../../lib/store';
import { CardState, type Card, type Note } from '../../lib/types';
import { dayNumber, fmtInterval, stripHtml } from '../../lib/util';

type SortKey = 'sort' | 'deck' | 'due' | 'ivl' | 'reps' | 'lapses' | 'created' | 'ease';

const QUICK = [
  { label: 'Whole collection', q: '' },
  { label: 'Due today', q: 'is:due' },
  { label: 'New', q: 'is:new' },
  { label: 'Learning', q: 'is:learn' },
  { label: 'Suspended', q: 'is:suspended' },
  { label: 'Leeches', q: 'tag:leech' },
  { label: 'Added today', q: 'added:1' },
  { label: 'Studied today', q: 'rated:1' },
  { label: 'Again today', q: 'rated:1:1' },
  { label: 'Flagged', q: '-flag:0' },
];

export function Browse() {
  const [params, setParams] = useSearchParams();
  const v = useVersion('card', 'note', 'deck', 'notetype', 'revlog');
  const [query, setQuery] = useState(params.get('q') || '');
  const [applied, setApplied] = useState(params.get('q') || '');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [limit, setLimit] = useState(300);
  const [modal, setModal] = useState<null | { kind: 'deck' | 'tags' | 'due' | 'info' | 'notetype' | 'replace' | 'edit'; tagMode?: 'add' | 'remove' }>(null);
  const [sidebar, setSidebar] = useState(false);
  const touchUI = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
  const [selectMode, setSelectMode] = useState(false);

  useEffect(() => { setParams(applied ? { q: applied } : {}, { replace: true }); }, [applied, setParams]);

  const results = useMemo(() => {
    let cards: Card[];
    try {
      cards = all('card').filter(compileSearch(applied));
    } catch {
      cards = [];
    }
    if (notesMode) {
      const seen = new Set<string>();
      cards = cards.filter((c) => (seen.has(c.noteId) ? false : (seen.add(c.noteId), true)));
    }
    const sortVal = (c: Card): number | string => {
      switch (sort.key) {
        case 'sort': return stripHtml(Object.values(get('note', c.noteId)?.fields || {})[0] || '').toLowerCase();
        case 'deck': return deckPath(get('deck', c.deckId)).toLowerCase();
        case 'due': return c.state === CardState.New ? 1e15 + c.position : c.due;
        case 'ivl': return c.scheduledDays;
        case 'reps': return c.reps;
        case 'lapses': return c.lapses;
        case 'ease': return c.difficulty || c.ease;
        default: return c.createdAt;
      }
    };
    return cards.map((c) => [sortVal(c), c] as const).sort((a, b) => (a[0] < b[0] ? -sort.dir : a[0] > b[0] ? sort.dir : 0)).map((x) => x[1]);
  }, [applied, sort, notesMode, v]); // eslint-disable-line react-hooks/exhaustive-deps

  const selCards = results.filter((c) => sel.has(c.id));
  const selIds = selCards.map((c) => c.id);
  const selNoteIds = [...new Set(selCards.map((c) => c.noteId))];
  const single = selCards.length === 1 ? selCards[0] : null;
  const singleNote = single ? get('note', single.noteId) : undefined;

  const decks = useMemo(() => all('deck').map((d) => deckPath(d)).sort(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => [...new Set(all('note').flatMap((n) => n.tags))].sort(), [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (q: string) => { setQuery(q); setApplied(q); setSel(new Set()); setLimit(300); };

  const clickRow = (e: React.MouseEvent, c: Card) => {
    if (touchUI) {
      // touch screens: tap opens the card; in Select mode taps toggle selection
      if (selectMode) {
        const n = new Set(sel);
        if (n.has(c.id)) n.delete(c.id); else n.add(c.id);
        setSel(n);
      } else {
        setSel(new Set([c.id]));
        setModal({ kind: 'edit' });
      }
      return;
    }
    if (e.shiftKey && anchor) {
      const ids = results.map((x) => x.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(c.id)].sort((x, y) => x - y);
      setSel(new Set(ids.slice(a, b + 1)));
    } else if (e.metaKey || e.ctrlKey) {
      const n = new Set(sel);
      if (n.has(c.id)) n.delete(c.id); else n.add(c.id);
      setSel(n);
      setAnchor(c.id);
    } else {
      setSel(new Set([c.id]));
      setAnchor(c.id);
    }
  };

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const today = dayNumber();
  const dueText = (c: Card) => {
    if (c.queue === 'suspended') return '(suspended)';
    if (c.state === CardState.New) return `New #${c.position}`;
    const d = dayNumber(c.due) - today;
    if (c.state !== CardState.Review) return c.due <= Date.now() ? 'now' : fmtInterval(c.due - Date.now());
    return d <= 0 ? (d === 0 ? 'today' : `${-d}d overdue`) : new Date(c.due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  const findReplace = (find: string, repl: string, regex: boolean, field: string) => {
    let re: RegExp;
    try { re = regex ? new RegExp(find, 'g') : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); } catch { return toast('Invalid regex'); }
    let n = 0;
    const out: Note[] = [];
    for (const id of selNoteIds) {
      const note = get('note', id);
      if (!note) continue;
      const f = { ...note.fields };
      let changed = false;
      for (const k of Object.keys(f)) {
        if (field && field !== k) continue;
        const nv = f[k].replace(re, repl);
        if (nv !== f[k]) { f[k] = nv; changed = true; }
      }
      if (changed) { out.push({ ...note, fields: f }); n++; }
    }
    put(out);
    toast(`Updated ${n} notes`);
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Browse' }]} />
      <div className="row wrap" style={{ margin: '12px 0 14px' }}>
        <button className="btn icon" onClick={() => setSidebar(!sidebar)} aria-label="Filters"><Icon name="list" /></button>
        <form className="grow row" onSubmit={(e) => { e.preventDefault(); run(query); }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search cards (e.g. deck:Biology is:due)' />
          <button className="btn primary" type="submit"><Icon name="search" /></button>
        </form>
        <label className="check small"><input type="checkbox" checked={notesMode} onChange={(e) => setNotesMode(e.target.checked)} /> Notes</label>
      </div>

      <div className={`browse-grid ${sidebar ? 'with-side' : ''}`}>
        {sidebar && (
          <aside className="panel browse-side" onClick={(e) => { if ((e.target as HTMLElement).closest('button') && window.matchMedia('(max-width: 640px)').matches) setSidebar(false); }}>
            {QUICK.map((q) => <button key={q.label} className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => run(q.q)}>{q.label}</button>)}
            <div className="section-title" style={{ margin: '12px 8px 4px' }}>Decks</div>
            {decks.map((d) => <button key={d} className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start', paddingLeft: 8 + (d.split('::').length - 1) * 12 }} onClick={() => run(`deck:"${d}"`)}>{d.split('::').pop()}</button>)}
            {tags.length > 0 && <div className="section-title" style={{ margin: '12px 8px 4px' }}>Tags</div>}
            {tags.map((t) => <button key={t} className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => run(`tag:${t}`)}>#{t}</button>)}
            <div className="section-title" style={{ margin: '12px 8px 4px' }}>Flags</div>
            {[1, 2, 3, 4, 5, 6, 7].map((f) => <button key={f} className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => run(`flag:${f}`)}><span className="dot" style={{ background: FLAG_COLORS[f] }} /> Flag {f}</button>)}
          </aside>
        )}
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          <div className="row between wrap">
            <span className="muted small">{results.length} {notesMode ? 'notes' : 'cards'}{sel.size ? ` · ${sel.size} selected` : ''}</span>
            <div className="row wrap">
              {touchUI && <button className={`btn sm ${selectMode ? 'primary' : ''}`} onClick={() => { setSelectMode(!selectMode); setSel(new Set()); }}>{selectMode ? 'Done' : 'Select'}</button>}
              <button className="btn sm" onClick={() => { if (touchUI) setSelectMode(true); setSel(sel.size === results.length ? new Set() : new Set(results.map((c) => c.id))); }}>{sel.size === results.length && results.length ? 'Select none' : 'Select all'}</button>
              {sel.size > 0 && (
                <MenuButton className="btn sm primary" label={<>Actions ({sel.size})</>} items={[
                  single ? { label: 'Edit note', icon: 'edit', onClick: () => setModal({ kind: 'edit' }) } : null,
                  single ? { label: 'Card info', icon: 'note', onClick: () => setModal({ kind: 'info' }) } : null,
                  { label: 'Change deck…', icon: 'folder', onClick: () => setModal({ kind: 'deck' }) },
                  { label: 'Add tags…', icon: 'plus', onClick: () => setModal({ kind: 'tags', tagMode: 'add' }) },
                  { label: 'Remove tags…', icon: 'x', onClick: () => setModal({ kind: 'tags', tagMode: 'remove' }) },
                  { label: 'Find and replace…', icon: 'search', onClick: () => setModal({ kind: 'replace' }) },
                  { label: 'Change note type…', icon: 'note', onClick: () => setModal({ kind: 'notetype' }) },
                  { divider: true, label: '', onClick: () => {} },
                  { label: selCards.every((c) => c.queue === 'suspended') ? 'Unsuspend' : 'Suspend', icon: 'pause', onClick: () => suspend(selIds, !selCards.every((c) => c.queue === 'suspended')) },
                  { label: 'Bury until tomorrow', icon: 'pause', onClick: () => bury(selIds) },
                  { label: 'Unbury', icon: 'undo', onClick: () => bury(selIds, false) },
                  { label: 'Set due date…', icon: 'calendar', onClick: () => setModal({ kind: 'due' }) },
                  { label: 'Forget (reset to new)', icon: 'undo', onClick: () => { if (confirm(`Reset ${selIds.length} cards to new?`)) forget(selIds); } },
                  { label: 'Reposition new cards…', icon: 'list', onClick: () => { const s = prompt('Start position', '1'); if (s) reposition(selIds, Number(s) || 1); } },
                  { label: 'Flag red', icon: 'flag', onClick: () => setFlag(selIds, 1) },
                  { label: 'Flag green', icon: 'flag', onClick: () => setFlag(selIds, 3) },
                  { label: 'Remove flag', icon: 'flag', onClick: () => setFlag(selIds, 0) },
                  { divider: true, label: '', onClick: () => {} },
                  { label: `Delete ${selNoteIds.length} note(s)`, icon: 'trash', danger: true, onClick: () => { if (confirm(`Delete ${selNoteIds.length} notes and all their cards?`)) { deleteNotes(selNoteIds); setSel(new Set()); } } },
                ]} />
              )}
            </div>
          </div>
          <div className="panel" style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {th('sort', 'Sort field')}
                  {!notesMode && <th className="hide-sm">Card</th>}
                  {th('deck', 'Deck', 'hide-sm')}
                  {th('due', 'Due / next review')}
                  {th('ivl', 'Interval', 'hide-sm')}
                  {th('reps', 'Reviews')}
                  {th('lapses', 'Lapses', 'hide-sm')}
                  {th('ease', 'Difficulty', 'hide-sm')}
                  {th('created', 'Created', 'hide-sm')}
                </tr>
              </thead>
              <tbody>
                {results.slice(0, limit).map((c) => {
                  const n = get('note', c.noteId);
                  const nt = get('notetype', n?.noteTypeId);
                  return (
                    <tr key={c.id} className={`${sel.has(c.id) ? 'sel' : ''} ${c.queue === 'suspended' ? 'susp' : ''}`} onClick={(e) => clickRow(e, c)} onDoubleClick={() => { setSel(new Set([c.id])); setModal({ kind: 'edit' }); }}>
                      <td className="browse-first">
                        <div className="row" style={{ gap: 6 }}>
                          {c.flag > 0 && <span className="dot" style={{ background: FLAG_COLORS[c.flag] }} />}
                          <span className="ellipsis">{(nt?.type === 'occlusion' ? `🖼 ${stripHtml(n?.fields.Header || '') || 'Diagram'}` : stripHtml(Object.values(n?.fields || {})[0] || '').slice(0, 140)) || <i className="faint">empty</i>}</span>
                          {!notesMode && nt?.type === 'standard' && c.ord > 0 && <span className="pill show-sm" style={{ fontSize: 10 }}>reverse</span>}
                        </div>
                      </td>
                      {!notesMode && <td className="hide-sm nowrap small muted">{nt?.type === 'cloze' ? `Cloze ${c.ord}` : nt?.type === 'occlusion' ? `Box ${c.ord}` : nt?.templates[c.ord]?.name}</td>}
                      <td className="hide-sm small ellipsis" style={{ maxWidth: 180 }}>{deckPath(get('deck', c.deckId))}</td>
                      <td className="nowrap small">{dueText(c)}</td>
                      <td className="hide-sm small">{c.state === CardState.Review ? `${c.scheduledDays}d` : '–'}</td>
                      <td className="small">{c.reps}</td>
                      <td className="hide-sm small">{c.lapses}</td>
                      <td className="hide-sm small">{c.difficulty ? `${Math.round(((c.difficulty - 1) / 9) * 100)}%` : c.ease ? `${Math.round(c.ease * 100)}%` : '–'}</td>
                      <td className="hide-sm small nowrap muted">{new Date(c.createdAt).toLocaleDateString('en-GB')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {results.length > limit && <div className="center" style={{ padding: 12 }}><button className="btn sm" onClick={() => setLimit(limit + 500)}>Show more ({results.length - limit} left)</button></div>}
            {!results.length && <div className="empty">No cards match.</div>}
          </div>
        </div>
      </div>

      {modal?.kind === 'edit' && singleNote && <InlineEdit note={singleNote} onClose={() => setModal(null)} />}
      {modal?.kind === 'info' && single && <CardInfoModal card={single} onClose={() => setModal(null)} />}
      {modal?.kind === 'deck' && <DeckModal onClose={() => setModal(null)} onPick={(id) => { changeDeck(selIds, id); toast(`Moved ${selIds.length} cards`); setModal(null); }} />}
      {modal?.kind === 'tags' && <TagsModal mode={modal.tagMode!} onClose={() => setModal(null)} onApply={(t) => {
        put(selNoteIds.map((id) => get('note', id)!).filter(Boolean).map((n) => ({ ...n, tags: modal.tagMode === 'add' ? [...new Set([...n.tags, ...t])] : n.tags.filter((x) => !t.includes(x)) })));
        setModal(null);
      }} />}
      {modal?.kind === 'due' && <DueModal onClose={() => setModal(null)} onApply={(s) => { if (setDueDate(selIds, s)) { toast('Due date set'); setModal(null); } else toast('Use e.g. 0, 3, 1-7 or 30!'); }} />}
      {modal?.kind === 'replace' && <ReplaceModal noteIds={selNoteIds} onClose={() => setModal(null)} onApply={(f, r, re, field) => { findReplace(f, r, re, field); setModal(null); }} />}
      {modal?.kind === 'notetype' && <NoteTypeModal noteIds={selNoteIds} onClose={() => setModal(null)} />}
    </>
  );
}

function InlineEdit({ note, onClose }: { note: Note; onClose: () => void }) {
  const nt = get('notetype', note.noteTypeId)!;
  const [fields, setFields] = useState(note.fields);
  const [tags, setTags] = useState(note.tags);
  const [deckId, setDeckId] = useState(note.deckId);
  const save = () => {
    updateNote({ ...note, fields, tags });
    if (deckId !== note.deckId) changeDeck(all('card').filter((c) => c.noteId === note.id).map((c) => c.id), deckId);
    onClose();
  };
  return (
    <Modal title={`Edit · ${nt.name}`} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <label className="field">Deck<DeckSelect value={deckId} onChange={setDeckId} /></label>
        <NoteFields noteType={nt} fields={fields} onChange={setFields} />
        <div><div className="field-label">Tags</div><TagInput value={tags} onChange={setTags} /></div>
      </div>
    </Modal>
  );
}

function DeckModal({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [id, setId] = useState('');
  return (
    <Modal title="Change deck" onClose={onClose} footer={<button className="btn primary" disabled={!id} onClick={() => onPick(id)}>Move</button>}>
      <DeckSelect value={id} onChange={setId} />
    </Modal>
  );
}

function TagsModal({ mode, onClose, onApply }: { mode: 'add' | 'remove'; onClose: () => void; onApply: (t: string[]) => void }) {
  const [t, setT] = useState<string[]>([]);
  return (
    <Modal title={mode === 'add' ? 'Add tags' : 'Remove tags'} onClose={onClose} footer={<button className="btn primary" disabled={!t.length} onClick={() => onApply(t)}>Apply</button>}>
      <TagInput value={t} onChange={setT} suggestions={[...new Set(all('note').flatMap((n) => n.tags))]} />
    </Modal>
  );
}

function DueModal({ onClose, onApply }: { onClose: () => void; onApply: (s: string) => void }) {
  const [s, setS] = useState('0');
  return (
    <Modal title="Set due date" onClose={onClose} footer={<button className="btn primary" onClick={() => onApply(s)}>Apply</button>}>
      <div className="col">
        <input type="text" value={s} onChange={(e) => setS(e.target.value)} autoFocus />
        <p className="muted small">0 = today · 1 = tomorrow · 1-7 = random day in the next week · add ! (e.g. 30!) to also set the interval.</p>
      </div>
    </Modal>
  );
}

function ReplaceModal({ noteIds, onClose, onApply }: { noteIds: string[]; onClose: () => void; onApply: (f: string, r: string, re: boolean, field: string) => void }) {
  const [f, setF] = useState('');
  const [r, setR] = useState('');
  const [re, setRe] = useState(false);
  const [field, setField] = useState('');
  const fieldNames = [...new Set(noteIds.flatMap((id) => Object.keys(get('note', id)?.fields || {})))];
  return (
    <Modal title={`Find and replace (${noteIds.length} notes)`} onClose={onClose} footer={<button className="btn primary" disabled={!f} onClick={() => onApply(f, r, re, field)}>Replace</button>}>
      <div className="col">
        <input type="text" placeholder="Find" value={f} onChange={(e) => setF(e.target.value)} autoFocus />
        <input type="text" placeholder="Replace with" value={r} onChange={(e) => setR(e.target.value)} />
        <select value={field} onChange={(e) => setField(e.target.value)}>
          <option value="">All fields</option>
          {fieldNames.map((n) => <option key={n}>{n}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={re} onChange={(e) => setRe(e.target.checked)} /> Treat input as regular expression</label>
      </div>
    </Modal>
  );
}

function NoteTypeModal({ noteIds, onClose }: { noteIds: string[]; onClose: () => void }) {
  const types = all('notetype');
  const first = get('note', noteIds[0]);
  const from = get('notetype', first?.noteTypeId);
  const [to, setTo] = useState(types.find((t) => t.id !== from?.id)?.id || '');
  const target = get('notetype', to);
  const [map, setMap] = useState<Record<string, string>>({});
  const mixed = noteIds.some((id) => get('note', id)?.noteTypeId !== from?.id);
  const effective = (f: string, i: number) => (f in map ? map[f] : from?.fields[i] || '');
  return (
    <Modal
      title="Change note type"
      onClose={onClose}
      footer={<button className="btn primary" disabled={!target || mixed} onClick={() => {
        changeNoteType(noteIds, to, Object.fromEntries(target!.fields.map((f, i) => [f, effective(f, i)])));
        toast('Note type changed');
        onClose();
      }}>Change</button>}
    >
      {mixed ? <p>Select notes of a single type.</p> : (
        <div className="col">
          <label className="field">New type
            <select value={to} onChange={(e) => { setTo(e.target.value); setMap({}); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {target?.fields.map((f, i) => (
            <label key={f} className="field">{f} ←
              <select value={effective(f, i)} onChange={(e) => setMap({ ...map, [f]: e.target.value })}>
                <option value="">(nothing)</option>
                {from?.fields.map((ff) => <option key={ff}>{ff}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
