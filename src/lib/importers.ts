import type { Session } from './types';
import { isoDate, minToTime, pad, timeToMin, weekdayMon } from './util';

/* ───────────── generic delimited text ───────────── */

/** RFC-4180-ish CSV/TSV parser with quote support. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else q = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === delimiter) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function guessDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(0, 20);
  const cands = ['\t', ';', ',', '|'];
  let best = '\t', bestScore = -1;
  for (const d of cands) {
    const counts = sample.map((l) => l.split(d).length - 1);
    if (!counts.length || !counts[0]) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = consistent * 10 + (counts[0] > 0 ? 1 : 0) + (d === '\t' ? 0.5 : 0);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Quizlet-style "term<sep>definition<rowsep>" parsing (as on Quizlet's import screen). */
export function parseQuizlet(text: string, termSep: string, rowSep: string): { term: string; definition: string }[] {
  const ts = termSep === 'tab' ? '\t' : termSep === 'comma' ? ',' : termSep === 'dash' ? ' - ' : termSep;
  const rs = rowSep === 'newline' ? /\r?\n/ : rowSep === 'semicolon' ? ';' : rowSep;
  const rows = typeof rs === 'string' ? text.split(rs) : text.split(rs);
  const out: { term: string; definition: string }[] = [];
  for (const r of rows) {
    if (!r.trim()) continue;
    const i = r.indexOf(ts);
    if (i < 0) out.push({ term: r.trim(), definition: '' });
    else out.push({ term: r.slice(0, i).trim(), definition: r.slice(i + ts.length).trim() });
  }
  // drop a header row such as "term,definition" from spreadsheets
  const h = out[0];
  if (h && /^(terms?|words?|front|questions?)$/i.test(h.term) && /^(definitions?|meanings?|back|answers?)$/i.test(h.definition)) out.shift();
  return out;
}

/* ───────────── Anki text export (Notes in Plain Text) ───────────── */

export interface AnkiTextFile {
  rows: string[][];
  html: boolean;
  separator: string;
  deckColumn?: number;
  notetypeColumn?: number;
  tagsColumn?: number;
  guidColumn?: number;
  deck?: string;
  notetype?: string;
  tags?: string;
  columns?: string[];
}

export function parseAnkiText(text: string): AnkiTextFile {
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) {
    const m = /^#([\w ]+):(.*)$/.exec(lines[i]);
    if (m) header[m[1].trim().toLowerCase()] = m[2].trim();
    i++;
  }
  const sepMap: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };
  const body = lines.slice(i).join('\n');
  const separator = header.separator ? sepMap[header.separator.toLowerCase()] ?? header.separator : guessDelimiter(body);
  const col = (k: string) => (header[k] ? Number(header[k]) - 1 : undefined);
  return {
    rows: parseCsv(body, separator),
    html: header.html ? header.html === 'true' : /<[a-z][^>]*>/i.test(body),
    separator,
    deckColumn: col('deck column'),
    notetypeColumn: col('notetype column'),
    tagsColumn: col('tags column'),
    guidColumn: col('guid column'),
    deck: header.deck,
    notetype: header.notetype,
    tags: header.tags,
    columns: header.columns?.split(separator),
  };
}

/* ───────────── spreadsheets ───────────── */

export type Cell = string | number | boolean | Date | null | undefined;

export async function readSpreadsheet(file: File): Promise<{ name: string; rows: Cell[][] }[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] }));
  }
  if (lower.endsWith('.xls') || lower.endsWith('.numbers') || lower.endsWith('.ods')) {
    throw new Error('Please save the spreadsheet as .xlsx or .csv first (File → Save As / Download as).');
  }
  const text = await file.text();
  return [{ name: file.name, rows: parseCsv(text, guessDelimiter(text)) }];
}

const DAY_NAMES = [
  ['mon', 'monday'], ['tue', 'tues', 'tuesday'], ['wed', 'weds', 'wednesday'], ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'], ['sat', 'saturday'], ['sun', 'sunday'],
];

function weekdayOf(s: string): number | null {
  const w = s.trim().toLowerCase().replace(/[^a-z]/g, ' ').split(/\s+/)[0] || '';
  const idx = DAY_NAMES.findIndex((names) => names.includes(w));
  return idx >= 0 ? idx : null;
}

function isExcelTimeDate(d: Date) {
  return d.getUTCFullYear() < 1901;
}

