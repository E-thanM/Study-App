import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import type { AnyRec, Kind } from './types';
import {
  applyRemote,
  dirtyRecords,
  finishRemoteBatch,
  markAllDirty,
  markClean,
  metaGet,
  metaSet,
  setOnDirty,
} from './store';

/*
 * Supabase sync engine.
 * Table `records` (see supabase/schema.sql) stores every record as jsonb.
 *  push: dirty local records → rpc push_records (server keeps the newer updatedAt)
 *  pull: rows with server_ts > cursor → merged locally if newer
 *  realtime: postgres_changes triggers an immediate pull on other devices
 */

const CFG_KEY = 'study.supabase';

export interface SupaConfig {
  url: string;
  anonKey: string;
}

export function getConfig(): SupaConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as SupaConfig;
      if (c.url && c.anonKey) return c;
    }
  } catch {
    /* ignore */
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
}

export function saveConfig(c: SupaConfig | null) {
  if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c));
  else localStorage.removeItem(CFG_KEY);
  client = null;
  void startSync();
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (client) return client;
  const c = getConfig();
  if (!c) return null;
  try {
    client = createClient(c.url, c.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    console.error(e);
    client = null;
  }
  return client;
}

/* ───────── status for the UI ───────── */

export interface SyncStatus {
  configured: boolean;
  user: User | null;
  state: 'offline' | 'idle' | 'syncing' | 'error' | 'signed-out' | 'local';
  lastSync: number | null;
  error?: string;
}

let status: SyncStatus = { configured: false, user: null, state: 'local', lastSync: null };
const statusListeners = new Set<() => void>();
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  statusListeners.forEach((l) => l());
}
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );

/* ───────── engine ───────── */

let running = false;
let again = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: ReturnType<SupabaseClient['channel']> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let authSub: { unsubscribe: () => void } | null = null;

const CHUNK = 400;

async function push(sb: SupabaseClient) {
  const recs = dirtyRecords();
  for (let i = 0; i < recs.length; i += CHUNK) {
    const chunk = recs.slice(i, i + CHUNK);
    const rows = chunk.map((r) => ({
      id: r.id,
      kind: r.kind,
      data: r,
      updated_at: r.updatedAt,
      deleted: !!r.deleted,
    }));
    const { error } = await sb.rpc('push_records', { rows });
    if (error) throw error;
    markClean(chunk);
  }
}

async function pull(sb: SupabaseClient, userId: string) {
  const cursorKey = `seq:${userId}`;
  let cursor = (await metaGet<number>(cursorKey)) || 0;
  // a small overlap guards against concurrent pushes committing out of sequence order;
  // merging is idempotent so re-reading a few rows is harmless
  let from = Math.max(0, cursor - 50);
  for (;;) {
    const { data, error } = await sb
      .from('records')
      .select('id,kind,data,updated_at,deleted,seq')
      .gt('seq', from)
      .order('seq', { ascending: true })
      .limit(1000);
    if (error) throw error;
    if (!data?.length) break;
    const kinds = new Set<Kind>();
    for (const row of data) {
      const rec = (row.deleted
        ? { id: row.id, kind: row.kind, deleted: true, updatedAt: Number(row.updated_at) }
        : { ...(row.data as AnyRec), updatedAt: Number(row.updated_at) }) as AnyRec;
      if (applyRemote(rec)) kinds.add(rec.kind);
    }
    finishRemoteBatch(kinds);
    from = Number(data[data.length - 1].seq);
    cursor = Math.max(cursor, from);
    await metaSet(cursorKey, cursor);
    if (data.length < 1000) break;
  }
}

export async function syncNow(): Promise<void> {
  const sb = supabase();
  const user = status.user;
  if (!sb || !user) return;
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: undefined });
  try {
    do {
      again = false;
      await push(sb);
      await pull(sb, user.id);
    } while (again);
    setStatus({ state: 'idle', lastSync: Date.now() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message || String(e);
    console.error('sync failed', e);
    setStatus({ state: 'error', error: msg });
  } finally {
    running = false;
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), 1500);
}

async function onSignedIn(sb: SupabaseClient, user: User) {
  const lastUser = await metaGet<string>('lastUser');
  if (lastUser !== user.id) {
    // First sign-in on this device (or a different account): upload everything local.
    markAllDirty();
    await metaSet('lastUser', user.id);
  }
  setStatus({ user, state: 'idle' });
  setOnDirty(schedulePush);
  channel?.unsubscribe();
  channel = sb
    .channel('records-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${user.id}` }, () =>
      schedulePush(),
    )
    .subscribe();
  if (interval) clearInterval(interval);
  interval = setInterval(() => void syncNow(), 60_000);
  void syncNow();
}

function onSignedOut() {
  setOnDirty(null);
  channel?.unsubscribe();
  channel = null;
  if (interval) clearInterval(interval);
  setStatus({ user: null, state: 'signed-out' });
}

export async function startSync() {
  authSub?.unsubscribe();
  const sb = supabase();
  if (!sb) {
    onSignedOut();
    setStatus({ configured: false, state: 'local' });
    return;
  }
  setStatus({ configured: true });
  const { data } = await sb.auth.getSession();
  if (data.session?.user) await onSignedIn(sb, data.session.user);
  else onSignedOut();
  const sub = sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user && session.user.id !== status.user?.id) void onSignedIn(sb, session.user);
    if (event === 'SIGNED_OUT') onSignedOut();
  });
  authSub = sub.data.subscription;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
}
