import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileDrop, Icon, Modal, Seg, TopBar, toast } from '../../components/ui';
import { parseQuizlet, readSpreadsheet } from '../../lib/importers';
import { get, put, useAll } from '../../lib/store';
import type { StudySet, Term } from '../../lib/types';
import { uid } from '../../lib/util';
import { newTerm } from './common';

export function SetEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = id ? get('set', id) : undefined;
  const sets = useAll('set');
  const [s, setS] = useState<StudySet>(
    () =>
      existing || {
        id: uid(), kind: 'set', updatedAt: 0, title: '', description: '', folder: '',
        terms: [newTerm(), newTerm(), newTerm(), newTerm(), newTerm()], createdAt: Date.now(),
      },
  );
  const [importOpen, setImportOpen] = useState(false);
  const folders = useMemo(() => [...new Set(sets.map((x) => x.folder).filter(Boolean))], [sets]);

  const setTerm = (i: number, p: Partial<Term>) => setS((x) => ({ ...x, terms: x.terms.map((t, j) => (j === i ? { ...t, ...p } : t)) }));
  const save = () => {
    const terms = s.terms.filter((t) => t.term.trim() || t.definition.trim());
    if (!s.title.trim()) return toast('Give the set a title');
    if (terms.length < 2) return toast('Add at least two terms');
    put({ ...s, title: s.title.trim(), terms });
    toast('Saved');
    nav(`/quick/${s.id}`, { replace: true });
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/quick', label: 'Quick Learn' }, { label: existing ? 'Edit set' : 'New set' }]} />
      <div className="page-head">
        <h1>{existing ? 'Edit set' : 'Create a new set'}</h1>
        <div className="row">
          <button className="btn" onClick={() => setImportOpen(true)}><Icon name="upload" /> Import</button>
          <button className="btn primary" onClick={save}>{existing ? 'Save' : 'Create'}</button>
        </div>
      </div>
      <div className="col" style={{ gap: 14, maxWidth: 900 }}>
        <input type="text" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder='Title, e.g. "Biology – Cell structure"' style={{ fontSize: 18, fontWeight: 600 }} autoFocus={!existing} />
        <div className="form-grid">
          <input type="text" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="Description (optional)" />
          <input type="text" list="set-folders" value={s.folder} onChange={(e) => setS({ ...s, folder: e.target.value })} placeholder="Folder / subject (optional)" />
          <datalist id="set-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        </div>
        <div className="row between">
          <span className="muted small">{s.terms.filter((t) => t.term.trim()).length} terms</span>
          <button className="btn ghost sm" onClick={() => setS({ ...s, terms: s.terms.map((t) => ({ ...t, term: t.definition, definition: t.term })) })}><Icon name="flip" /> Swap terms and definitions</button>
        </div>
        <div className="panel">
          {s.terms.map((t, i) => (
            <div key={t.id} className="term-row">
              <span className="num muted small" style={{ paddingTop: 10 }}>{i + 1}</span>
              <div>
                <textarea value={t.term} onChange={(e) => setTerm(i, { term: e.target.value })} placeholder="Term" rows={1} />
              </div>
              <div>
                <textarea value={t.definition} onChange={(e) => setTerm(i, { definition: e.target.value })} placeholder="Definition" rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey && i === s.terms.length - 1) setS((x) => ({ ...x, terms: [...x.terms, newTerm()] }));
                  }} />
              </div>
              <button className="btn ghost icon sm" onClick={() => setS({ ...s, terms: s.terms.filter((_, j) => j !== i) })} aria-label="Delete term"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => setS({ ...s, terms: [...s.terms, newTerm()] })}><Icon name="plus" /> Add card</button>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary lg" onClick={save}>{existing ? 'Save' : 'Create'}</button></div>
      </div>
      {importOpen && (
        <ImportTermsModal
          onClose={() => setImportOpen(false)}
          onImport={(items) => {
            setS((x) => ({ ...x, terms: [...x.terms.filter((t) => t.term.trim() || t.definition.trim()), ...items.map((it) => newTerm(it.term, it.definition))] }));
            setImportOpen(false);
          }}
        />
      )}
    </>
  );
}

export function ImportTermsModal({ onClose, onImport }: { onClose: () => void; onImport: (items: { term: string; definition: string }[]) => void }) {
  const [text, setText] = useState('');
  const [termSep, setTermSep] = useState('tab');
  const [customTerm, setCustomTerm] = useState('');
  const [rowSep, setRowSep] = useState('newline');
  const [customRow, setCustomRow] = useState('');
  const items = useMemo(
    () => parseQuizlet(text, termSep === 'custom' ? customTerm || '\t' : termSep, rowSep === 'custom' ? customRow.replace(/\\n/g, '\n') || '\n' : rowSep).filter((x) => x.term),
    [text, termSep, customTerm, rowSep, customRow],
  );
  const loadFile = async (f: File) => {
    if (/\.xlsx$/i.test(f.name)) {
      const sheets = await readSpreadsheet(f);
      setText(sheets[0].rows.filter((r) => r[0]).map((r) => `${r[0] ?? ''}\t${r[1] ?? ''}`).join('\n'));
      setTermSep('tab');
      setRowSep('newline');
    } else {
      setText(await f.text());
      if ((await f.text()).includes('\t')) setTermSep('tab');
      else if (f.name.endsWith('.csv')) setTermSep('comma');
    }
  };
  return (
    <Modal title="Import terms" size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!items.length} onClick={() => onImport(items)}>Import {items.length}</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <p className="muted small">Copy and paste your data here (from Word, Excel, Google Docs, a Quizlet export, etc.) or choose a file.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Word 1\tDefinition 1\nWord 2\tDefinition 2'} style={{ minHeight: 160, fontFamily: 'var(--mono)', fontSize: 13 }} />
        <FileDrop accept=".txt,.csv,.tsv,.xlsx" onFile={loadFile} label="…or drop a .txt, .csv or .xlsx file" />
        <div className="form-grid">
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Between term and definition</span>
            <Seg value={termSep} onChange={setTermSep} options={[{ value: 'tab', label: 'Tab' }, { value: 'comma', label: 'Comma' }, { value: 'dash', label: ' - ' }, { value: 'custom', label: 'Custom' }]} />
            {termSep === 'custom' && <input type="text" value={customTerm} onChange={(e) => setCustomTerm(e.target.value)} placeholder="e.g. :" />}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Between rows</span>
            <Seg value={rowSep} onChange={setRowSep} options={[{ value: 'newline', label: 'New line' }, { value: 'semicolon', label: 'Semicolon' }, { value: 'custom', label: 'Custom' }]} />
            {rowSep === 'custom' && <input type="text" value={customRow} onChange={(e) => setCustomRow(e.target.value)} placeholder="e.g. \n\n" />}
          </div>
        </div>
        {items.length > 0 && (
          <div className="preview-box">
            {items.slice(0, 100).map((it, i) => <div key={i} className="list-row small"><b className="grow">{it.term}</b><span className="grow muted">{it.definition}</span></div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
