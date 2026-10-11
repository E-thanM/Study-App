import { all, put } from './store';
import { ensureDeckPath } from './collection';
import { CardState, type Card, type Media, type Note, type NoteType, type RevLog } from './types';
import { DAY, dayNumber, dayStart, uid } from './util';

/*
 * Import Anki .apkg / .colpkg files (legacy .anki2/.anki21 and the newer zstd .anki21b format),
 * including note types, templates, decks/subdecks, scheduling, review history and media.
 */

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((x, i) => b[i] === x);

/* minimal protobuf reader for the anki21b config blobs */
type PbField = { no: number; wire: number; value: number | Uint8Array };
function pbFields(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  const varint = () => {
    let r = 0, shift = 0, b: number;
    do {
      b = buf[i++];
      r += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80 && i < buf.length);
    return r;
  };
  while (i < buf.length) {
    const tag = varint();
    const no = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) out.push({ no, wire, value: varint() });
    else if (wire === 2) {
      const len = varint();
      out.push({ no, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else break;
  }
  return out;
}
const dec = new TextDecoder();
const pbStr = (fs: PbField[], no: number) => {
  const f = fs.find((x) => x.no === no && x.wire === 2);
  return f ? dec.decode(f.value as Uint8Array) : '';
};
const pbNum = (fs: PbField[], no: number) => {
  const f = fs.find((x) => x.no === no && x.wire === 0);
  return f ? (f.value as number) : 0;
};

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', opus: 'audio/ogg', webm: 'audio/webm',
};

function toDataUrl(bytes: Uint8Array, name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export interface ApkgResult {
  notes: number;
  cards: number;
  updated: number;
  decks: number;
  noteTypes: number;
  media: number;
  skippedMedia: number;
  revlogs: number;
}

type Row = Record<string, unknown>;

export async function importApkg(file: File, opts: { importScheduling: boolean; onProgress?: (msg: string) => void }): Promise<ApkgResult> {
  const progress = opts.onProgress || (() => {});
  progress('Unzipping…');
  const [{ default: JSZip }, { decompress }, initSqlJs, wasm] = await Promise.all([
    import('jszip'),
    import('fzstd'),
    import('sql.js').then((m) => m.default),
    import('sql.js/dist/sql-wasm.wasm?url').then((m) => m.default as string),
  ]);
  const zip = await JSZip.loadAsync(file);
  const pick = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.file(n));
  if (!pick) throw new Error('This file does not look like an Anki package (.apkg).');
  let colBytes = await zip.file(pick)!.async('uint8array');
  if (isZstd(colBytes)) colBytes = decompress(colBytes);

  progress('Reading collection…');
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const db = new SQL.Database(colBytes);
  const rows = (sql: string): Row[] => {
    try {
      const res = db.exec(sql);
      if (!res.length) return [];
      const { columns, values } = res[0];
      return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
    } catch {
      return [];
    }
  };

  const col = rows('select * from col')[0] || {};
  const crt = Number(col.crt || 0) * 1000;
  const crtDay = crt ? dayNumber(crt) : dayNumber();

  /* note types */
  interface SrcNt { id: string; name: string; type: 'standard' | 'cloze'; fields: string[]; templates: { name: string; front: string; back: string }[]; css: string }
  const srcNts = new Map<string, SrcNt>();
  const ntRows = rows('select id, name, config from notetypes');
  if (ntRows.length) {
    for (const r of ntRows) {
      const cfg = pbFields(r.config as Uint8Array);
      const id = String(r.id);
      const fields = rows(`select name from fields where ntid = ${id} order by ord`).map((f) => String(f.name));
      const templates = rows(`select name, config from templates where ntid = ${id} order by ord`).map((t) => {
        const tc = pbFields(t.config as Uint8Array);
        return { name: String(t.name), front: pbStr(tc, 1), back: pbStr(tc, 2) };
      });
      srcNts.set(id, { id, name: String(r.name), type: pbNum(cfg, 1) === 1 ? 'cloze' : 'standard', fields, templates, css: pbStr(cfg, 3) });
    }
  } else if (col.models) {
    const models = JSON.parse(String(col.models)) as Record<string, { name: string; type: number; css: string; flds: { name: string; ord: number }[]; tmpls: { name: string; qfmt: string; afmt: string; ord: number }[] }>;
    for (const [id, m] of Object.entries(models)) {
      srcNts.set(id, {
        id,
        name: m.name,
        type: m.type === 1 ? 'cloze' : 'standard',
        fields: m.flds.sort((a, b) => a.ord - b.ord).map((f) => f.name),
        templates: m.tmpls.sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt })),
        css: m.css,
      });
    }
  }

  // reuse an existing note type when name + fields + templates match, otherwise create it
  const ntMap = new Map<string, NoteType>();
  const newNts: NoteType[] = [];
  const existingNts = all('notetype');
  for (const s of srcNts.values()) {
    const same = existingNts.find(
      (n) =>
        n.name.replace(/[-+]\w+$/, '') === s.name.replace(/[-+]\w+$/, '') &&
        n.fields.join('\u001f') === s.fields.join('\u001f') &&
        n.templates.length === s.templates.length &&
        n.type === s.type,
    );
    if (same && (same.builtin || same.templates.every((t, i) => t.front === s.templates[i].front && t.back === s.templates[i].back))) {
      ntMap.set(s.id, same);
      continue;
    }
    const nt: NoteType = { id: uid(), kind: 'notetype', updatedAt: 0, name: s.name, type: s.type, fields: s.fields, templates: s.templates, css: s.css };
    ntMap.set(s.id, nt);
    newNts.push(nt);
  }
  if (newNts.length) put(newNts);

  /* decks */
  const deckNames = new Map<string, string>();
  const deckRows = rows('select id, name from decks');
  if (deckRows.length) for (const d of deckRows) deckNames.set(String(d.id), String(d.name).split('\u001f').join('::'));
  else if (col.decks) for (const [id, d] of Object.entries(JSON.parse(String(col.decks)) as Record<string, { name: string }>)) deckNames.set(id, d.name);
  const deckIdMap = new Map<string, string>();
  const deckFor = (srcId: string) => {
    let id = deckIdMap.get(srcId);
    if (!id) {
      id = ensureDeckPath(deckNames.get(srcId) || 'Imported');
      deckIdMap.set(srcId, id);
    }
    return id;
  };

  /* notes */
  progress('Importing notes…');
  const existingByGuid = new Map(all('note').filter((n) => n.guid).map((n) => [n.guid!, n]));
  const srcNotes = rows('select id, guid, mid, tags, flds from notes');
  const noteIdMap = new Map<string, Note>();
  const notesOut: Note[] = [];
  let updated = 0;

  // first card per note decides the note's deck
  const srcCards = rows('select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, odue, odid, flags, data from cards');
  const firstDeck = new Map<string, string>();
  for (const c of srcCards) {
    const nid = String(c.nid);
    if (!firstDeck.has(nid)) firstDeck.set(nid, String(Number(c.odid) ? c.odid : c.did));
  }

  for (const n of srcNotes) {
    const nt = ntMap.get(String(n.mid));
    if (!nt) continue;
    const vals = String(n.flds).split('\u001f');
    const fields = Object.fromEntries(nt.fields.map((f, i) => [f, vals[i] ?? '']));
    const tags = String(n.tags || '').trim().split(/\s+/).filter(Boolean);
    const guid = String(n.guid);
    const existing = existingByGuid.get(guid);
    if (existing) {
      noteIdMap.set(String(n.id), existing);
      notesOut.push({ ...existing, fields, tags });
      updated++;
      continue;
    }
    const note: Note = {
      id: uid(),
      kind: 'note',
      updatedAt: 0,
      noteTypeId: nt.id,
      deckId: deckFor(firstDeck.get(String(n.id)) || '1'),
      fields,
      tags,
      createdAt: Number(n.id) || Date.now(),
      guid,
    };
    noteIdMap.set(String(n.id), note);
    notesOut.push(note);
  }

  /* review history (also used to find each card's last review) */
  const lastReview = new Map<string, number>();
  const revRows = opts.importScheduling ? rows('select id, cid, ease, ivl, lastIvl, factor, time, type from revlog') : [];
  for (const r of revRows) {
    const cid = String(r.cid);
    const ts = Number(r.id);
    if ((lastReview.get(cid) || 0) < ts) lastReview.set(cid, ts);
  }

  /* cards */
  progress('Importing cards…');
  const existingCardKeys = new Set(all('card').map((c) => `${c.noteId}:${c.ord}`));
  const cardIdMap = new Map<string, Card>();
  const noteMid = new Map(srcNotes.map((n) => [String(n.id), String(n.mid)]));
  const cardsOut: Card[] = [];
  let pos = all('card').reduce((m, c) => Math.max(m, c.position || 0), 0);
  for (const c of srcCards) {
    const note = noteIdMap.get(String(c.nid));
    if (!note) continue;
    // Anki cloze card ord 0 is {{c1::}}; here cloze cards use the cloze number
    const ord = Number(c.ord) + (ntMap.get(noteMid.get(String(c.nid)) || '')?.type === 'cloze' ? 1 : 0);
    if (existingCardKeys.has(`${note.id}:${ord}`)) continue;
    const srcDeck = String(Number(c.odid) ? c.odid : c.did);
    const type = opts.importScheduling ? Number(c.type) : 0;
    const queue = Number(c.queue);
    let due = Number(Number(c.odid) ? c.odue : c.due);
    let data: { s?: number; d?: number } = {};
    try { data = c.data ? JSON.parse(String(c.data)) : {}; } catch { /* ignore */ }
    const ivl = Math.max(0, Number(c.ivl));
    const card: Card = {
      id: uid(),
      kind: 'card',
      updatedAt: 0,
      noteId: note.id,
      deckId: deckFor(srcDeck),
      ord,
      state: CardState.New,
      due: 0,
      stability: opts.importScheduling && data.s ? data.s : 0,
      difficulty: opts.importScheduling && data.d ? data.d : 0,
      ease: Number(c.factor) ? Number(c.factor) / 1000 : 0,
      scheduledDays: ivl,
      learningStep: 0,
      reps: opts.importScheduling ? Number(c.reps) : 0,
      lapses: opts.importScheduling ? Number(c.lapses) : 0,
      lastReview: null,
      queue: queue === -1 && opts.importScheduling ? 'suspended' : 'normal',
      flag: Number(c.flags) & 7,
      position: ++pos,
      createdAt: note.createdAt,
    };
    if (type === 0) {
      card.scheduledDays = 0;
      card.ease = 0;
    } else if (type === 2) {
      card.state = CardState.Review;
      card.due = dayStart(crtDay + due);
    } else {
      card.state = type === 3 ? CardState.Relearning : CardState.Learning;
      // intraday learning stores an epoch-seconds timestamp, interday a day number
      if (due > 1e9) card.due = due * 1000;
      else card.due = dayStart(crtDay + due);
    }
    if (card.state !== CardState.New) {
      card.lastReview = lastReview.get(String(c.id)) || (card.state === CardState.Review ? card.due - ivl * DAY : Date.now());
    }
    cardIdMap.set(String(c.id), card);
    cardsOut.push(card);
  }

  const revOut: RevLog[] = [];
  for (const r of revRows) {
    const card = cardIdMap.get(String(r.cid));
    if (!card) continue;
    const ease = Number(r.ease);
    const typ = Number(r.type);
    if (ease < 1 || ease > 4 || typ > 3) continue;
    revOut.push({
      id: uid(),
      kind: 'revlog',
      updatedAt: 0,
      cardId: card.id,
      noteId: card.noteId,
      deckId: card.deckId,
      rating: ease as 1 | 2 | 3 | 4,
      state: typ === 0 ? (Number(r.lastIvl) === 0 ? CardState.New : CardState.Learning) : typ === 1 ? CardState.Review : typ === 2 ? CardState.Relearning : CardState.Review,
      review: Number(r.id),
      timeMs: Number(r.time),
      interval: Number(r.ivl),
      lastInterval: Number(r.lastIvl),
      ease: Number(r.factor) / 1000,
    });
  }
  db.close();

  /* media */
  progress('Importing media…');
  let mediaCount = 0, skipped = 0;
  const mediaFile = zip.file('media');
  if (mediaFile) {
    let raw = await mediaFile.async('uint8array');
    let entries: [string, string][] = [];
    if (isZstd(raw)) {
      raw = decompress(raw);
      // MediaEntries { repeated MediaEntry entries = 1 } MediaEntry { string name = 1; uint32 size = 2; ... }
      pbFields(raw).filter((f) => f.no === 1 && f.wire === 2).forEach((f, i) => {
        const e = pbFields(f.value as Uint8Array);
        entries.push([String(i), pbStr(e, 1)]);
      });
    } else {
      try {
        entries = Object.entries(JSON.parse(dec.decode(raw)) as Record<string, string>);
      } catch { entries = []; }
    }
    const existingMedia = new Set(all('media').map((m) => m.name));
    const referenced = new Set<string>();
    for (const n of notesOut) for (const v of Object.values(n.fields)) {
      for (const m of v.matchAll(/src="([^"]+)"/g)) referenced.add(decodeURIComponent(m[1]));
      for (const m of v.matchAll(/\[sound:([^\]]+)\]/g)) referenced.add(m[1]);
    }
    const out: Media[] = [];
    for (const [zipName, name] of entries) {
      if (!name || existingMedia.has(name) || !referenced.has(name)) continue;
      const f = zip.file(zipName);
      if (!f) continue;
      let bytes = await f.async('uint8array');
      if (isZstd(bytes)) bytes = decompress(bytes);
      if (bytes.length > 1_500_000) { skipped++; continue; }
      out.push({ id: uid(), kind: 'media', updatedAt: 0, name, dataUrl: toDataUrl(bytes, name) });
    }
    if (out.length) put(out);
    mediaCount = out.length;
  }

  progress('Saving…');
  put([...notesOut, ...cardsOut, ...revOut]);
  return {
    notes: notesOut.length - updated,
    updated,
    cards: cardsOut.length,
    decks: deckIdMap.size,
    noteTypes: newNts.length,
    media: mediaCount,
    skippedMedia: skipped,
    revlogs: revOut.length,
  };
}
