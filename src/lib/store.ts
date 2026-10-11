import { useSyncExternalStore } from 'react';
import type { AnyRec, Kind, RecOf } from './types';

/*
 * Local-first record store.
 *  - Everything lives in memory + IndexedDB, so the app works offline and instantly.
 *  - Every write marks the record dirty; the sync engine (sync.ts) pushes dirty
 *    records to Supabase and pulls remote changes, resolving conflicts by updatedAt.
 */

const DB_NAME = 'study-app';
const DB_VERSION = 1;

type Listener = () => void;

const maps = new Map<Kind, Map<string, AnyRec>>();
const arrays = new Map<Kind, AnyRec[]>();
const versions = new Map<Kind, number>();
const listeners = new Map<Kind | '*', Set<Listener>>();
const dirty = new Set<string>(); // `${kind}:${id}`
let idb: IDBDatabase | null = null;
let pendingWrites = new Map<string, AnyRec>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let onDirty: (() => void) | null = null;
let ready = false;

const key = (kind: Kind, id: string) => `${kind}:${id}`;

function mapFor(kind: Kind) {
  let m = maps.get(kind);
  if (!m) maps.set(kind, (m = new Map()));
  return m;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store: string): Promise<{ keys: IDBValidKey[]; values: unknown[] }> {
  return new Promise((resolve, reject) => {
    if (!idb) return resolve({ keys: [], values: [] });
    const tx = idb.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const kr = os.getAllKeys();
    const vr = os.getAll();
    tx.oncomplete = () => resolve({ keys: kr.result, values: vr.result });
    tx.onerror = () => reject(tx.error);
  });
}

export async function metaGet<T>(k: string): Promise<T | undefined> {
  if (!idb) return undefined;
  return new Promise((resolve) => {
    const tx = idb!.transaction('meta', 'readonly');
    const r = tx.objectStore('meta').get(k);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => resolve(undefined);
  });
}

