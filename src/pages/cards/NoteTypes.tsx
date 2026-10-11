import { useMemo, useState } from 'react';
import { CardView } from '../../components/CardView';
import { Icon, Modal, TopBar, toast } from '../../components/ui';
import { updateNote } from '../../lib/collection';
import { all, put, remove, useAll } from '../../lib/store';
import type { Note, NoteType } from '../../lib/types';
import { uid } from '../../lib/util';

export function NoteTypesPage() {
  const types = useAll('notetype');
  useAll('note');
  const [editing, setEditing] = useState<NoteType | null>(null);
  const count = (id: string) => all('note').filter((n) => n.noteTypeId === id).length;

  const clone = (t: NoteType) => {
    const name = prompt('Name for the new note type', `${t.name} (copy)`);
    if (!name) return;
    const nt: NoteType = { ...t, id: uid(), name, builtin: false };
    put(nt);
    setEditing(nt);
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Note types' }]} />
      <div className="page-head"><div><h1>Note types</h1><div className="sub">Fields, card templates and styling – same template language as Anki.</div></div></div>
      <div className="panel list" style={{ maxWidth: 760 }}>
        {types.map((t) => (
          <div key={t.id} className="list-row">
            <div className="grow">
              <b>{t.name}</b>
              <div className="muted small">{t.fields.join(', ')} · {t.type === 'cloze' ? 'cloze' : `${t.templates.length} card type${t.templates.length > 1 ? 's' : ''}`} · {count(t.id)} notes</div>
            </div>
            <button className="btn sm" onClick={() => clone(t)}><Icon name="copy" /> Clone</button>
            <button className="btn sm" onClick={() => setEditing(t)}><Icon name="edit" /> Edit</button>
            {!t.builtin && (
              <button className="btn sm danger" onClick={() => {
                if (count(t.id)) return toast('Delete or change the type of its notes first');
                if (confirm(`Delete note type "${t.name}"?`)) remove('notetype', t.id);
              }}><Icon name="trash" /></button>
            )}
          </div>
        ))}
      </div>
      {editing && <NoteTypeEditor nt={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NoteTypeEditor({ nt, onClose }: { nt: NoteType; onClose: () => void }) {
  const [t, setT] = useState<NoteType>(nt);
  const [tab, setTab] = useState<'fields' | number | 'css'>('fields');
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [side, setSide] = useState<'front' | 'back'>('front');
  const sample = useMemo<Note>(() => {
    const real = all('note').find((n) => n.noteTypeId === nt.id);
    const fields = Object.fromEntries(t.fields.map((f) => {
      const orig = Object.entries(renames).find(([, nw]) => nw === f)?.[0] || f;
      return [f, real?.fields[orig] ?? (t.type === 'cloze' && f === t.fields[0] ? 'The {{c1::mitochondria}} is the site of aerobic respiration.' : `(${f})`)];
    }));
    return { id: 'preview', kind: 'note', updatedAt: 0, noteTypeId: t.id, deckId: '', fields, tags: [], createdAt: 0 };
  }, [t, nt.id, renames]);

  const save = () => {
    // apply field renames/removals to existing notes
    const notes = all('note').filter((n) => n.noteTypeId === nt.id);
    const updated = notes.map((n) => {
      const fields: Record<string, string> = {};
      for (const f of t.fields) {
        const orig = Object.entries(renames).find(([, nw]) => nw === f)?.[0] || f;
        fields[f] = n.fields[orig] ?? '';
      }
      return { ...n, fields };
    });
    put([t, ...updated]);
    // generate cards for any new templates
    if (t.templates.length > nt.templates.length) updated.forEach((n) => updateNote(n));
    toast('Note type saved');
    onClose();
  };

  const setField = (i: number, name: string) => {
    const old = t.fields[i];
    const fields = [...t.fields];
    fields[i] = name;
    const rep = (s: string) => s.replace(new RegExp(`\\{\\{([#^/]?(?:[\\w-]+:)*)${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'), `{{$1${name}}}`);
    setT({ ...t, fields, templates: t.templates.map((tp) => ({ ...tp, front: rep(tp.front), back: rep(tp.back) })) });
    const origKey = Object.entries(renames).find(([, nw]) => nw === old)?.[0] || old;
    if (nt.fields.includes(origKey)) setRenames({ ...renames, [origKey]: name });
  };

  return (
    <Modal title={`Edit ${t.name}`} size="xwide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <label className="field">Name<input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>Fields</button>
          {t.templates.map((tp, i) => <button key={i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{tp.name}</button>)}
          {t.type !== 'cloze' && <button onClick={() => { setT({ ...t, templates: [...t.templates, { name: `Card ${t.templates.length + 1}`, front: `{{${t.fields[1] || t.fields[0]}}}`, back: `{{FrontSide}}\n\n<hr id=answer>\n\n{{${t.fields[0]}}}` }] }); setTab(t.templates.length); }}>+ Card type</button>}
          <button className={tab === 'css' ? 'on' : ''} onClick={() => setTab('css')}>Styling</button>
        </div>

        {tab === 'fields' && (
          <div className="col">
            {t.fields.map((f, i) => (
              <div key={i} className="row">
                <input type="text" value={f} onChange={(e) => setField(i, e.target.value)} />
                <button className="btn icon sm" disabled={i === 0} onClick={() => { const fs = [...t.fields]; [fs[i - 1], fs[i]] = [fs[i], fs[i - 1]]; setT({ ...t, fields: fs }); }} aria-label="Move up">↑</button>
                <button className="btn icon sm danger" disabled={t.fields.length <= 1} onClick={() => { if (confirm(`Remove field "${f}"? Its content will be deleted from all notes.`)) setT({ ...t, fields: t.fields.filter((_, j) => j !== i) }); }} aria-label="Remove"><Icon name="trash" /></button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setT({ ...t, fields: [...t.fields, `Field ${t.fields.length + 1}`] })}><Icon name="plus" /> Add field</button>
          </div>
        )}

        {typeof tab === 'number' && t.templates[tab] && (
          <div className="grid-2">
            <div className="col">
              <div className="row">
                <input type="text" value={t.templates[tab].name} onChange={(e) => setT({ ...t, templates: t.templates.map((tp, i) => (i === tab ? { ...tp, name: e.target.value } : tp)) })} />
                {t.templates.length > 1 && <button className="btn sm danger" onClick={() => { setT({ ...t, templates: t.templates.filter((_, i) => i !== tab) }); setTab('fields'); }}>Remove</button>}
              </div>
              <label className="field">Front template<textarea value={t.templates[tab].front} onChange={(e) => setT({ ...t, templates: t.templates.map((tp, i) => (i === tab ? { ...tp, front: e.target.value } : tp)) })} style={{ fontFamily: 'var(--mono)', fontSize: 13, minHeight: 120 }} /></label>
              <label className="field">Back template<textarea value={t.templates[tab].back} onChange={(e) => setT({ ...t, templates: t.templates.map((tp, i) => (i === tab ? { ...tp, back: e.target.value } : tp)) })} style={{ fontFamily: 'var(--mono)', fontSize: 13, minHeight: 120 }} /></label>
              <p className="muted tiny">Fields: {t.fields.map((f) => `{{${f}}}`).join(' ')} · {'{{FrontSide}} {{cloze:Field}} {{type:Field}} {{hint:Field}} {{#Field}}…{{/Field}} {{tts en_GB:Field}}'}</p>
            </div>
            <div className="col">
              <div className="row between"><b className="small">Preview</b><div className="btn-group"><button className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>Front</button><button className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>Back</button></div></div>
              <CardView note={sample} noteType={t} ord={t.type === 'cloze' ? 1 : tab} side={side} />
            </div>
          </div>
        )}

        {tab === 'css' && (
          <textarea value={t.css} onChange={(e) => setT({ ...t, css: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 13, minHeight: 240 }} />
        )}
      </div>
    </Modal>
  );
}
