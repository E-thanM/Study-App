import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { initStore, flushNow } from './lib/store';
import { ensureSeed } from './lib/seed';
import { startSync, supabase } from './lib/sync';
import { applyTheme } from './pages/Settings';

applyTheme();

/**
 * Links in Supabase emails (confirm sign-up, magic link) come back as
 * "#access_token=…" or "#error=…". The app's own pages also live after "#",
 * so let Supabase read the link first, then send the user to Settings with a message.
 */
async function handleAuthRedirect() {
  const hash = location.hash.replace(/^#/, '');
  const search = location.search.replace(/^\?/, '');
  const params = new URLSearchParams(/access_token=|error=/.test(hash) ? hash : search);
  const isAuth = params.has('access_token') || params.has('error') || params.has('error_description');
  if (!isAuth) return;
  const say = (kind: string, text: string) => sessionStorage.setItem('study.authMessage', JSON.stringify({ kind, text }));
  if (params.get('error') || params.get('error_description')) {
    const d = params.get('error_description') || params.get('error') || '';
    say('error', /expired|invalid/i.test(d)
      ? 'That email link has expired or was already used. Sign in with your email and password, or ask for a new link.'
      : `Sign-in link problem: ${d}`);
  } else {
    try {
      // creating the client makes Supabase read and store the session from the URL
      await supabase()?.auth.getSession();
      say('ok', params.get('type') === 'signup' ? 'Email confirmed – you are signed in and syncing.' : 'Signed in – syncing now.');
    } catch {
      say('error', 'Could not finish signing in from that link – please sign in with your password.');
    }
  }
  history.replaceState(null, '', location.pathname + '#/settings');
}

initStore().then(async () => {
  ensureSeed();
  await handleAuthRedirect();
  void startSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

window.addEventListener('pagehide', () => void flushNow());