export async function metaSet(k: string, v: unknown): Promise<void> {
  if (!idb) return;
  return new Promise((resolve) => {
    const tx = idb!.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function initStore(): Promise<void> {
  if (ready) return;
  try {
    idb = await openIdb();
    const { keys, values } = await idbGetAll('records');
    keys.forEach((_, i) => {
      const r = values[i] as AnyRec;
      if (r && r.kind && r.id) mapFor(r.kind).set(r.id, r);
    });
    const d = (await metaGet<string[]>('dirty')) || [];
    d.forEach((x) => dirty.add(x));
  } catch (e) {
    console.warn('IndexedDB unavailable, running in-memory only', e);
  }
  ready = true;
  for (const k of maps.keys()) bump(k);
}

function bump(kind: Kind) {
  versions.set(kind, (versions.get(kind) || 0) + 1);
  arrays.delete(kind);
  listeners.get(kind)?.forEach((l) => l());
  listeners.get('*')?.forEach((l) => l());
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 150);
}

async function flush() {
  flushTimer = null;
  const writes = pendingWrites;
  pendingWrites = new Map();
  if (!idb || !writes.size) return;
  await new Promise<void>((resolve) => {
    const tx = idb!.transaction(['records', 'meta'], 'readwrite');
    const os = tx.objectStore('records');
    writes.forEach((rec, k) => os.put(rec, k));
    tx.objectStore('meta').put([...dirty], 'dirty');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Flush pending writes immediately (e.g. before the page unloads). */
export const flushNow = () => {
  if (flushTimer) clearTimeout(flushTimer);
  return flush();
};

/* ───────── read API ───────── */

export function all<K extends Kind>(kind: K): RecOf<K>[] {
  let a = arrays.get(kind);
  if (!a) {
    a = [...mapFor(kind).values()].filter((r) => !r.deleted);
    arrays.set(kind, a);
  }
  return a as RecOf<K>[];
}

export function get<K extends Kind>(kind: K, id: string | null | undefined): RecOf<K> | undefined {
  if (!id) return undefined;
  const r = mapFor(kind).get(id);
  return r && !r.deleted ? (r as RecOf<K>) : undefined;
}

/** Includes tombstones – used by sync. */
export function getRaw(kind: Kind, id: string): AnyRec | undefined {
  return mapFor(kind).get(id);
}

/* ───────── write API ───────── */

type Input = AnyRec extends infer R ? (R extends AnyRec ? Omit<R, 'updatedAt'> & { updatedAt?: number } : never) : never;

export function put(rec: Input | Input[], opts?: { keepUpdatedAt?: boolean }): void {
  const list = Array.isArray(rec) ? rec : [rec];
  const now = Date.now();
  const kinds = new Set<Kind>();
  for (const r0 of list) {
    const updatedAt = opts?.keepUpdatedAt && r0.updatedAt ? r0.updatedAt : Math.max(now, (r0.updatedAt || 0) + 1);
    const r = { ...r0, updatedAt } as unknown as AnyRec;
    mapFor(r.kind).set(r.id, r);
    const k = key(r.kind, r.id);
    dirty.add(k);
    pendingWrites.set(k, r);
    kinds.add(r.kind);
  }
  kinds.forEach(bump);
  scheduleFlush();
  onDirty?.();
}

/** Merge partial changes into an existing record. */
export function patch<K extends Kind>(kind: K, id: string, changes: Partial<RecOf<K>>): void {
  const cur = get(kind, id);
  if (!cur) return;
  put({ ...cur, ...changes } as AnyRec);
}

export function remove(kind: Kind, ids: string | string[]): void {
  const list = Array.isArray(ids) ? ids : [ids];
  const tomb = list
    .map((id) => mapFor(kind).get(id))
    .filter(Boolean)
    .map((r) => ({ id: r!.id, kind, deleted: true }) as unknown as AnyRec);
  if (tomb.length) put(tomb);
}

/** Apply a record received from the server (no dirty marking). Returns true if applied. */
export function applyRemote(rec: AnyRec): boolean {
  const m = mapFor(rec.kind);
  const cur = m.get(rec.id);
  if (cur && cur.updatedAt >= rec.updatedAt) return false;
  m.set(rec.id, rec);
  const k = key(rec.kind, rec.id);
  dirty.delete(k);
  pendingWrites.set(k, rec);
  return true;
}

export function finishRemoteBatch(kinds: Set<Kind>) {
  kinds.forEach(bump);
  scheduleFlush();
}

export function dirtyRecords(): AnyRec[] {
  const out: AnyRec[] = [];
  for (const k of dirty) {
    const i = k.indexOf(':');
    const r = mapFor(k.slice(0, i) as Kind).get(k.slice(i + 1));
    if (r) out.push(r);
    else dirty.delete(k);
  }
  return out;
}

export function markClean(recs: AnyRec[]) {
  for (const r of recs) {
    const cur = mapFor(r.kind).get(r.id);
    if (cur && cur.updatedAt === r.updatedAt) dirty.delete(key(r.kind, r.id));
  }
  void metaSet('dirty', [...dirty]);
}

export function markAllDirty() {
  for (const [kind, m] of maps) for (const id of m.keys()) dirty.add(key(kind, id));
  void metaSet('dirty', [...dirty]);
  onDirty?.();
}

export const dirtyCount = () => dirty.size;

export function setOnDirty(fn: (() => void) | null) {
  onDirty = fn;
}

export async function clearAll() {
  maps.clear();
  arrays.clear();
  dirty.clear();
  pendingWrites.clear();
  if (idb) {
    await new Promise<void>((resolve) => {
      const tx = idb!.transaction(['records', 'meta'], 'readwrite');
      tx.objectStore('records').clear();
      tx.objectStore('meta').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  for (const k of versions.keys()) bump(k);
}

export function exportAll(): AnyRec[] {
  const out: AnyRec[] = [];
  for (const m of maps.values()) for (const r of m.values()) if (!r.deleted) out.push(r);
  return out;
}

/* ───────── React hooks ───────── */

function subscribe(kind: Kind | '*', l: Listener) {
  let s = listeners.get(kind);
  if (!s) listeners.set(kind, (s = new Set()));
  s.add(l);
  return () => s!.delete(l);
}

export function useAll<K extends Kind>(kind: K): RecOf<K>[] {
  return useSyncExternalStore(
    (l) => subscribe(kind, l),
    () => all(kind),
  );
}

export function useRec<K extends Kind>(kind: K, id: string | null | undefined): RecOf<K> | undefined {
  useSyncExternalStore(
    (l) => subscribe(kind, l),
    () => versions.get(kind) || 0,
  );
  return get(kind, id);
}

/** Re-render when any of the given kinds change. Returns a combined version number. */
export function useVersion(...kinds: Kind[]): number {
  return useSyncExternalStore(
    (l) => {
      const offs = kinds.map((k) => subscribe(k, l));
      return () => offs.forEach((o) => o());
    },
    () => kinds.reduce((s, k) => s * 31 + (versions.get(k) || 0), 7),
  );
}
