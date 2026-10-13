import { useState } from 'react';
import { Icon, Seg, TopBar, toast } from '../components/ui';
import { AI_MODELS, getAiSettings, saveAiSettings } from '../lib/ai';
import { getSettings } from '../lib/seed';
import { exportAll, put, useRec } from '../lib/store';
import { configSource, eraseAccountData, friendlyAuthError, signOutAndClear, unsyncedCount, getConfig, keyProblem, normaliseUrl, saveConfig, supabase, supabaseClientError, syncNow, testConnection, useSyncStatus, type CheckResult } from '../lib/sync';
import type { AnyRec } from '../lib/types';
import { download, setDayStartHour } from '../lib/util';

const THEME_KEY = 'study.theme';
export function applyTheme(t = localStorage.getItem(THEME_KEY) || 'system') {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function SettingsPage() {
  useRec('settings', 'settings');
  const settings = getSettings();
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || 'system');
  const update = (p: Partial<typeof settings>) => {
    put({ ...settings, ...p });
    if (p.dayStartHour !== undefined) setDayStartHour(p.dayStartHour);
  };

  return (
    <>
      <TopBar crumbs={[{ label: 'Settings' }]} />
      <div className="page-head"><h1>Settings</h1></div>
      <div className="col" style={{ gap: 18, maxWidth: 760 }}>
        <SyncSection />
        <AiSection />

        <section className="panel pad col" style={{ gap: 16 }}>
          <h2>General</h2>
          <div className="row between wrap">
            <span>Appearance</span>
            <Seg
              value={theme}
              onChange={(t) => { setTheme(t); localStorage.setItem(THEME_KEY, t); applyTheme(t); }}
              options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            />
          </div>
          <div className="form-grid">
            <label className="field">Next day starts at
              <select value={settings.dayStartHour} onChange={(e) => update({ dayStartHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="hint">Like Anki: reviews done after midnight count toward the previous day until this hour.</span>
            </label>
            <label className="field">Weekly study goal (hours)
              <input type="number" min={1} max={100} value={settings.weeklyGoalHours} onChange={(e) => update({ weeklyGoalHours: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </div>
          <label className="check"><input type="checkbox" checked={settings.weekStartsMonday} onChange={(e) => update({ weekStartsMonday: e.target.checked })} /> Weeks start on Monday</label>
          <label className="check"><input type="checkbox" checked={settings.countTimetableHours} onChange={(e) => update({ countTimetableHours: e.target.checked })} /> Count ticked timetable sessions toward weekly hours</label>
          <p className="muted small" style={{ marginTop: -8, marginLeft: 27 }}>Flashcard and Quick Learn time is always tracked automatically. Turn this off if you do your flashcards inside timetabled sessions, so time isn't counted twice.</p>
        </section>

        <section className="panel pad col" style={{ gap: 12 }}>
          <h2>Install on your devices</h2>
          <div className="small col" style={{ gap: 8 }}>
            <div><b>iPhone:</b> open this site in Safari → Share → <i>Add to Home Screen</i>. It then opens full-screen like an app and works offline.</div>
            <div><b>Mac:</b> Safari → File → <i>Add to Dock</i>, or Chrome → ⋮ → Cast, save and share → <i>Install page as app</i>.</div>
            <div><b>Windows:</b> Edge or Chrome → the install icon in the address bar (or ⋮ → Apps → <i>Install this site as an app</i>).</div>
          </div>
        </section>

        <BackupSection />
      </div>
    </>
  );
}

type Msg = { kind: 'error' | 'ok' | 'info'; text: string } | null;

function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const style = msg.kind === 'error' ? { background: 'var(--bad-soft)', color: 'var(--ink)' } : msg.kind === 'ok' ? { background: 'var(--good-soft)', color: 'var(--ink)' } : undefined;
  return (
    <div className="callout small" role={msg.kind === 'error' ? 'alert' : 'status'} style={style}>
      {msg.kind === 'error' ? '⚠️ ' : msg.kind === 'ok' ? '✓ ' : ''}{msg.text}
    </div>
  );
}

function SyncSection() {
  const st = useSyncStatus();
  const cfg = getConfig();
  const source = configSource();
  const [url, setUrl] = useState(cfg?.url || '');
  const [key, setKey] = useState(cfg?.anonKey || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(() => {
    const pending = sessionStorage.getItem('study.authMessage');
    if (pending) { sessionStorage.removeItem('study.authMessage'); return JSON.parse(pending) as Msg; }
    return null;
  });
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [showCfg, setShowCfg] = useState(!cfg);
  const clientErr = supabaseClientError();

  const runTest = async (c = cfg) => {
    if (!c) return;
    setBusy('test');
    setChecks(null);
    try {
      setChecks(await testConnection(c));
    } finally {
      setBusy(null);
    }
  };

  const auth = async (mode: 'in' | 'up' | 'magic') => {
    setMsg(null);
    const sb = supabase();
    if (!sb) {
      setMsg({ kind: 'error', text: `The connection settings aren't valid${clientErr ? ` (${clientErr})` : ''}. Open "Supabase connection" below, check the Project URL and key, and tap Test connection.` });
      setShowCfg(true);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg({ kind: 'error', text: 'Enter your email address.' });
    if (mode !== 'magic' && password.length < 6) return setMsg({ kind: 'error', text: 'Passwords need at least 6 characters.' });
    setBusy(mode);
    const redirect = location.origin + location.pathname;
    try {
      if (mode === 'magic') {
        const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setMsg({ kind: 'info', text: 'Check your email for a sign-in link. Open it on this device. On iPhone it opens in Safari – if you use the Home Screen app, sign in there with a password instead.' });
      } else if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMsg({ kind: 'error', text: 'There is already an account with this email – tap Sign in instead.' });
        } else if (data.session) {
          setMsg({ kind: 'ok', text: 'Account created and signed in – syncing now.' });
        } else {
          setMsg({ kind: 'info', text: `Account created. Your Supabase project asks people to confirm their email: open the email from Supabase and tap the link, then come back here and tap Sign in. If the link opens a page that can't be reached, set Supabase → Authentication → URL Configuration → Site URL to ${location.origin} and tap 'Email me a sign-in link instead'. (Or skip emails entirely: turn off 'Confirm email' in Authentication → Sign In / Providers → Email.)` });
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'Signed in – syncing now.' });
      }
    } catch (e) {
      const text = friendlyAuthError(e);
      setMsg({ kind: 'error', text });
      if (/reach Supabase|rejected the key/.test(text)) void runTest();
    } finally {
      setBusy(null);
    }
  };

  const saveConnection = () => {
    const u = normaliseUrl(url);
    const kp = keyProblem(key);
    if (!u) return setMsg({ kind: 'error', text: 'Paste your Project URL.' });
    if (kp) return setMsg({ kind: 'error', text: kp });
    const tidied = u !== url.trim();
    saveConfig({ url: u, anonKey: key });
    setUrl(u);
    setMsg({ kind: 'ok', text: `Connection saved${tidied ? ` – I tidied the URL to ${u}` : ''}. Now create an account or sign in above.` });
    setShowCfg(false);
    void runTest({ url: u, anonKey: key });
  };

  const signOut = async () => {
    setMsg(null);
    setBusy('out');
    try {
      await syncNow();
      const left = unsyncedCount();
      if (left && !confirm(`${left} change${left === 1 ? '' : 's'} on this device haven't synced yet${navigator.onLine ? '' : ' (you are offline)'}. Signing out removes them. Sign out anyway?`)) return;
      await signOutAndClear();
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    if (!confirm(`Erase ALL data in ${st.user?.email ?? 'this account'} on every device? This cannot be undone.`)) return;
    if (prompt('Type ERASE to confirm') !== 'ERASE') return;
    setBusy('erase');
    try {
      await eraseAccountData();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      setBusy(null);
    }
  };

  const stateLabel = st.user
    ? st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync problem' : st.state === 'offline' ? 'Offline' : 'Synced'
    : cfg ? 'Not signed in' : 'This device only';

  return (
    <section className="panel pad col" style={{ gap: 14 }}>
      <div className="row between">
        <h2>Sync</h2>
        <span className={`pill ${st.user && st.state === 'idle' ? 'good' : st.state === 'error' ? 'bad' : st.state === 'syncing' ? 'warn' : ''}`}>{stateLabel}</span>
      </div>
      <p className="muted small">Everything is saved on this device instantly and works offline. Sign in to sync between your MacBook, Windows PC and iPhone.</p>

      {st.user ? (
        <div className="col">
          <div>Signed in as <b>{st.user.email}</b></div>
          {st.lastSync && st.state !== 'error' && <div className="muted small">Last synced {new Date(st.lastSync).toLocaleTimeString()}</div>}
          {st.state === 'error' && st.error ? <Notice msg={{ kind: 'error', text: st.error }} /> : <Notice msg={msg} />}
          <div className="row wrap">
            <button className="btn" onClick={() => void syncNow()} disabled={st.state === 'syncing'}><Icon name="sync" /> Sync now</button>
            <button className="btn" disabled={!!busy} onClick={() => void signOut()}>Sign out</button>
          </div>
          <p className="muted tiny">Signing out removes this account's data from this device, so the next person or account starts with a clean slate. It all comes back when you sign in again.</p>
          <details className="small">
            <summary className="muted" style={{ cursor: 'pointer' }}>Start this account again from scratch</summary>
            <div className="col" style={{ gap: 8, marginTop: 8 }}>
              <p className="muted small">Deletes every deck, card, review, set, timetable and target saved in this account – on every device. Use this if another account's progress ended up in here. Export a backup first if you might want it back.</p>
              <button className="btn danger" style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => void erase()}>Erase all data in this account</button>
            </div>
          </details>
        </div>
      ) : cfg ? (
        <form className="col" onSubmit={(e) => { e.preventDefault(); void auth('in'); }}>
          {clientErr && <Notice msg={{ kind: 'error', text: `The connection settings aren't valid: ${clientErr}. Fix them under "Supabase connection" below.` }} />}
          <label className="field">Email
            <input type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="field">Password
            <div className="row">
              <input type={showPw ? 'text' : 'password'} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" className="btn sm" onClick={() => setShowPw(!showPw)}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          <Notice msg={msg} />
          <div className="row wrap">
            <button type="submit" className="btn primary" disabled={!!busy}>{busy === 'in' ? <span className="spinner" /> : null} Sign in</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void auth('up')}>{busy === 'up' ? <span className="spinner" /> : null} Create account</button>
          </div>
          <p className="muted small">First time? Type your email and a new password, then tap <b>Create account</b>. On your other devices use <b>Sign in</b> with the same details.</p>
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => void auth('magic')}>Email me a sign-in link instead</button>
        </form>
      ) : (
        <Notice msg={msg || { kind: 'info', text: 'Step 1: connect your Supabase project below. Step 2: create an account.' }} />
      )}

      <hr style={{ margin: '4px 0' }} />
      <div className="row between wrap">
        <div className="small">
          <b>Supabase connection</b>
          <div className="muted">{source === 'build' ? 'Built into this site (Vercel settings)' : source === 'device' ? 'Saved on this device' : 'Not set up'}{cfg ? ` · ${cfg.url.replace(/^https:\/\//, '')}` : ''}</div>
        </div>
        <div className="row">
          {cfg && <button className="btn sm" onClick={() => void runTest()} disabled={busy === 'test'}>{busy === 'test' ? <span className="spinner" /> : null} Test connection</button>}
          <button className="btn ghost sm" onClick={() => setShowCfg(!showCfg)}>{showCfg ? 'Hide' : cfg ? 'Change' : 'Set up'}</button>
        </div>
      </div>
      {checks && (
        <div className="panel" style={{ boxShadow: 'none' }}>
          {checks.map((c, i) => (
            <div key={i} className="list-row small" style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 18 }}>{c.ok === true ? '✅' : c.ok === false ? '❌' : '⚠️'}</span>
              <div className="grow"><b>{c.label}</b><div className="muted">{c.detail}</div></div>
            </div>
          ))}
        </div>
      )}
      {showCfg && (
        <div className="col">
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>In Supabase open <b>SQL Editor → New query</b>, paste all of <code>supabase/schema.sql</code> and press <b>Run</b>.</li>
            <li>Copy the <b>Project URL</b> (Project Settings → Data API) and the <b>publishable key</b> (Project Settings → API Keys, starts with <code>sb_publishable_</code>).</li>
            <li>Paste them here and tap Save. Never use the secret key.</li>
          </ol>
          <label className="field">Project URL<input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdwxyz.supabase.co" /></label>
          <label className="field">Publishable key<input type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" /></label>
          <div className="row wrap">
            <button className="btn primary" disabled={!url || !key} onClick={saveConnection}>Save connection</button>
            {url && key && <button className="btn" onClick={() => void runTest({ url, anonKey: key })}>Test these</button>}
            {source === 'device' && <button className="btn danger" onClick={() => { saveConfig(null); const c = getConfig(); setUrl(c?.url || ''); setKey(c?.anonKey || ''); setChecks(null); setMsg({ kind: 'info', text: c ? 'Using the connection built into this site again.' : 'Disconnected.' }); }}>Remove from this device</button>}
          </div>
        </div>
      )}
    </section>
  );
}

