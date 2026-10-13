import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AiCardsPanel, DeckSelect } from '../../components/AiCards';
import { EditNoteModal } from '../../components/CardModals';
import { NoteFields } from '../../components/NoteFields';
import { Icon, Modal, TagInput, TopBar, toast } from '../../components/ui';
import { addNote, deckPath } from '../../lib/collection';
import { all, get, useAll } from '../../lib/store';
import type { Note } from '../../lib/types';
import { stripHtml } from '../../lib/util';

const LAST = 'study.addnote';

export function AddNotePage() {
  const [params] = useSearchParams();
  const noteTypes = useAll('notetype');
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { return {}; } })();
  const [ntId, setNtId] = useState<string>(saved.ntId && get('notetype', saved.ntId) ? saved.ntId : 'nt-basic');
  const [deckId, setDeckId] = useState<string>(params.get('deck') || (saved.deckId && get('deck', saved.deckId) ? saved.deckId : all('deck').find((d) => !d.filtered)?.id || ''));
  const nt = get('notetype', ntId) || noteTypes[0];
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>(saved.tags || []);
  const [history, setHistory] = useState<string[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    localStorage.setItem(LAST, JSON.stringify({ ntId, deckId, tags }));
  }, [ntId, deckId, tags]);

  const allTags = useMemo(() => [...new Set(all('note').flatMap((n) => n.tags))].sort(), []);
  const firstField = nt?.fields[0];
  const dupe = useMemo(() => {
    const v = stripHtml(fields[firstField || ''] || '').trim().toLowerCase();
    if (!v) return false;
    return all('note').some((n) => n.noteTypeId === ntId && stripHtml(n.fields[firstField!] || '').trim().toLowerCase() === v);
  }, [fields, firstField, ntId]);

  const add = () => {
    if (!deckId) return toast('Choose a deck');
    const r = addNote({ noteTypeId: ntId, deckId, fields, tags });
    if (!r) {
      toast(nt.type === 'cloze' ? 'Add a cloze deletion like {{c1::answer}}' : nt.type === 'occlusion' ? 'Choose an image and draw at least one box' : 'The first field is empty');
      return;
    }
    toast(`Added ${r.cards.length} card${r.cards.length === 1 ? '' : 's'}`);
    setHistory((h) => [r.note.id, ...h].slice(0, 30));
    setFields({});
    setFocusKey((k) => k + 1);
  };

  if (!nt) return null;
  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Add' }]} />
      <div className="split" style={{ marginTop: 18 }}>
        <div className="panel pad col" style={{ gap: 16 }} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); add(); } }}>
          <div className="form-grid">
            <label className="field">Type
              <select value={ntId} onChange={(e) => { setNtId(e.target.value); setFields({}); }}>
                {noteTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">Deck<DeckSelect value={deckId} onChange={setDeckId} /></label>
          </div>
          <NoteFields key={`${ntId}-${focusKey}`} noteType={nt} fields={fields} onChange={setFields} autoFocus />
          {dupe && <div className="callout warn small">A note with the same {firstField} already exists.</div>}
          <div>
            <div className="field-label">Tags</div>
            <TagInput value={tags} onChange={setTags} suggestions={allTags} />
          </div>
          <div className="row between wrap">
            <button className="btn" onClick={() => setAiOpen(true)}><Icon name="sparkle" /> Generate from notes</button>
            <button className="btn primary lg" onClick={add}>Add <kbd style={{ color: 'inherit', opacity: 0.6, borderColor: 'currentColor' }}>Ctrl+Enter</kbd></button>
          </div>
        </div>
        <aside className="col" style={{ gap: 14 }}>
          <div className="panel">
            <div className="panel-head"><h3>Added this session</h3><Link to="/cards/browse?q=added:1" className="btn ghost sm">Browse</Link></div>
            <div className="list">
              {history.length ? history.map((id) => {
                const n = get('note', id);
                if (!n) return null;
                return (
                  <div key={id} className="list-row link" onClick={() => setEditing(n)}>
                    <span className="grow ellipsis small">{stripHtml(Object.values(n.fields)[0] || '')}</span>
                    <span className="faint tiny ellipsis" style={{ maxWidth: 110 }}>{deckPath(get('deck', n.deckId))}</span>
                  </div>
                );
              }) : <div className="list-row muted small">Nothing yet.</div>}
            </div>
          </div>
          <div className="callout small">
            <b>Tips for long-term memory</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>One fact per card – split lists into separate cards or clozes.</li>
              <li>Use <b>Cloze</b> for definitions, equations and processes.</li>
              <li>Use <b>Basic (and reversed)</b> for key terms and vocabulary.</li>
              <li>Add an image or example – it makes recall far easier.</li>
              <li>Use <b>Image occlusion</b> to cover up the labels on a diagram (take a photo of your textbook) – each label becomes a card.</li>
            </ul>
          </div>
        </aside>
      </div>
      {editing && <EditNoteModal note={editing} onClose={() => setEditing(null)} />}
      {aiOpen && (
        <Modal title="Generate cards from notes" size="wide" onClose={() => setAiOpen(false)}>
          <AiCardsPanel defaultDeckId={deckId} subject={deckPath(get('deck', deckId))} tags={tags} onAdded={() => setAiOpen(false)} />
        </Modal>
      )}
    </>
  );
}
