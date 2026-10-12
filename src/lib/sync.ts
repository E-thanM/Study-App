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

/**
 * Tidy a pasted Project URL down to just the address: https://<ref>.supabase.co
 * Handles quotes, spaces, a missing https://, trailing slashes, /rest/v1/ (shown on the
 * Data API page) and dashboard links like https://supabase.com/dashboard/project/<ref>/….
 */
export function normaliseUrl(raw: string): string {
  let u = (raw || '').trim().replace(/^["'`<]+|["'`>]+$/g, '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    if (/(^|\.)supabase\.com$/i.test(x.hostname)) {
      const ref = /\/project\/([a-z0-9]{15,30})(?:\/|$)/i.exec(x.pathname)?.[1];
      if (ref) return `https://${ref.toLowerCase()}.supabase.co`;
    }
    return x.origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
}

/** Problems with a key that we can spot before talking to Supabase. */
export function keyProblem(key: string): string | null {
  const k = (key || '').trim();
  if (!k) return 'Paste your publishable key.';
  if (k.startsWith('sb_secret_')) return "That's the secret key – never put it in the app. Use the publishable key (starts with sb_publishable_).";
  if (k.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return "That's the service_role key – never put it in the app. Use the anon (or publishable) key.";
    } catch {
      return "That key looks incomplete – copy it again with the copy button.";
    }
    return null;
  }
  if (k.startsWith('sb_publishable_')) return null;
  return "That doesn't look like a Supabase key – it should start with sb_publishable_ (or eyJ for the legacy anon key).";
}

export function getConfig(): SupaConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as SupaConfig;
      if (c.url && c.anonKey) return { url: normaliseUrl(c.url), anonKey: c.anonKey.trim() };
    }
  } catch {
    /* ignore */
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url: normaliseUrl(url), anonKey: anonKey.trim() } : null;
}

/** Where the current connection came from, for the Settings page. */
export function configSource(): 'device' | 'build' | null {
  try {
    if (localStorage.getItem(CFG_KEY)) return 'device';
  } catch {
    /* ignore */
  }
  return import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? 'build' : null;
}

export function saveConfig(c: SupaConfig | null) {
  if (c) localStorage.setItem(CFG_KEY, JSON.stringify({ url: normaliseUrl(c.url), anonKey: c.anonKey.trim() }));
  else localStorage.removeItem(CFG_KEY);
  client = null;
  clientError = null;
  void startSync();
}

let client: SupabaseClient | null = null;
let clientError: string | null = null;
export function supabase(): SupabaseClient | null {
  if (client) return client;
  const c = getConfig();
  if (!c) return null;
  try {
    client = createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    clientError = null;
  } catch (e) {
    console.error(e);
    clientError = e instanceof Error ? e.message : String(e);
    client = null;
  }
  return client;
}

/** Why the Supabase client couldn't be created (e.g. a malformed URL). */
export const supabaseClientError = () => clientError;

/** Turn Supabase auth errors into plain-English advice. */
export function friendlyAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : (e as { message?: string })?.message || String(e);
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password. If you haven't made an account yet, tap Create account.";
  if (/email not confirmed/i.test(msg))
    return "Your email isn't confirmed yet. Either tap the link in the confirmation email (then come back and sign in), or in Supabase go to Authentication → Sign In / Providers → Email, turn off 'Confirm email', and sign in again.";
  if (/already registered|already been registered|user already exists/i.test(msg)) return 'There is already an account with this email – tap Sign in instead.';
  if (/signups? not allowed|signup is disabled/i.test(msg)) return "New accounts are switched off in Supabase. Turn on 'Allow new users to sign up' under Authentication → Sign In / Providers.";
  if (/rate limit|too many/i.test(msg)) return "Too many attempts – wait a minute and try again. (Supabase's free plan only sends a few emails per hour.)";
  if (/invalid path specified|PGRST125/i.test(msg))
    return `Supabase says the address is wrong – the Project URL has extra text on the end (the app is using ${getConfig()?.url ?? 'no URL'}). It should be only https://yourproject.supabase.co. Tap Change under "Supabase connection", fix it, and tap Test connection. If it came from Vercel, fix VITE_SUPABASE_URL there and redeploy.`;
  if (/invalid api key|no api key|apikey/i.test(msg)) return 'Supabase rejected the key. Check you copied the publishable key (sb_publishable_…) and tap Test connection.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg))
    return "Couldn't reach Supabase. Check your internet connection and that the Project URL is right – tap Test connection.";
  if (/password/i.test(msg) && /at least|characters|weak/i.test(msg)) return msg;
  if (/invalid email|unable to validate email/i.test(msg)) return "That email address doesn't look right.";
  return msg;
}

/** Turn sync (database) errors into plain-English advice. */
export function friendlySyncError(msg: string): string {
  if (/push_records|could not find the function|PGRST202/i.test(msg)) return "Your Supabase database isn't set up yet. In Supabase open SQL Editor → New query, paste all of supabase/schema.sql and press Run.";
  if (/records.*does not exist|could not find the table|PGRST205|42P01/i.test(msg)) return "The 'records' table is missing. In Supabase open SQL Editor → New query, paste all of supabase/schema.sql and press Run.";
  if (/permission denied|42501|row-level security/i.test(msg)) return 'Supabase refused permission. Re-run supabase/schema.sql in the SQL Editor, then sign out and in again.';
  if (/jwt|token.*expired|invalid claim/i.test(msg)) return 'Your sign-in has expired – sign out and sign in again.';
  if (/failed to fetch|network|load failed/i.test(msg)) return "Couldn't reach Supabase – changes are saved on this device and will sync when you're back online.";
  return msg;
}