/** Convert a cell into a date string (YYYY-MM-DD) if it looks like a date. */
function cellDate(c: Cell): string | null {
  if (c instanceof Date) {
    if (isExcelTimeDate(c)) return null;
    return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  }
  if (typeof c === 'number' && c > 30000 && c < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s); // UK dd/mm/yyyy
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i.exec(s);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    const y = m[3] ? Number(m[3]) : guessYear(mon);
    return `${y}-${pad(mon + 1)}-${pad(+m[1])}`;
  }
  return null;
}

function guessYear(month: number): number {
  const now = new Date();
  // dates in an academic-year plan: months well before now belong to next year
  return month < now.getMonth() - 3 ? now.getFullYear() + 1 : now.getFullYear();
}

/** Convert a cell into a time or time range. */
function cellTimes(c: Cell): { start: string; end?: string } | null {
  if (c instanceof Date) {
    if (!isExcelTimeDate(c) && (c.getUTCHours() || c.getUTCMinutes()) === 0) return null;
    return { start: `${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}` };
  }
  if (typeof c === 'number' && c >= 0 && c < 1) return { start: minToTime(c * 1440) };
  if (typeof c !== 'string') return null;
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/gi;
  const s = c.trim();
  if (!/\d/.test(s) || s.length > 25) return null;
  if (!/[:.]\d{2}|am|pm|^\d{1,2}\s*[-–to]+\s*\d{1,2}$/i.test(s)) return null;
  const parts: string[] = [];
  for (const m of s.matchAll(re)) {
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    parts.push(`${pad(h)}:${pad(min)}`);
  }
  if (!parts.length) return null;
  return { start: parts[0], end: parts[1] };
}

const str = (c: Cell): string => {
  if (c == null) return '';
  if (c instanceof Date) return isoDate(c);
  return String(c).trim();
};

function splitSubjectTopic(text: string): { subject: string; topic: string } {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s*(?:[-–—:|]|\n)\s*(.+)$/.exec(text.trim()) || /^(.+?)\s*\((.+)\)$/.exec(t);
  if (m && m[1].length <= 40) return { subject: m[1].trim(), topic: m[2].replace(/\s+/g, ' ').trim() };
  return { subject: t, topic: '' };
}

export type ParsedSession = Omit<Session, 'id' | 'kind' | 'updatedAt' | 'timetableId'>;

/**
 * Turn a spreadsheet into timetable sessions. Handles
 *  - list layout: one row per session with Date/Day, Start/End/Time, Subject, Topic, Notes columns
 *  - grid layout: times down the side and days (or dates) across the top (or transposed)
 */
