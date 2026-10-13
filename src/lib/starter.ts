import { buildNote, ensureDeckPath } from './collection';
import { all, get, patch, put } from './store';
import type { StudySet } from './types';
import { DEFAULT_PRESET, getSettings } from './seed';
import type { AnyRec, Preset } from './types';
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

export interface StarterNote { deckPath: string; type: 'basic' | 'reversed' | 'cloze'; front: string; back: string; topic: string; sub: string }
export interface StarterDeck { key: string; name: string; board: string; notes: StarterNote[]; topics: string[] }

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
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@deck ')) { name = line.slice(6).trim(); continue; }
    if (line.startsWith('@board ')) { board = line.slice(7).trim(); continue; }
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
  return { key, name, board, notes, topics };
}

export async function loadStarterDecks(): Promise<StarterDeck[]> {
  const out: StarterDeck[] = [];
  for (const [path, load] of Object.entries(files)) {
    const key = path.split('/').pop()!.replace('.txt', '');
    out.push(parseStarter(key, await load()));
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
  for (const n of deck.notes) {
    const guid = noteGuid(deck, n.front);
    if (have.has(guid)) { skipped++; continue; }
    let deckId = deckIds.get(n.deckPath);
    if (!deckId) {
      deckId = ensureDeckPath(n.deckPath, STARTER_PRESET_ID);
      deckIds.set(n.deckPath, deckId);
    }
    const tags = [slug(deck.name), `${slug(deck.name)}::${slug(n.topic)}`];
    const r =
      n.type === 'cloze'
        ? buildNote({ noteTypeId: 'nt-cloze', deckId, fields: { Text: n.front, 'Back Extra': '' }, tags, guid })
        : buildNote({ noteTypeId: n.type === 'reversed' ? 'nt-basic-reversed' : 'nt-basic', deckId, fields: { Front: n.front, Back: n.back }, tags, guid });
    if (!r) continue;
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
  return d.notes.filter((n) => !have.has(noteGuid(d, n.front))).length;
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
      const have = new Set(cur.terms.map((t) => t.id));
      missing += s.terms.filter((t) => !have.has(t.id)).length;
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
  for (const d of buildSets(deck)) {
    const cur = get('set', d.id);
    if (cur) {
      const have = new Set(cur.terms.map((t) => t.id));
      const extra = d.terms.filter((t) => !have.has(t.id));
      if (extra.length) {
        out.push({ ...cur, terms: [...cur.terms, ...extra] });
        terms += extra.length;
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
