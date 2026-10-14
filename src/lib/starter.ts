import { buildNote, deleteNotes, ensureDeckPath, updateNote } from './collection';
import { all, get, patch, put, remove } from './store';
import type { StudySet } from './types';
import { DEFAULT_PRESET, getSettings } from './seed';
import type { AnyRec, Note, Preset } from './types';
import { escapeHtml } from './util';

/*
 * Built-in GCSE decks, written in a tiny text format (src/content/*.txt):
 *   @deck Subject         @board Exam board description
 *   # Topic               ## Subtopic
 *   Question :: Answer    (" ;; " = line break, **bold**)
 *   C: Cloze text with {{c1::deletions}}
 *   German <> English   (vocabulary: makes a card in each direction)
 */

const files = import.meta.glob('../content/*.txt', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

/** Cards removed from the starter decks for being more detailed than the exam needs (verbatim content lines). */
const retiredFiles = import.meta.glob('../content/retired/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface StarterNote { deckPath: string; type: 'basic' | 'reversed' | 'cloze'; front: string; back: string; topic: string; sub: string }
export interface StarterDeck {
  key: string;
  name: string;
  board: string;
  notes: StarterNote[];
  topics: string[];
  /** `@renamed old front => new front`: an improved card replaces an installed one (progress kept) */
  renames?: { from: string; to: string }[];
  /** cards retired from this deck (see content/retired/) */
  retired?: StarterNote[];
}

export const STARTER_PRESET_ID = 'preset-gcse-starter';

function fmt(s: string): string {
  return escapeHtml(s.trim())
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\s*;;\s*/g, '<br>');
}

export function parseStarter(key: string, text: string): StarterDeck {
  let name = key;
  let board = '';
  let topic = '';
  let sub = '';
  const notes: StarterNote[] = [];
  const topics: string[] = [];
  const renames: { from: string; to: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@deck ')) { name = line.slice(6).trim(); continue; }
    if (line.startsWith('@board ')) { board = line.slice(7).trim(); continue; }
    if (line.startsWith('@renamed ')) {
      const [from, to] = line.slice(9).split(' => ');
      if (from && to) renames.push({ from: fmt(from), to: fmt(to) });
      continue;
    }
    if (line.startsWith('## ')) { sub = line.slice(3).trim(); continue; }
    if (line.startsWith('# ')) { topic = line.slice(2).trim(); sub = ''; topics.push(topic); continue; }
    const path = [name, topic, sub].filter(Boolean).join('::');
    if (line.startsWith('C: ')) {
      notes.push({ deckPath: path, type: 'cloze', front: fmt(line.slice(3)), back: '', topic, sub });
      continue;
    }
    const i = line.indexOf(' :: ');
    if (i > 0) {
      notes.push({ deckPath: path, type: 'basic', front: fmt(line.slice(0, i)), back: fmt(line.slice(i + 4)), topic, sub });
      continue;
    }
    const j = line.indexOf(' <> ');
    if (j > 0) notes.push({ deckPath: path, type: 'reversed', front: fmt(line.slice(0, j)), back: fmt(line.slice(j + 4)), topic, sub });
  }
  return { key, name, board, notes, topics, renames };
}

export async function loadStarterDecks(): Promise<StarterDeck[]> {
  const out: StarterDeck[] = [];
  for (const [path, load] of Object.entries(files)) {
    const key = path.split('/').pop()!.replace('.txt', '');
    const deck = parseStarter(key, await load());
    const r = Object.entries(retiredFiles).find(([f]) => f.endsWith(`/retired/${key}.txt`))?.[1];
    if (r) deck.retired = parseStarter(key, r).notes;
    out.push(deck);
  }
  const order = ['biology', 'chemistry', 'physics', 'history', 'dt', 'computerscience', 'englishlit', 'german', 'geography'];
  return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function ensureStarterPreset(newPerDay: number) {
  const existing = get('preset', STARTER_PRESET_ID);
  if (existing) {
    if (existing.newPerDay !== newPerDay) patch('preset', STARTER_PRESET_ID, { newPerDay });
    return;
  }
  const p: Preset = {
    ...DEFAULT_PRESET,
    id: STARTER_PRESET_ID,
    name: 'GCSE exam decks',
    newPerDay,
    reviewsPerDay: 9999,
    desiredRetention: 0.9,
    maxInterval: 120,
  };
  put(p);
}

/** Install a starter deck. Notes already installed (matched by guid) are skipped. Returns cards added. */
export function installStarter(deck: StarterDeck): { notes: number; cards: number; skipped: number } {
  const have = new Set(all('note').map((n) => n.guid).filter(Boolean));
  const firstInstall = !deck.notes.some((n) => have.has(noteGuid(deck, n.front)));
  const deckIds = new Map<string, string>();
  const recs: AnyRec[] = [];
  let notes = 0, cards = 0, skipped = 0;
  const oldGuid = renamedFrom(deck);
  for (const n of deck.notes) {
    const guid = noteGuid(deck, n.front);
    // an installed older version of this card is upgraded via "Improved cards" instead
    if (have.has(guid) || (oldGuid.has(guid) && have.has(oldGuid.get(guid)!))) { skipped++; continue; }
    let deckId = deckIds.get(n.deckPath);
    if (!deckId) {
      deckId = ensureDeckPath(n.deckPath, STARTER_PRESET_ID, (path) => `d-starter:${hash(path)}`);
      deckIds.set(n.deckPath, deckId);
    }
    const tags = [slug(deck.name), `${slug(deck.name)}::${slug(n.topic)}`];
    const r =
      n.type === 'cloze'
        ? buildNote({ noteTypeId: 'nt-cloze', deckId, fields: { Text: n.front, 'Back Extra': '' }, tags, guid })
        : buildNote({ noteTypeId: n.type === 'reversed' ? 'nt-basic-reversed' : 'nt-basic', deckId, fields: { Front: n.front, Back: n.back }, tags, guid });
    if (!r) continue;
    // fixed ids: adding the same deck on two devices gives identical records, not duplicates
    const noteId = `n-${guid}`;
    r.note.id = noteId;
    for (const c of r.cards) { c.noteId = noteId; c.id = `${noteId}:${c.ord}`; }
    recs.push(r.note, ...r.cards);
    notes++;
    cards += r.cards.length;
  }
  if (recs.length) put(recs);
  const top = all('deck').find((d) => !d.parentId && d.name === deck.name);
  // first install only: start collapsed so the deck list stays short, and use the exam preset.
  // Later updates must not undo the user's own choices.
  if (top) patch('deck', top.id, firstInstall ? { description: deck.board, presetId: STARTER_PRESET_ID, collapsed: true } : { description: deck.board });
  markSeen('cards', deck);
  return { notes, cards, skipped };
}

/* ───────────── updates: tell the user when new starter content exists ───────────── */

const sig = (parts: string[]) => hash(parts.join('\u0001'));
const cardsSig = (d: StarterDeck) => sig(d.notes.map((n) => n.front));
const setsSig = (d: StarterDeck) => sig(buildSets(d).flatMap((s) => [s.id, ...s.terms.map((t) => t.id)]));
const noteGuid = (d: StarterDeck, front: string) => `starter:${d.key}:${hash(front)}`;
/** new guid → guid of the card it replaces */
const renamedFrom = (d: StarterDeck) => new Map((d.renames || []).map((r) => [noteGuid(d, r.to), noteGuid(d, r.from)]));

/** Remember that the user has seen (added or dismissed) the current content of a starter deck. */
export function markSeen(kind: 'cards' | 'sets', d: StarterDeck) {
  const cur = getSettings();
  const key = `${kind}:${d.key}`;
  const value = kind === 'cards' ? cardsSig(d) : setsSig(d);
  if (cur.starterSig?.[key] === value) return;
  put({ ...cur, starterSig: { ...(cur.starterSig || {}), [key]: value } });
}

/** How many starter notes are missing from a deck the user already added (0 if never added or already seen). */
export function pendingCards(d: StarterDeck): number {
  const prefix = `starter:${d.key}:`;
  const have = new Set(all('note').filter((n) => n.guid?.startsWith(prefix)).map((n) => n.guid));
  if (!have.size) return 0;
  if (getSettings().starterSig?.[`cards:${d.key}`] === cardsSig(d)) return 0;
  const old = renamedFrom(d);
  return d.notes.filter((n) => { const g = noteGuid(d, n.front); return !have.has(g) && !have.has(old.get(g) || ''); }).length;
}

/** The fields a starter note is installed with. */
const starterFields = (n: StarterNote): Record<string, string> => (n.type === 'cloze' ? { Text: n.front } : { Front: n.front, Back: n.back });

/** Installed starter notes whose content has since been improved (same question, better answer). */
export function changedCards(d: StarterDeck): { note: Note; fields: Record<string, string>; guid: string }[] {
  const prefix = `starter:${d.key}:`;
  const byGuid = new Map(all('note').filter((n) => n.guid?.startsWith(prefix)).map((n) => [n.guid!, n]));
  const old = renamedFrom(d);
  const out: { note: Note; fields: Record<string, string>; guid: string }[] = [];
  for (const s of d.notes) {
    const guid = noteGuid(d, s.front);
    const n = byGuid.get(guid) || byGuid.get(old.get(guid) || '');
    if (!n) continue;
    const f = starterFields(s);
    if (n.guid !== guid || Object.entries(f).some(([k, v]) => (n.fields[k] ?? '') !== v)) out.push({ note: n, fields: f, guid });
  }
  return out;
}

const fixSig = (changes: { note: Note; fields: Record<string, string>; guid: string }[]) => sig(changes.map((c) => `${c.note.guid}\u0002${Object.values(c.fields).join('\u0002')}`));

/** How many installed cards have an improved version the user hasn't applied or dismissed. */
export function pendingFixes(d: StarterDeck): number {
  const c = changedCards(d);
  if (!c.length || getSettings().starterSig?.[`fix:${d.key}`] === fixSig(c)) return 0;
  return c.length;
}

/** Bring installed cards up to date. Review history and scheduling are kept. */
export function applyFixes(d: StarterDeck): number {
  const c = changedCards(d);
  for (const { note, fields, guid } of c) updateNote({ ...note, guid, fields: { ...note.fields, ...fields } });
  return c.length;
}

export function dismissFixes(d: StarterDeck) {
  const cur = getSettings();
  put({ ...cur, starterSig: { ...(cur.starterSig || {}), [`fix:${d.key}`]: fixSig(changedCards(d)) } });
}

/* ───────────── retired cards: too detailed for the exam ───────────── */

/** Installed notes (and the cards in them) that the deck no longer includes. */
function retiredNotes(d: StarterDeck): Note[] {
  if (!d.retired?.length) return [];
  const guids = new Set(d.retired.map((n) => noteGuid(d, n.front)));
  // an installed older version of a retired card (see @renamed) is retired too
  for (const [to, from] of renamedFrom(d)) if (guids.has(to)) guids.add(from);
  // a card that was later re-added (same front) isn't retired
  for (const n of d.notes) guids.delete(noteGuid(d, n.front));
  return all('note').filter((n) => n.guid && guids.has(n.guid));
}

export function pendingRetired(d: StarterDeck): { total: number; studied: number } {
  const notes = retiredNotes(d);
  if (!notes.length) return { total: 0, studied: 0 };
  if (getSettings().starterSig?.[`retire:${d.key}`] === sig(notes.map((n) => n.guid!).sort())) return { total: 0, studied: 0 };
  const ids = new Set(notes.map((n) => n.id));
  const studiedNotes = new Set(all('card').filter((c) => ids.has(c.noteId) && c.reps > 0).map((c) => c.noteId));
  return { total: notes.length, studied: studiedNotes.size };
}

export function dismissRetired(d: StarterDeck) {
  const cur = getSettings();
  put({ ...cur, starterSig: { ...(cur.starterSig || {}), [`retire:${d.key}`]: sig(retiredNotes(d).map((n) => n.guid!).sort()) } });
}

/** Delete the retired cards (and their terms in Quick Learn sets), then tidy topic folders left empty. */
export function applyRetired(d: StarterDeck): number {
  const notes = retiredNotes(d);
  if (!notes.length) return 0;
  deleteNotes(notes.map((n) => n.id));
  const termIds = new Set((d.retired || []).map((n) => `t-${hash(n.front)}`));
  for (const s of all('set')) {
    if (!s.id.startsWith(`starter-set:${d.key}:`)) continue;
    const terms = s.terms.filter((t) => !termIds.has(t.id));
    if (terms.length === s.terms.length) continue;
    if (terms.length) put({ ...s, terms });
    else remove('set', s.id);
  }
  const root = all('deck').find((x) => !x.parentId && x.name === d.name);
  if (root) {
    const decks = all('deck');
    const cards = all('card');
    const children = (id: string) => decks.filter((x) => x.parentId === id);
    const hasCards = (id: string): boolean => cards.some((c) => c.deckId === id || c.odid === id) || children(id).some((c) => hasCards(c.id));
    const empty: string[] = [];
    const sub = (id: string): string[] => [id, ...children(id).flatMap((c) => sub(c.id))];
    const walk = (id: string) => children(id).forEach((c) => { if (!hasCards(c.id)) empty.push(...sub(c.id)); else walk(c.id); });
    walk(root.id);
    if (empty.length) remove('deck', empty);
  }
  return notes.length;
}

/** How many topic-set terms are missing for a subject whose sets the user already added. */
export function pendingSets(d: StarterDeck): number {
  if (!installedSetCount(d)) return 0;
  if (getSettings().starterSig?.[`sets:${d.key}`] === setsSig(d)) return 0;
  let missing = 0;
  for (const s of buildSets(d)) {
    const cur = get('set', s.id);
    if (!cur) missing += s.terms.length;
    else {
      const have = new Map(cur.terms.map((t) => [t.id, t.definition]));
      missing += s.terms.filter((t) => have.get(t.id) !== t.definition).length;
    }
  }
  return missing;
}


/* ───────────── Quick Learn sets (one per topic) ───────────── */

const MIN_SET = 6;

/** Starter-deck HTML (escaped text, <b>, <br>) → plain text for Quick Learn terms. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** "The {{c1::mitochondria}} makes ATP" → term "The […] makes ATP", definition "mitochondria". */
export function clozeToTerm(html: string): { term: string; definition: string } {
  const answers: string[] = [];
  const text = html.replace(CLOZE_RE, (_m, _n: string, ans: string, hint?: string) => {
    answers.push(htmlToText(ans));
    return hint ? `[${htmlToText(hint)}]` : '[…]';
  });
  return {
    term: htmlToText(text),
    definition: answers.length === 1 ? answers[0] : answers.map((a, i) => `${i + 1}. ${a}`).join('\n'),
  };
}

export interface StarterSetData {
  id: string;
  subject: string;
  board: string;
  title: string;
  terms: { id: string; term: string; definition: string }[];
}

/** One set per topic (or topic + subtopic); tiny neighbouring topics are joined so no set is trivially small. */
export function buildSets(deck: StarterDeck): StarterSetData[] {
  const groups: { title: string; topics: string[]; notes: StarterNote[] }[] = [];
  const index = new Map<string, number>();
  for (const n of deck.notes) {
    const key = `${n.topic}\u0000${n.sub}`;
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ title: n.sub ? `${n.topic} – ${n.sub}` : n.topic, topics: [key], notes: [] });
    }
    groups[i].notes.push(n);
  }
  // join runs of tiny groups with the following group (or the previous one at the end)
  const merged: typeof groups = [];
  let carry: (typeof groups)[number] | null = null;
  for (const g of groups) {
    if (carry) {
      g.title = `${carry.title} + ${g.title}`;
      g.topics = [...carry.topics, ...g.topics];
      g.notes = [...carry.notes, ...g.notes];
      carry = null;
    }
    if (g.notes.length < MIN_SET) carry = g;
    else merged.push(g);
  }
  if (carry) {
    if (merged.length) {
      const last = merged[merged.length - 1];
      last.title = `${last.title} + ${carry.title}`;
      last.topics = [...last.topics, ...carry.topics];
      last.notes = [...last.notes, ...carry.notes];
    } else merged.push(carry);
  }
  return merged.map((g) => ({
    id: `starter-set:${deck.key}:${hash(g.topics[0])}`,
    subject: deck.name,
    board: deck.board,
    title: g.title,
    terms: g.notes
      .map((n) => {
        const t = n.type === 'cloze' ? clozeToTerm(n.front) : { term: htmlToText(n.front), definition: htmlToText(n.back) };
        return { id: `t-${hash(n.front)}`, ...t };
      })
      .filter((t) => t.term && t.definition),
  }));
}

