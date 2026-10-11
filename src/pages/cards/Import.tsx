import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeckSelect } from '../../components/AiCards';
import { FileDrop, Seg, TagInput, TopBar, toast } from '../../components/ui';
import { importApkg, type ApkgResult } from '../../lib/apkg';
import { addNote, deckByPath, ensureDeckPath } from '../../lib/collection';
import { parseAnkiText, parseQuizlet, readSpreadsheet } from '../../lib/importers';
import { all, get, put, useAll } from '../../lib/store';
import { escapeHtml, stripHtml } from '../../lib/util';

export function ImportPage() {
  const [tab, setTab] = useState<'apkg' | 'text' | 'paste'>('apkg');
  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Import' }]} />
      <div className="page-head"><div><h1>Import</h1><div className="sub">Bring in Anki decks, spreadsheets, or Quizlet exports.</div></div></div>
      <div style={{ maxWidth: 860 }}>
        <div className="tabs">
          <button className={tab === 'apkg' ? 'on' : ''} onClick={() => setTab('apkg')}>Anki deck (.apkg)</button>
          <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>Text / CSV / Excel</button>
          <button className={tab === 'paste' ? 'on' : ''} onClick={() => setTab('paste')}>Paste (Quizlet format)</button>
        </div>
        {tab === 'apkg' && <ApkgImport />}
        {tab === 'text' && <TextImport />}
        {tab === 'paste' && <PasteImport />}
      </div>
    </>
  );
}