export interface CheckResult { label: string; ok: boolean | null; detail: string }

/** Step-by-step check of the connection: URL, key, auth settings, database table and function. */
export async function testConnection(cfg: SupaConfig): Promise<CheckResult[]> {
  const url = normaliseUrl(cfg.url);
  const key = cfg.anonKey.trim();
  const out: CheckResult[] = [];
  const kp = keyProblem(key);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
    out.push({ label: 'Project URL', ok: false, detail: `"${url}" doesn't look like a Supabase URL. It should look like https://abcdwxyz.supabase.co (Project Settings → Data API).` });
    return out;
  }
  out.push({ label: 'Project URL', ok: true, detail: url });
  if (kp) {
    out.push({ label: 'Key', ok: false, detail: kp });
    return out;
  }
  const headers = { apikey: key };
  let settings: { disable_signup?: boolean; mailer_autoconfirm?: boolean; external?: { email?: boolean } } | null = null;
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers });
    if (r.status === 401 || r.status === 403) {
      out.push({ label: 'Key', ok: false, detail: 'Supabase rejected this key. Copy the publishable key again (Project Settings → API Keys).' });
      return out;
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (/invalid path specified|PGRST125/i.test(t)) {
        out.push({ label: 'Project URL', ok: false, detail: 'The address has extra text on the end. It should be only https://yourproject.supabase.co – nothing after .supabase.co.' });
        return out;
      }
      out.push({ label: 'Connection', ok: false, detail: `Supabase answered with an error (${r.status}). Check the Project URL, and that the project isn't paused (free projects pause after a week unused – press Restore in Supabase).` });
      return out;
    }
    settings = await r.json();
    out.push({ label: 'Key', ok: true, detail: 'Accepted' });
  } catch {
    out.push({ label: 'Connection', ok: false, detail: "Couldn't reach that URL. Check it's typed correctly, that you're online, and that the project isn't paused in Supabase." });
    return out;
  }
  if (settings?.external?.email === false) out.push({ label: 'Email sign-in', ok: false, detail: 'Email sign-in is turned off. Turn on Email under Authentication → Sign In / Providers.' });
  else if (settings?.disable_signup) out.push({ label: 'New accounts', ok: false, detail: "Sign-ups are disabled – turn on 'Allow new users to sign up' in Authentication → Sign In / Providers (or sign in with an existing account)." });
  else out.push({ label: 'Email sign-in', ok: true, detail: 'Enabled' });
  out.push(
    settings?.mailer_autoconfirm
      ? { label: 'Email confirmation', ok: true, detail: 'Off – you can sign in straight after creating an account' }
      : { label: 'Email confirmation', ok: null, detail: "On – after Create account you must tap the link in the email before you can sign in. Easier: turn off 'Confirm email' in Authentication → Sign In / Providers → Email." },
  );
  if (!settings?.mailer_autoconfirm && typeof location !== 'undefined' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname))
    out.push({ label: 'Email links', ok: null, detail: `Emails link back to Supabase's Site URL, which starts as http://localhost:3000. In Authentication → URL Configuration set Site URL to ${location.origin} and add ${location.origin}/** under Redirect URLs.` });
  try {
    const r = await fetch(`${url}/rest/v1/records?select=id&limit=1`, { headers });
    const body = await r.text();
    if (r.ok) out.push({ label: 'Database table', ok: true, detail: 'Found' });
    else if (/PGRST205|42P01|does not exist|could not find/i.test(body)) out.push({ label: 'Database table', ok: false, detail: 'Missing – open SQL Editor in Supabase, paste all of supabase/schema.sql and press Run.' });
    else out.push({ label: 'Database table', ok: null, detail: `Couldn't check (${r.status}).` });
    const f = await fetch(`${url}/rest/v1/rpc/push_records`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: [] }) });
    const fb = await f.text();
    if (f.status === 404 || /PGRST202|could not find the function/i.test(fb)) out.push({ label: 'Sync function', ok: false, detail: 'Missing – re-run all of supabase/schema.sql in the SQL Editor.' });
    else out.push({ label: 'Sync function', ok: true, detail: 'Found' });
  } catch {
    out.push({ label: 'Database', ok: null, detail: "Couldn't check the database." });
  }
  return out;
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
    const msg = e instanceof Error ? e.message : (e as { message?: string; code?: string })?.message || String(e);
    const code = (e as { code?: string })?.code || '';
    console.error('sync failed', e);
    setStatus({ state: 'error', error: friendlySyncError(`${msg} ${code}`.trim()) });
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
    setStatus({ configured: !!getConfig(), state: getConfig() ? 'error' : 'local', error: clientError ? `Connection settings are invalid: ${clientError}` : undefined });
    return;
  }
  setStatus({ configured: true });
  try {
    const { data } = await sb.auth.getSession();
    if (data.session?.user) await onSignedIn(sb, data.session.user);
    else onSignedOut();
  } catch (e) {
    console.error(e);
    onSignedOut();
  }
  const sub = sb.auth.onAuthStateChange((event, session) => {
    // Supabase warns against calling its API inside this callback (it can deadlock), so defer.
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session?.user && session.user.id !== status.user?.id) {
      const u = session.user;
      setTimeout(() => void onSignedIn(sb, u), 0);
    }
    if (event === 'SIGNED_OUT') setTimeout(onSignedOut, 0);
  });
  authSub = sub.data.subscription;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
}
