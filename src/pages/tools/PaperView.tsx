import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, MenuButton, Modal, TopBar, toast } from '../../components/ui';
import { addNote, ensureDeckPath } from '../../lib/collection';
import { parseCsv, readSpreadsheet, type Cell } from '../../lib/importers';
import { get, patch, remove, useAll, useRec } from '../../lib/store';
import type { PaperMistake, PastPaper } from '../../lib/types';
import { download, escapeHtml, isoDate, plural, subjectColor, uid } from '../../lib/util';
import { BoundariesEditor, effectiveBounds, fmtDate, paperGrade, pctOf, subjectSuggestions } from './Papers';
import './papers.css';

/* ───────── spreadsheet helpers ───────── */

const COLS = ['q', 'topic', 'lost', 'why', 'fix'] as const;
type Col = (typeof COLS)[number];
const COL_LABEL: Record<Col, string> = { q: 'Question', topic: 'Topic', lost: 'Marks lost', why: 'What went wrong', fix: 'Correct answer / fix' };

/** Which column a header cell names, e.g. "Marks lost" → lost. */
function headerCol(cell: string): Col | null {
  const h = cell.trim().toLowerCase();
  if (!h) return null;
  if (/fix|correct|answer|solution|should|right/.test(h)) return 'fix';
  if (/wrong|why|mistake|error|problem|issue|reason/.test(h)) return 'why';
  if (/lost|mark|dropped|points/.test(h)) return 'lost';
  if (/topic|area|skill|subject area/.test(h)) return 'topic';
  if (/^(q|qu|qn|q\s*no\.?|q#|question|question\s*(no\.?|number)?|no\.?|#|number)$/.test(h)) return 'q';
  return null;
}

const cellText = (c: Cell): string => (c == null ? '' : c instanceof Date ? isoDate(c) : String(c)).trim();
const blankRow = (): PaperMistake => ({ id: uid(), q: '', topic: '', lost: 0, why: '', fix: '' });
const isBlank = (m: PaperMistake) => !m.q && !m.topic && !m.lost && !m.why && !m.fix;

/**
 * Turn pasted/imported rows into column maps. A first row that names columns is used as the header;
 * otherwise cells fill columns left-to-right starting at `startCol`.
 */
function rowsToCells(rows: string[][], startCol = 0): Partial<Record<Col, string>>[] {
  if (!rows.length) return [];
  const head = rows[0].map(headerCol);
  const named = head.filter(Boolean).length;
  const lostIdx = head.indexOf('lost');
  const isHeader = named >= 2 && (lostIdx < 0 || isNaN(parseFloat(rows[0][lostIdx])));
  const map: (Col | null)[] = isHeader ? head : rows[0].map((_, i) => COLS[startCol + i] ?? null);
  const body = isHeader ? rows.slice(1) : rows;
  return body
    .map((r) => {
      const out: Partial<Record<Col, string>> = {};
      r.forEach((v, i) => { const c = map[i]; if (c && v.trim()) out[c] = out[c] ? `${out[c]} ${v.trim()}` : v.trim(); });
      return out;
    })
    .filter((o) => Object.keys(o).length > 0);
}

const toLost = (s: string | undefined) => {
  const n = parseFloat((s || '').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};
const applyCells = (m: PaperMistake, c: Partial<Record<Col, string>>): PaperMistake => {
  const out = { ...m };
  for (const k of COLS) if (c[k] != null) (out as Record<string, unknown>)[k] = k === 'lost' ? toLost(c[k]) : c[k];
  return out;
};

function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/* ───────── flashcards from mistakes ───────── */

const hasCard = (m: PaperMistake) => !!m.noteId && !!get('note', m.noteId);

/** Create a Basic note for one mistake. Returns the note id, or null if there's nothing to put on the back. */
function makeCard(p: PastPaper, m: PaperMistake): string | null {
  if (!m.fix.trim()) return null;
  const deckId = ensureDeckPath(`${p.subject.trim() || 'Past papers'}::Past paper mistakes`);
  const where = [p.subject.trim(), p.title.trim(), m.q.trim() && `Q${m.q.trim().replace(/^q/i, '')}`].filter(Boolean).join(' ');
  const head = `${where}${m.topic.trim() ? ` (${m.topic.trim()})` : ''}`;
  const front = m.why.trim()
    ? `${escapeHtml(head)}: ${escapeHtml(m.why.trim())}<br><br><i>What should the answer be?</i>`
    : `${escapeHtml(head)}: what's the correct answer?`;
  const r = addNote({
    noteTypeId: 'nt-basic',
    deckId,
    fields: { Front: front, Back: escapeHtml(m.fix.trim()).replace(/\n/g, '<br>') },
    tags: ['past-paper', p.subject.trim().replace(/\s+/g, '_')],
  });
  return r?.note.id ?? null;
}

/* ───────── page ───────── */

export function PaperViewPage() {
  const { id = '' } = useParams();
  const p = useRec('paper', id);
  useAll('note');
  const nav = useNavigate();

  if (!p) {
    return (
      <>
        <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { to: '/tools/papers', label: 'Past papers' }, { label: 'Paper' }]} />
        <div className="panel pad" style={{ marginTop: 18 }}>
          <div className="empty">
            <h3>Paper not found</h3>
            <p>It may have been deleted on another device.</p>
            <Link to="/tools/papers" className="btn" style={{ marginTop: 16 }}>Back to past papers</Link>
          </div>
        </div>
      </>
    );
  }

  const set = (changes: Partial<PastPaper>) => patch('paper', p.id, changes);
  const exportCsv = () => {
    const rows = [COLS.map((c) => COL_LABEL[c]), ...p.mistakes.map((m) => [m.q, m.topic, String(m.lost || 0), m.why, m.fix])];
    const name = `${p.subject} ${p.title} ${p.series} mistakes`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'mistakes';
    download(`${name}.csv`, '﻿' + toCsv(rows), 'text/csv;charset=utf-8');
  };
  const del = () => {
    if (!confirm(`Delete "${p.title || 'this paper'}" and its ${plural(p.mistakes.length, 'mistake')}? Flashcards already made are kept.`)) return;
    remove('paper', p.id);
    nav('/tools/papers');
    toast('Paper deleted');
  };

  return (
    <>
      <TopBar
        crumbs={[{ to: '/tools', label: 'Revision tools' }, { to: '/tools/papers', label: 'Past papers' }, { label: p.title || 'Paper' }]}
        right={<MenuButton className="btn ghost icon" items={[
          { label: 'Export mistakes (CSV)', icon: 'download', onClick: exportCsv },
          { label: 'Delete paper', icon: 'trash', danger: true, onClick: del },
        ]} />}
      />
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row small muted" style={{ gap: 6 }}>
            <span className="dot" style={{ background: subjectColor(p.subject) }} />{p.subject || 'No subject'}{p.series && <> · {p.series}</>}
          </div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{p.title || 'Untitled paper'}</h1>
          <div className="sub">Sat {fmtDate(p.date)}</div>
        </div>
      </div>

      <div className="pp-detail">
        <Details p={p} set={set} />
        <Result p={p} set={set} />
      </div>

      <MistakesGrid p={p} set={set} onExport={exportCsv} />

      <section className="panel pad" style={{ marginTop: 18 }}>
        <label className="field">Notes
          <textarea value={p.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="How did it go? Timing, which sections to revise, what to do differently next time…" />
        </label>
      </section>
    </>
  );
}

/* ───────── details & result ───────── */

function Details({ p, set }: { p: PastPaper; set: (c: Partial<PastPaper>) => void }) {
  const subjects = useMemo(subjectSuggestions, []);
  // keep what's typed in the number boxes so "6." or a cleared box doesn't snap back while editing
  const [score, setScore] = useState(p.score == null ? '' : String(p.score));
  const [max, setMax] = useState(p.max ? String(p.max) : '');
  useEffect(() => { if (parseFloat(score) !== p.score && !(score === '' && p.score == null)) setScore(p.score == null ? '' : String(p.score)); }, [p.score]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (parseFloat(max) !== p.max) setMax(p.max ? String(p.max) : ''); }, [p.max]); // eslint-disable-line react-hooks/exhaustive-deps
  const badScore = p.score != null && p.max > 0 && (p.score < 0 || p.score > p.max);
  return (
    <section className="panel pad">
      <h3 className="mb">Details</h3>
      <div className="form-grid pp-form">
        <label className="field">Subject
          <input type="text" list="pp-subjects-view" value={p.subject} onChange={(e) => set({ subject: e.target.value })} />
          <datalist id="pp-subjects-view">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">Paper
          <input type="text" value={p.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Paper 1 Higher" />
        </label>
        <label className="field">Exam series
          <input type="text" value={p.series} onChange={(e) => set({ series: e.target.value })} placeholder="e.g. June 2023" />
        </label>
        <label className="field">Date sat
          <input type="date" value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </label>
        <label className="field">Score
          <input type="text" inputMode="decimal" value={score} placeholder="Not marked" onChange={(e) => {
            setScore(e.target.value);
            const n = parseFloat(e.target.value);
            set({ score: e.target.value.trim() === '' || isNaN(n) ? null : n });
          }} />
        </label>
        <label className="field">Out of
          <input type="text" inputMode="decimal" value={max} onChange={(e) => {
            setMax(e.target.value);
            const n = parseFloat(e.target.value);
            if (n > 0) set({ max: n });
          }} />
        </label>
      </div>
      {badScore && <div className="tiny" style={{ color: 'var(--bad)', marginTop: 8 }}>The score is more than the total marks.</div>}
    </section>
  );
}

function Result({ p, set }: { p: PastPaper; set: (c: Partial<PastPaper>) => void }) {
  const papers = useAll('paper');
  const pct = pctOf(p);
  const g = paperGrade(p, papers);
  const eb = effectiveBounds(p, papers);
  const lost = p.mistakes.reduce((s, m) => s + (m.lost || 0), 0);
  const unlogged = p.score != null ? p.max - p.score - lost : 0;
  return (
    <section className="panel pad">
      <div className="pp-result">
        <div>
          <div className="tiny muted">Score</div>
          <div className="pp-big">{pct == null ? '–' : `${Math.round(pct)}%`}</div>
          <div className="small muted">{p.score == null ? 'Not marked yet' : `${p.score} / ${p.max} marks`}</div>
        </div>
        <div>
          <div className="tiny muted">Grade</div>
          <div className="pp-big">{g ? g.grade : '–'}</div>
          <div className="small muted">
            {g ? (g.next ? `${plural(Math.ceil(g.next.need), 'mark')} off grade ${g.next.grade}` : g.grade === '9' ? 'Top grade!' : '') : p.score == null ? 'Add your score' : 'Add boundaries below'}
          </div>
        </div>
      </div>
      {g?.from && (
        <div className="callout warn tiny mt-6">
          Graded with the boundaries from {g.from.series || fmtDate(g.from.date)} ({g.from.title}){g.from.max !== p.max ? `, scaled from ${g.from.max} to ${p.max} marks` : ''}. Enter this paper's own boundaries to replace them.
        </div>
      )}
      <div className="field-label" style={{ marginTop: 16 }}>
        <span>Grade boundaries</span>
        <span className="faint" style={{ fontWeight: 400 }}>marks needed for each grade</span>
      </div>
      <BoundariesEditor value={p.boundaries} onChange={(b) => set({ boundaries: b })} placeholder={eb?.from ? eb.bounds : undefined} max={p.max || undefined} />
      {p.score != null && p.mistakes.length > 0 && (
        <div className="tiny muted mt-6">
          {plural(lost, 'mark')} logged in the mistakes below{unlogged > 0 ? ` · ${plural(unlogged, 'dropped mark')} not logged yet` : ''}.
        </div>
      )}
    </section>
  );
}

/* ───────── mistakes spreadsheet ───────── */

function MistakesGrid({ p, set, onExport }: { p: PastPaper; set: (c: Partial<PastPaper>) => void; onExport: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<{ r: number; c: number } | null>(null);
  const [pasting, setPasting] = useState(false);
  const rows = p.mistakes;
  const save = (next: PaperMistake[]) => set({ mistakes: next });

  const focusCell = (r: number, c: number) => {
    const el = wrap.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-cell="${r}:${c}"]`);
    if (el) { el.focus(); el.select?.(); return true; }
    return false;
  };
  // focus a cell in a row that's only just been added
  useEffect(() => {
    if (focusNext.current && focusCell(focusNext.current.r, focusNext.current.c)) focusNext.current = null;
  });

  const edit = (r: number, col: Col, v: string) => save(rows.map((m, i) => (i === r ? { ...m, [col]: col === 'lost' ? toLost(v) : v } : m)));
  const addRow = (focusCol = 0) => {
    focusNext.current = { r: rows.length, c: focusCol };
    save([...rows, blankRow()]);
  };
  const delRow = (r: number) => {
    const before = rows;
    save(rows.filter((_, i) => i !== r));
    if (!isBlank(before[r])) toast('Row deleted', { label: 'Undo', fn: () => save(before) });
  };

  /** Spreadsheet keys: Enter/↓ next row, Shift+Enter/↑ previous row, Tab wraps across rows. */
  const onKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (e.shiftKey) { if (r > 0) focusCell(r - 1, c); return; }
      if (r < rows.length - 1) focusCell(r + 1, c);
      else if (!isBlank(rows[r])) addRow(c);
    } else if (e.key === 'ArrowDown' && r < rows.length - 1 && (e.currentTarget.tagName === 'INPUT' || e.altKey)) {
      e.preventDefault(); focusCell(r + 1, c);
    } else if (e.key === 'ArrowUp' && r > 0 && (e.currentTarget.tagName === 'INPUT' || e.altKey)) {
      e.preventDefault(); focusCell(r - 1, c);
    } else if (e.key === 'Tab') {
      if (!e.shiftKey && c === COLS.length - 1 && r < rows.length - 1) { e.preventDefault(); focusCell(r + 1, 0); }
      else if (e.shiftKey && c === 0 && r > 0) { e.preventDefault(); focusCell(r - 1, COLS.length - 1); }
      else if (!e.shiftKey && c < COLS.length - 1) { e.preventDefault(); focusCell(r, c + 1); }
      else if (e.shiftKey && c > 0) { e.preventDefault(); focusCell(r, c - 1); }
    }
  };

  /** Paste a block from Excel/Sheets: fills from this cell down/right, adding rows as needed. */
  const insertCells = (cells: Partial<Record<Col, string>>[], atRow: number) => {
    if (!cells.length) return 0;
    const next = [...rows];
    cells.forEach((c, i) => {
      const r = atRow + i;
      next[r] = applyCells(next[r] || blankRow(), c);
    });
    save(next);
    return cells.length;
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // a single value – let the browser paste it
    e.preventDefault();
    const n = insertCells(rowsToCells(parseCsv(text, '\t'), c), r);
    if (n) toast(`Pasted ${plural(n, 'row')}`);
  };
  // paste with nothing focused (e.g. into an empty spreadsheet) appends the rows
  useEffect(() => {
    const h = (e: globalThis.ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const text = (e.clipboardData?.getData('text/plain') || '').trim();
      if (!/[\t\n]/.test(text)) return;
      e.preventDefault();
      const cells = rowsToCells(parseCsv(text, '\t'));
      if (cells.length) { appendCells(cells); toast(`Pasted ${plural(cells.length, 'row')}`); }
    };
    document.addEventListener('paste', h);
    return () => document.removeEventListener('paste', h);
  });

  /** Add rows after the filled-in ones (dropping empty rows left over). */
  const appendCells = (cells: Partial<Record<Col, string>>[]) =>
    save([...rows.filter((m) => !isBlank(m)), ...cells.map((c) => applyCells(blankRow(), c))]);

  const importFile = async (f: File) => {
    try {
      const sheets = await readSpreadsheet(f);
      const sheet = sheets.find((s) => s.rows.length) || sheets[0];
      const cells = rowsToCells((sheet?.rows || []).map((r) => r.map(cellText)));
      if (!cells.length) { toast('No rows found in that file'); return; }
      appendCells(cells);
      toast(`Imported ${plural(cells.length, 'mistake')}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const makeOne = (r: number) => {
    const m = rows[r];
    if (!m.fix.trim()) { toast('Fill in the correct answer / fix first – it goes on the back of the card'); focusCell(r, 4); return; }
    const noteId = makeCard(p, m);
    if (!noteId) { toast('Could not create the card (Basic note type missing?)'); return; }
    save(rows.map((x, i) => (i === r ? { ...x, noteId } : x)));
    toast(`Card added to ${p.subject.trim() || 'Past papers'}::Past paper mistakes`);
  };
  const todo = rows.filter((m) => !hasCard(m) && m.fix.trim());
  const makeAll = () => {
    let n = 0;
    const next = rows.map((m) => {
      if (hasCard(m) || !m.fix.trim()) return m;
      const noteId = makeCard(p, m);
      if (noteId) n++;
      return noteId ? { ...m, noteId } : m;
    });
    save(next);
    const skipped = rows.filter((m) => !hasCard(m) && !m.fix.trim() && !isBlank(m)).length;
    toast(`Made ${plural(n, 'card')}${skipped ? ` · ${skipped} skipped (no fix yet)` : ''}`);
  };
  const total = rows.reduce((s, m) => s + (m.lost || 0), 0);

  return (
    <section className="panel pp-grid-panel">
      <div className="panel-head pp-grid-head">
        <div>
          <h3>Mistakes</h3>
          <div className="tiny muted">{rows.length ? `${plural(rows.length, 'row')} · ${plural(total, 'mark')} lost` : 'Every mark you dropped, and how to get it next time'}</div>
        </div>
        <div className="row wrap pp-grid-tools">
          <button className="btn sm" onClick={() => addRow()}><Icon name="plus" /> Add row</button>
          <button className="btn sm" onClick={() => setPasting(true)}><Icon name="copy" /> Paste rows</button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Import</button>
          <button className="btn sm hide-sm" onClick={onExport} disabled={!rows.length}><Icon name="download" /> CSV</button>
          {rows.length > 0 && <button className="btn sm accent" onClick={makeAll} disabled={!todo.length} title={todo.length ? '' : 'Rows need a fix (and no card yet) to make cards'}>
            <Icon name="cards" /> Make cards for all{todo.length ? ` (${todo.length})` : ''}
          </button>}
          <input ref={fileRef} type="file" hidden accept=".csv,.tsv,.txt,.xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
        </div>
      </div>
      {!rows.length ? (
        <div className="empty">
          <h3>No mistakes logged</h3>
          <p>
            Go through the mark scheme and add a row for every question you dropped marks on. You can also copy rows from Excel or Google Sheets and paste them here
            (<span className="hide-touch hide-sm">press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd>, or </span>use <b>Paste rows</b>), or import a .csv/.xlsx file
            with columns Question, Topic, Marks lost, What went wrong, Fix.
          </p>
          <button className="btn primary" style={{ marginTop: 16 }} onClick={() => addRow()}><Icon name="plus" /> Add the first mistake</button>
        </div>
      ) : (
        <>
          <div className="pp-scroll" ref={wrap}>
            <table className="pp-grid">
              <thead>
                <tr>
                  {COLS.map((c) => <th key={c} className={`c-${c}`}>{COL_LABEL[c]}</th>)}
                  <th className="c-act" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m, r) => (
                  <tr key={m.id}>
                    {COLS.map((c, ci) => (
                      <td key={c} className={`c-${c}`}>
                        <GridCell
                          id={`${r}:${ci}`}
                          value={c === 'lost' ? (m.lost ? String(m.lost) : '') : m[c]}
                          multiline={c === 'topic' || c === 'why' || c === 'fix'}
                          numeric={c === 'lost'}
                          label={`${COL_LABEL[c]}, row ${r + 1}`}
                          placeholder={r === 0 ? { q: '3b', topic: 'e.g. Specific heat capacity', lost: '0', why: 'e.g. forgot to convert g to kg', fix: 'e.g. E = mcΔT with m in kg' }[c] : ''}
                          onChange={(v) => edit(r, c, v)}
                          onKeyDown={(e) => onKey(e, r, ci)}
                          onPaste={(e) => onPaste(e, r, ci)}
                        />
                      </td>
                    ))}
                    <td className="c-act">
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {hasCard(m) ? (
                          <span className="pill good" title="A flashcard was made from this mistake">✓ card</span>
                        ) : (
                          <button className="btn sm" onClick={() => makeOne(r)} title="Make a flashcard from this mistake"><Icon name="cards" /> Card</button>
                        )}
                        <button className="btn ghost icon sm" onClick={() => delRow(r)} aria-label={`Delete row ${r + 1}`}><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="muted small">Total</td>
                  <td className="c-lost"><b>{total}</b></td>
                  <td colSpan={3}>
                    <button className="btn ghost sm" onClick={() => addRow()}><Icon name="plus" /> Add row</button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="pp-grid-hint tiny faint hide-touch hide-sm">
            <kbd>Tab</kbd> next cell · <kbd>Enter</kbd> next row (adds one at the end) · <kbd>Shift</kbd>+<kbd>Enter</kbd> row above · paste a block copied from Excel/Sheets into any cell
          </div>
          <div className="pp-grid-hint tiny faint pp-touch-hint">Swipe sideways to see every column. Cards go to “{p.subject.trim() || 'Past papers'}::Past paper mistakes”.</div>
        </>
      )}
      {pasting && <PasteModal onClose={() => setPasting(false)} onAdd={(cells) => {
        appendCells(cells);
        toast(`Added ${plural(cells.length, 'row')}`);
        setPasting(false);
      }} />}
    </section>
  );
}

/** One editable cell. Long-text cells grow to fit what's typed instead of scrolling. */
function GridCell({ id, value, multiline, numeric, label, placeholder, onChange, onKeyDown, onPaste }: {
  id: string; value: string; multiline?: boolean; numeric?: boolean; label: string; placeholder?: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // a typed "1." or "" in the marks box shouldn't snap back to the stored number mid-edit
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!numeric || parseFloat(draft || '0') !== parseFloat(value || '0')) setDraft(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const common = { 'data-cell': id, 'aria-label': label, placeholder, onKeyDown, onPaste, enterKeyHint: 'next' as const };
  if (multiline) return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))} {...common} />;
  return (
    <input
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      value={numeric ? draft : value}
      onChange={(e) => { if (numeric) setDraft(e.target.value); onChange(e.target.value); }}
      {...common}
    />
  );
}

function PasteModal({ onClose, onAdd }: { onClose: () => void; onAdd: (cells: Partial<Record<Col, string>>[]) => void }) {
  const [text, setText] = useState('');
  const cells = useMemo(() => {
    if (!text.trim()) return [];
    // spreadsheets copy as tab-separated; fall back to commas for CSV text
    return rowsToCells(parseCsv(text, text.includes('\t') ? '\t' : ','));
  }, [text]);
  return (
    <Modal
      title="Paste rows from a spreadsheet"
      size="wide"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!cells.length} onClick={() => onAdd(cells)}>Add {cells.length ? plural(cells.length, 'row') : 'rows'}</button></>}
    >
      <div className="col">
        <p className="small muted">
          Copy the cells in Excel, Numbers or Google Sheets and paste them below. Columns in order: Question, Topic, Marks lost, What went wrong, Fix –
          or include a header row and they'll be matched by name.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'3b\tSpecific heat capacity\t2\tForgot to convert g to kg\tUse m in kg in E = mcΔT'} style={{ minHeight: 140, fontFamily: 'var(--mono)' }} autoFocus />
        {cells.length > 0 && (
          <div className="pp-scroll preview-box">
            <table className="tbl">
              <thead><tr>{COLS.map((c) => <th key={c}>{COL_LABEL[c]}</th>)}</tr></thead>
              <tbody>
                {cells.slice(0, 50).map((c, i) => <tr key={i}>{COLS.map((k) => <td key={k}>{k === 'lost' ? (c.lost ? toLost(c.lost) : '') : c[k]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
