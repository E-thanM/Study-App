import { buildNote, ensureDeckPath } from './collection';
import { all, get, patch, put } from './store';
import { DEFAULT_PRESET } from './seed';
import type { AnyRec, Preset } from './types';
import { escapeHtml } from './util';

/*
 * Built-in GCSE decks, written in a tiny text format (src/content/*.txt):
 *   @deck Subject         @board Exam board description
 *   # Topic               ## Subtopic
 *   Question :: Answer    (" ;; " = line break, **bold**)
 *   C: Cloze text with {{c1::deletions}}
 */

const files = import.meta.glob('../content/*.txt', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export interface StarterNote { deckPath: string; type: 'basic' | 'cloze'; front: string; back: string; topic: string }
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
      notes.push({ deckPath: path, type: 'cloze', front: fmt(line.slice(3)), back: '', topic });
      continue;
    }
    const i = line.indexOf(' :: ');
    if (i > 0) notes.push({ deckPath: path, type: 'basic', front: fmt(line.slice(0, i)), back: fmt(line.slice(i + 4)), topic });
  }
  return { key, name, board, notes, topics };
}

export async function loadStarterDecks(): Promise<StarterDeck[]> {
  const out: StarterDeck[] = [];
  for (const [path, load] of Object.entries(files)) {
    const key = path.split('/').pop()!.replace('.txt', '');
    out.push(parseStarter(key, await load()));
  }
  const order = ['biology', 'chemistry', 'physics', 'history', 'dt', 'computerscience', 'englishlit'];
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
  const deckIds = new Map<string, string>();
  const recs: AnyRec[] = [];
  let notes = 0, cards = 0, skipped = 0;
  for (const n of deck.notes) {
    const guid = `starter:${deck.key}:${hash(n.front)}`;
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
        : buildNote({ noteTypeId: 'nt-basic', deckId, fields: { Front: n.front, Back: n.back }, tags, guid });
    if (!r) continue;
    recs.push(r.note, ...r.cards);
    notes++;
    cards += r.cards.length;
  }
  if (recs.length) put(recs);
  const top = all('deck').find((d) => !d.parentId && d.name === deck.name);
  if (top) patch('deck', top.id, { description: deck.board, presetId: STARTER_PRESET_ID });
  return { notes, cards, skipped };
}