export function parseTimetable(rows: Cell[][]): { sessions: ParsedSession[]; layout: string } {
  rows = rows.filter((r) => r && r.some((c) => str(c) !== ''));
  if (!rows.length) return { sessions: [], layout: 'empty' };
  const headerIdx = rows.findIndex((r) => r.filter((c) => str(c) !== '').length >= 2);
  const header = (rows[headerIdx] || []).map((c) => str(c).toLowerCase());

  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cSubject = find(/subject|course|class|module/);
  const cTopic = find(/topic|activity|task|what|focus|detail|content|revis/);
  const cDate = find(/date/);
  const cDay = find(/^(day|weekday)/);
  const cStart = find(/start|from|begin/);
  const cEnd = find(/end|finish|until|^to$/);
  const cTime = find(/time|slot|period/);
  const cNotes = find(/note|comment/);
  const cDone = find(/done|complete|status|tick|✓/);
  const cDur = find(/duration|length|mins|minutes|hours/);

  if ((cSubject >= 0 || cTopic >= 0) && (cDate >= 0 || cDay >= 0 || cStart >= 0 || cTime >= 0)) {
    const sessions: ParsedSession[] = [];
    for (const r of rows.slice(headerIdx + 1)) {
      const date = cDate >= 0 ? cellDate(r[cDate]) : null;
      const weekday = !date && cDay >= 0 ? weekdayOf(str(r[cDay])) : null;
      let start = '', end = '';
      const t1 = cStart >= 0 ? cellTimes(r[cStart]) : cTime >= 0 ? cellTimes(r[cTime]) : null;
      if (t1) { start = t1.start; end = t1.end || ''; }
      if (cEnd >= 0) end = cellTimes(r[cEnd])?.start || end;
      if (!end && start) {
        const durRaw = cDur >= 0 ? str(r[cDur]) : '';
        const dur = durRaw ? (/h/i.test(durRaw) || Number(durRaw) < 10 ? Number.parseFloat(durRaw) * 60 : Number.parseFloat(durRaw)) : 60;
        end = minToTime(timeToMin(start) + (Number.isFinite(dur) ? dur : 60));
      }
      let subject = cSubject >= 0 ? str(r[cSubject]) : '';
      let topic = cTopic >= 0 && cTopic !== cSubject ? str(r[cTopic]) : '';
      if (!subject && topic) ({ subject, topic } = splitSubjectTopic(topic));
      if (!subject && !topic) continue;
      if (date === null && weekday === null && cDate < 0 && cDay < 0) continue;
      const doneRaw = cDone >= 0 ? str(r[cDone]).toLowerCase() : '';
      const done = ['true', 'yes', 'y', 'done', 'x', '✓', '✔', 'complete', 'completed', '1'].includes(doneRaw);
      const occ = date || '';
      sessions.push({
        date,
        weekday: date ? null : weekday ?? 0,
        start: start || '09:00',
        end: end || minToTime(timeToMin(start || '09:00') + 60),
        subject,
        topic,
        notes: cNotes >= 0 ? str(r[cNotes]) : '',
        log: done && occ ? { [occ]: { done: true } } : {},
      });
    }
    return { sessions, layout: 'list' };
  }

  // grid layout
  const sessions: ParsedSession[] = [];
  const headerDays = header.map((_, i) => {
    const raw = rows[headerIdx][i];
    return { date: cellDate(raw), weekday: weekdayOf(str(raw)) };
  });
  const daysAcross = headerDays.filter((d) => d.date || d.weekday !== null).length >= 2;

  if (daysAcross) {
    const body = rows.slice(headerIdx + 1);
    const timeCol = 0;
    const slots = body.map((r) => cellTimes(r[timeCol]));
    body.forEach((r, ri) => {
      const t = slots[ri];
      if (!t) return;
      const nextStart = slots.slice(ri + 1).find(Boolean)?.start;
      const end = t.end || nextStart || minToTime(timeToMin(t.start) + 60);
      r.forEach((c, ci) => {
        if (ci === timeCol) return;
        const d = headerDays[ci];
        const text = str(c);
        if (!text || (!d?.date && d?.weekday == null)) return;
        if (/^(break|lunch|free|-|–)$/i.test(text)) return;
        const { subject, topic } = splitSubjectTopic(text);
        sessions.push({ date: d.date, weekday: d.date ? null : d.weekday, start: t.start, end, subject, topic, notes: '', log: {} });
      });
    });
    return { sessions, layout: 'grid (days across)' };
  }

  // transposed: days down the first column, times across the header
  const headerTimes = rows[headerIdx].map((c) => cellTimes(c));
  if (headerTimes.filter(Boolean).length >= 2) {
    for (const r of rows.slice(headerIdx + 1)) {
      const date = cellDate(r[0]);
      const weekday = date ? null : weekdayOf(str(r[0]));
      if (!date && weekday === null) continue;
      r.forEach((c, ci) => {
        const t = headerTimes[ci];
        const text = str(c);
        if (ci === 0 || !t || !text || /^(break|lunch|free|-|–)$/i.test(text)) return;
        const nextStart = headerTimes.slice(ci + 1).find(Boolean)?.start;
        const end = t.end || nextStart || minToTime(timeToMin(t.start) + 60);
        const { subject, topic } = splitSubjectTopic(text);
        sessions.push({ date, weekday, start: t.start, end, subject, topic, notes: '', log: {} });
      });
    }
    return { sessions, layout: 'grid (days down)' };
  }

  // last resort: dates/days down column 0, sessions in other columns, no times
  for (const r of rows.slice(headerIdx)) {
    const date = cellDate(r[0]);
    const weekday = date ? null : weekdayOf(str(r[0]));
    if (!date && weekday === null) continue;
    let start = 16 * 60;
    r.slice(1).forEach((c) => {
      const text = str(c);
      if (!text) return;
      const { subject, topic } = splitSubjectTopic(text);
      sessions.push({ date, weekday, start: minToTime(start), end: minToTime(start + 60), subject, topic, notes: '', log: {} });
      start += 60;
    });
  }
  return { sessions, layout: 'days list' };
}

export function weekdayOfIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return weekdayMon(new Date(y, m - 1, d));
}