/** Install a subject's topic sets. Existing sets keep their progress and edits; only missing terms are added. */
export function installSets(deck: StarterDeck): { sets: number; terms: number; updated: number } {
  const out: StudySet[] = [];
  let sets = 0, terms = 0, updated = 0;
  // a renamed card's term replaces its old version in place
  const renamedTerm = new Map((deck.renames || []).map((r) => [`t-${hash(r.from)}`, `t-${hash(r.to)}`]));
  for (const d of buildSets(deck)) {
    const found = get('set', d.id);
    const cur = found && { ...found, terms: found.terms.map((t) => (renamedTerm.has(t.id) && d.terms.some((x) => x.id === renamedTerm.get(t.id)) ? { ...t, id: renamedTerm.get(t.id)! } : t)) };
    if (cur) {
      const have = new Set(cur.terms.map((t) => t.id));
      const extra = d.terms.filter((t) => !have.has(t.id));
      // improved answers replace the old ones (stars are kept)
      const fresh = new Map(d.terms.map((t) => [t.id, t]));
      const changed = cur.terms.filter((t) => fresh.has(t.id) && fresh.get(t.id)!.definition !== t.definition);
      const renamed = cur.terms.filter((t, i) => t.id !== found!.terms[i].id).length;
      if (extra.length || changed.length || renamed) {
        const merged = cur.terms.map((t) => (fresh.has(t.id) ? { ...t, term: fresh.get(t.id)!.term, definition: fresh.get(t.id)!.definition } : t));
        out.push({ ...cur, terms: [...merged, ...extra] });
        terms += extra.length + Math.max(changed.length, renamed);
        updated++;
      }
      continue;
    }
    out.push({ id: d.id, kind: 'set', updatedAt: 0, title: d.title, description: d.board, folder: d.subject, terms: d.terms, createdAt: Date.now() });
    sets++;
    terms += d.terms.length;
  }
  if (out.length) put(out);
  markSeen('sets', deck);
  return { sets, terms, updated };
}

export function installedSetCount(deck: StarterDeck): number {
  const prefix = `starter-set:${deck.key}:`;
  return all('set').filter((s) => s.id.startsWith(prefix)).length;
}
