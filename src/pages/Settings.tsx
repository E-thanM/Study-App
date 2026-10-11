import { useState } from 'react';
import { Icon, Seg, TopBar, toast } from '../components/ui';
import { AI_MODELS, getAiSettings, saveAiSettings } from '../lib/ai';
import { getSettings } from '../lib/seed';
import { clearAll, exportAll, put, useRec } from '../lib/store';
import { getConfig, saveConfig, supabase, syncNow, useSyncStatus } from '../lib/sync';
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

function SyncSection() {
  const st = useSyncStatus();
  const cfg = getConfig();
  const [url, setUrl] = useState(cfg?.url || '');
  const [key, setKey] = useState(cfg?.anonKey || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCfg, setShowCfg] = useState(!cfg);

  const auth = async (mode: 'in' | 'up' | 'magic') => {
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    try {
      if (mode === 'magic') {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        toast('Check your email for a sign-in link');
      } else if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        toast(data.session ? 'Account created – syncing' : 'Account created – confirm your email, then sign in');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast('Signed in – syncing');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), undefined, 5000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel pad col" style={{ gap: 14 }}>
      <div className="row between">
        <h2>Sync</h2>
        <span className={`pill ${st.state === 'idle' ? 'good' : st.state === 'error' ? 'bad' : st.state === 'syncing' ? 'warn' : ''}`}>
          {st.state === 'idle' ? 'Synced' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Error' : st.state === 'offline' ? 'Offline' : st.state === 'signed-out' ? 'Signed out' : 'This device only'}
        </span>
      </div>
      <p className="muted small">Everything is saved on this device instantly and works offline. Connect your free Supabase project to sync between your MacBook, Windows PC and iPhone.</p>

      {st.user ? (
        <div className="col">
          <div className="row between wrap">
            <div>
              Signed in as <b>{st.user.email}</b>
              {st.lastSync && <div className="muted small">Last synced {new Date(st.lastSync).toLocaleTimeString()}</div>}
              {st.error && <div className="small" style={{ color: 'var(--bad)' }}>{st.error}</div>}
            </div>
            <div className="row">
              <button className="btn" onClick={() => void syncNow()}><Icon name="sync" /> Sync now</button>
              <button className="btn" onClick={() => void supabase()?.auth.signOut()}>Sign out</button>
            </div>
          </div>
        </div>
      ) : cfg ? (
        <div className="col">
          <div className="form-grid">
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && auth('in')} />
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={busy || !email || !password} onClick={() => auth('in')}>Sign in</button>
            <button className="btn" disabled={busy || !email || password.length < 6} onClick={() => auth('up')}>Create account</button>
            <button className="btn ghost" disabled={busy || !email} onClick={() => auth('magic')}>Email me a link</button>
          </div>
        </div>
      ) : null}

      <div>
        <button className="btn ghost sm" onClick={() => setShowCfg(!showCfg)}>{showCfg ? 'Hide' : 'Show'} Supabase connection</button>
      </div>
      {showCfg && (
        <div className="col">
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Create a free project at supabase.com.</li>
            <li>In <b>SQL Editor</b>, paste and run <code>supabase/schema.sql</code> from this app's repository.</li>
            <li>In <b>Project Settings → API</b>, copy the Project URL and the <i>anon public</i> key below.</li>
            <li>Do the same on each device (or bake them into the build with <code>VITE_SUPABASE_URL</code>/<code>VITE_SUPABASE_ANON_KEY</code>), then sign in with the same account.</li>
          </ol>
          <label className="field">Project URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://abcd1234.supabase.co" /></label>
          <label className="field">Anon public key<input type="text" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="eyJhbGciOi…" /></label>
          <div className="row">
            <button className="btn primary" disabled={!url || !key} onClick={() => { saveConfig({ url, anonKey: key }); toast('Saved – now sign in'); setShowCfg(false); }}>Save connection</button>
            {cfg && <button className="btn danger" onClick={() => { saveConfig(null); setUrl(''); setKey(''); }}>Disconnect</button>}
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
            await supabase()?.auth.signOut();
            await clearAll();
            location.reload();
          }}
        >
          Clear this device
        </button>
      </div>
    </section>
  );
}
