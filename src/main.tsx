import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { initStore, flushNow } from './lib/store';
import { ensureSeed } from './lib/seed';
import { startSync } from './lib/sync';
import { applyTheme } from './pages/Settings';

applyTheme();

initStore().then(() => {
  ensureSeed();
  void startSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

window.addEventListener('pagehide', () => void flushNow());