function AiSection() {
  const [s, setS] = useState(getAiSettings());
  const [show, setShow] = useState(false);
  const save = (n: typeof s) => { setS(n); saveAiSettings(n); };
  return (
    <section className="panel pad col" style={{ gap: 12 }}>
      <h2>AI card optimiser</h2>
      <div className="callout small">
        <b>Free with your Claude Pro plan:</b> when converting a set (or generating cards from notes), choose <i>Use Claude.ai</i>. The app writes the prompt for you – paste it into claude.ai, then paste Claude's reply back. No API key needed.
      </div>
      <p className="muted small">
        Optional: for one-click conversion, add a Claude API key from console.anthropic.com. The API is billed separately from Pro (pay-as-you-go; converting a typical 50-term set costs well under 1p on Haiku and roughly 5–15p on Opus). The key is stored only on this device and never synced.
      </p>
      <div className="form-grid">
        <label className="field">Claude API key
          <div className="row">
            <input type={show ? 'text' : 'password'} value={s.apiKey} onChange={(e) => save({ ...s, apiKey: e.target.value.trim() })} placeholder="sk-ant-…" autoComplete="off" />
            <button className="btn sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </label>
        <label className="field">Model
          <select value={s.model} onChange={(e) => save({ ...s, model: e.target.value })}>
            {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

function BackupSection() {
  const doExport = () => {
    download(`study-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exported: Date.now(), records: exportAll() }), 'application/json');
  };
  const doImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()) as { records: AnyRec[] };
        if (!Array.isArray(data.records)) throw new Error('Not a backup file');
        put(data.records, { keepUpdatedAt: true });
        toast(`Restored ${data.records.length} items`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not read backup');
      }
    };
    input.click();
  };
  return (
    <section className="panel pad col" style={{ gap: 12 }}>
      <h2>Backup</h2>
      <p className="muted small">Download everything (cards, review history, sets, timetable, calendar) as one file.</p>
      <div className="row wrap">
        <button className="btn" onClick={doExport}><Icon name="download" /> Export backup</button>
        <button className="btn" onClick={doImport}><Icon name="upload" /> Restore backup</button>
        <button
          className="btn danger"
          style={{ marginLeft: 'auto' }}
          onClick={async () => {
            if (!confirm('Remove all data from THIS device? Synced data stays in Supabase and comes back when you sign in again.')) return;
            await signOutAndClear();
          }}
        >
          Clear this device
        </button>
      </div>
    </section>
  );
}
