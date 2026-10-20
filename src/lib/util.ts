export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

let dayStartHour = 4;
export const setDayStartHour = (h: number) => {
  dayStartHour = h;
};
export const getDayStartHour = () => dayStartHour;

/** Anki-style day number: days since epoch, rolling over at `dayStartHour` local time. */
export function dayNumber(ts: number = Date.now()): number {
  const d = new Date(ts - dayStartHour * HOUR);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Timestamp at which the given study day ends (next rollover). */
export function dayEnd(day: number = dayNumber()): number {
  const d = new Date(day * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, dayStartHour).getTime();
}

export function dayStart(day: number = dayNumber()): number {
  return dayEnd(day) - DAY;
}

export const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based weekday: 0 = Monday … 6 = Sunday */
export const weekdayMon = (d: Date) => (d.getDay() + 6) % 7;

export function startOfWeek(d: Date = new Date(), mondayFirst = true): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = mondayFirst ? weekdayMon(x) : x.getDay();
  return addDays(x, -wd);
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function timeToMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function minToTime(m: number): string {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Human interval: 45s, 10m, 3h, 4d, 2.1mo, 1.3y */
export function fmtInterval(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.4;
  if (mo < 12) return `${mo.toFixed(mo < 10 ? 1 : 0)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/**
 * Study time in hours and minutes: "1 hour 10 minutes", "45 minutes", "2 hours".
 * `short` gives "1h 10m" for narrow table columns.
 */
export function fmtHours(ms: number, short = false): string {
  const total = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (short) return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  const hs = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const ms_ = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  return h ? (m ? `${hs} ${ms_}` : hs) : ms_;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function stripHtml(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n');
  return (div.textContent || '').replace(/ /g, ' ').trim();
}

/** Stable colour per subject name, drawn from a soft palette that works in light and dark. */
const PALETTE = ['#5b7cfa', '#f08c4a', '#3fb984', '#e0607e', '#9b6bf2', '#27a8c4', '#d4a72c', '#6f8f5a', '#c25bd0', '#4a90b8'];
export function subjectColor(name: string): string {
  const s = (name || '').trim().toLowerCase();
  if (!s) return '#9a9a9a';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function normaliseAnswer(s: string): string {
  return stripHtml(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quizlet-ish leniency: exact after normalising, or a small typo on longer answers. */
export function answersMatch(given: string, expected: string): boolean {
  const g = normaliseAnswer(given);
  const e = normaliseAnswer(expected);
  if (!g) return false;
  if (g === e) return true;
  // accept any of several comma/semicolon/slash separated alternatives
  const alts = stripHtml(expected).split(/[;/]|,\s*(?:or\s+)?/).map(normaliseAnswer).filter(Boolean);
  if (alts.length > 1 && alts.includes(g)) return true;
  const allowed = e.length >= 8 ? 1 : 0;
  return levenshtein(g, e) <= allowed;
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export function plural(n: number, word: string, pluralWord = word + 's') {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