function ApkgImport() {
  const nav = useNavigate();
  const [sched, setSched] = useState(true);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<ApkgResult | null>(null);
  const [error, setError] = useState('');
  const go = async (f: File) => {
    setError(''); setResult(null);
    try {
      setBusy('Starting…');
      setResult(await importApkg(f, { importScheduling: sched, onProgress: setBusy }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="panel pad col" style={{ gap: 14 }}>
      <FileDrop accept=".apkg,.colpkg" onFile={go} label={<><b>Drop an Anki .apkg file</b><div className="small">Shared decks from ankiweb.net, or File → Export in Anki</div></>} />
      <label className="check"><input type="checkbox" checked={sched} onChange={(e) => setSched(e.target.checked)} /> Import scheduling and review history (keep your progress)</label>
      {busy && <div className="row"><span className="spinner" /> {busy}</div>}
      {error && <div className="callout warn">{error}</div>}
      {result && (
        <div className="callout">
          Imported <b>{result.notes}</b> notes / <b>{result.cards}</b> cards into {result.decks} decks
          {result.updated ? `, updated ${result.updated} existing notes` : ''}
          {result.noteTypes ? `, ${result.noteTypes} new note types` : ''}
          {result.media ? `, ${result.media} media files` : ''}
          {result.revlogs ? `, ${result.revlogs} past reviews` : ''}.
          {result.skippedMedia > 0 && <div className="small muted">{result.skippedMedia} large media files (&gt;1.5 MB) were skipped to keep syncing fast.</div>}
          <div className="mt"><button className="btn primary sm" onClick={() => nav('/cards')}>Go to decks</button></div>
        </div>
      )}
      <p className="muted small">Works with .apkg files from any Anki version (including the newer compressed format). Note types, card templates and styling, subdecks, tags, images, audio and FSRS memory states come across.</p>
    </div>
  );
}

function TextImport() {
  const nav = useNavigate();
  const noteTypes = useAll('notetype');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [meta, setMeta] = useState<ReturnType<typeof parseAnkiText> | null>(null);
  const [ntId, setNtId] = useState('nt-basic');
  const [deckId, setDeckId] = useState(all('deck').find((d) => !d.filtered)?.id || '');
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [html, setHtml] = useState(false);
  const [dupes, setDupes] = useState<'skip' | 'update' | 'allow'>('skip');
  const [tags, setTags] = useState<string[]>([]);
  const [skipHeader, setSkipHeader] = useState(false);
  const nt = get('notetype', ntId)!;
  const cols = rows ? Math.max(...rows.slice(0, 50).map((r) => r.length)) : 0;

  const load = async (f: File) => {
    let data: string[][];
    if (/\.xlsx?$/i.test(f.name)) {
      const sheets = await readSpreadsheet(f);
      data = sheets[0].rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
      setMeta(null);
    } else {
      const parsed = parseAnkiText(await f.text());
      data = parsed.rows;
      setMeta(parsed);
      setHtml(parsed.html);
      if (parsed.notetype) {
        const t = all('notetype').find((x) => x.name === parsed.notetype);
        if (t) setNtId(t.id);
      }
      if (parsed.deck) setDeckId(deckByPath(parsed.deck)?.id || ensureDeckPath(parsed.deck));
    }
    setRows(data);
    const first = data[0] || [];
    setSkipHeader(first.some((c) => /^(front|back|term|definition|question|answer)$/i.test(c.trim())));
    setMapping({});
  };

  const defaultMap = (i: number): string => {
    if (meta) {
      if (i === meta.tagsColumn) return '__tags';
      if (i === meta.deckColumn) return '__deck';
      if (i === meta.notetypeColumn || i === meta.guidColumn) return '';
      const skipped = [meta.deckColumn, meta.notetypeColumn, meta.guidColumn, meta.tagsColumn].filter((x) => x !== undefined && x < i).length;
      return nt.fields[i - skipped] || '';
    }
    return nt.fields[i] || '';
  };
  const mapOf = (i: number) => (i in mapping ? mapping[i] : defaultMap(i));
  const body = rows ? rows.slice(skipHeader ? 1 : 0) : [];

  const doImport = () => {
    if (!rows || !deckId) return;
    const firstField = nt.fields[0];
    const existing = new Map(all('note').filter((n) => n.noteTypeId === ntId).map((n) => [stripHtml(n.fields[firstField] || '').trim().toLowerCase(), n]));
    let added = 0, updated = 0, skipped = 0;
    const toUpdate = [];
    for (const r of body) {
      const fields: Record<string, string> = {};
      let rowTags: string[] = [];
      let rowDeck = deckId;
      r.forEach((val, i) => {
        const m = mapOf(i);
        if (!m) return;
        if (m === '__tags') rowTags = val.split(/\s+/).filter(Boolean);
        else if (m === '__deck') rowDeck = val.trim() ? deckByPath(val.trim())?.id || ensureDeckPath(val.trim()) : deckId;
        else fields[m] = html ? val : escapeHtml(val).replace(/\n/g, '<br>');
      });
      const key = stripHtml(fields[firstField] || '').trim().toLowerCase();
      const ex = key ? existing.get(key) : undefined;
      if (ex && dupes !== 'allow') {
        if (dupes === 'update') { toUpdate.push({ ...ex, fields: { ...ex.fields, ...fields }, tags: [...new Set([...ex.tags, ...rowTags, ...tags])] }); updated++; }
        else skipped++;
        continue;
      }
      if (addNote({ noteTypeId: ntId, deckId: rowDeck, fields, tags: [...rowTags, ...tags] })) added++;
      else skipped++;
    }
    if (toUpdate.length) put(toUpdate);
    toast(`Added ${added}, updated ${updated}, skipped ${skipped}`);
    if (added || updated) nav('/cards');
  };

  return (
    <div className="panel pad col" style={{ gap: 14 }}>
      {!rows ? (
        <>
          <FileDrop accept=".txt,.csv,.tsv,.xlsx" onFile={load} label={<><b>Drop a text, CSV or Excel file</b><div className="small">Anki “Notes in Plain Text”, Quizlet export, or any spreadsheet</div></>} />
          <p className="muted small">Each row becomes a note. Columns are mapped to fields – you can change the mapping after choosing a file.</p>
        </>
      ) : (
        <>
          <div className="form-grid">
            <label className="field">Note type
              <select value={ntId} onChange={(e) => { setNtId(e.target.value); setMapping({}); }}>{noteTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="field">Deck<DeckSelect value={deckId} onChange={setDeckId} /></label>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <div className="field-label">Column mapping</div>
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className="row">
                <span className="small muted" style={{ width: 80 }}>Column {i + 1}</span>
                <span className="small ellipsis grow" style={{ maxWidth: 260 }}>{stripHtml(body[0]?.[i] || '')}</span>
                <select value={mapOf(i)} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} style={{ width: 200 }}>
                  <option value="">(ignore)</option>
                  {nt.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  <option value="__tags">Tags</option>
                  <option value="__deck">Deck</option>
                </select>
              </div>
            ))}
          </div>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={skipHeader} onChange={(e) => setSkipHeader(e.target.checked)} /> First row is a header</label>
            <label className="check"><input type="checkbox" checked={html} onChange={(e) => setHtml(e.target.checked)} /> Allow HTML in fields</label>
          </div>
          <div className="row wrap">
            <span className="small muted">If the first field matches an existing note:</span>
            <Seg value={dupes} onChange={setDupes} options={[{ value: 'skip', label: 'Skip' }, { value: 'update', label: 'Update' }, { value: 'allow', label: 'Import anyway' }]} />
          </div>
          <div><div className="field-label">Extra tags</div><TagInput value={tags} onChange={setTags} /></div>
          <div className="row between">
            <button className="btn" onClick={() => setRows(null)}>Choose another file</button>
            <button className="btn primary" disabled={!deckId || !body.length} onClick={doImport}>Import {body.length} notes</button>
          </div>
        </>
      )}
    </div>
  );
}

function PasteImport() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [termSep, setTermSep] = useState('tab');
  const [customTerm, setCustomTerm] = useState('');
  const [rowSep, setRowSep] = useState('newline');
  const [customRow, setCustomRow] = useState('');
  const [ntId, setNtId] = useState('nt-basic');
  const [deckId, setDeckId] = useState(all('deck').find((d) => !d.filtered)?.id || '');
  const items = useMemo(
    () => parseQuizlet(text, termSep === 'custom' ? customTerm || '\t' : termSep, rowSep === 'custom' ? customRow || '\n' : rowSep).filter((i) => i.term),
    [text, termSep, customTerm, rowSep, customRow],
  );
  const doImport = () => {
    let n = 0;
    for (const it of items) {
      const f: Record<string, string> = ntId === 'nt-cloze'
        ? { Text: `{{c1::${escapeHtml(it.term)}}} – ${escapeHtml(it.definition)}`, 'Back Extra': '' }
        : { Front: escapeHtml(it.term).replace(/\n/g, '<br>'), Back: escapeHtml(it.definition).replace(/\n/g, '<br>') };
      if (addNote({ noteTypeId: ntId, deckId, fields: f })) n++;
    }
    toast(`Imported ${n} notes`);
    nav('/cards');
  };
  return (
    <div className="panel pad col" style={{ gap: 14 }}>
      <p className="muted small">On Quizlet: open a set → ⋯ → Export → copy the text, then paste it here.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'mitochondria\tsite of aerobic respiration\nribosome\tsite of protein synthesis'} style={{ minHeight: 180, fontFamily: 'var(--mono)', fontSize: 13 }} />
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
      <div className="form-grid">
        <label className="field">Card type
          <select value={ntId} onChange={(e) => setNtId(e.target.value)}>
            <option value="nt-basic">Basic (term → definition)</option>
            <option value="nt-basic-reversed">Both directions</option>
            <option value="nt-basic-type">Type the answer</option>
            <option value="nt-cloze">Cloze</option>
          </select>
        </label>
        <label className="field">Deck<DeckSelect value={deckId} onChange={setDeckId} /></label>
      </div>
      {items.length > 0 && (
        <div className="preview-box">
          {items.slice(0, 50).map((it, i) => (
            <div key={i} className="list-row small"><b className="grow">{it.term}</b><span className="grow muted">{it.definition}</span></div>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!items.length || !deckId} onClick={doImport}>Import {items.length} cards</button>
      </div>
    </div>
  );
}
