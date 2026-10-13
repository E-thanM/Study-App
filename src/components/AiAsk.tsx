import { useState } from 'react';
import { Link } from 'react-router-dom';
import { askAi, directAiLabel, getAiSettings, hasDirectAi } from '../lib/ai';
import { Icon, Seg, toast } from './ui';

/**
 * Runs a prompt either one-click (the AI service set up in Settings) or by copy & paste
 * into claude.ai / Qwen Chat, which is free. Hands the reply text back.
 */
export function AiAsk({ prompt, onReply, label = 'Get feedback', disabled }: { prompt: string; onReply: (text: string) => void; label?: string; disabled?: boolean }) {
  const ai = getAiSettings();
  const direct = hasDirectAi(ai);
  const [route, setRoute] = useState<'direct' | 'paste'>(direct ? 'direct' : 'paste');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    if (route === 'paste') return onReply(reply);
    setBusy(true);
    try {
      onReply(await askAi(prompt, ai));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Prompt copied – paste it into the chat');
    } catch {
      toast("Couldn't copy – select the text and copy it");
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <Seg value={route} onChange={setRoute} options={[{ value: 'direct', label: 'One-click AI' }, { value: 'paste', label: 'Copy & paste (free)' }]} />
      {route === 'direct' ? (
        <div className="small muted">
          {direct ? <>Uses <b>{directAiLabel(ai)}</b>.</> : <>Not set up yet – <Link to="/settings" style={{ color: 'var(--accent)' }}>connect a free Qwen 3 model or Claude in Settings</Link>, or use copy &amp; paste.</>}
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="small muted">1. Copy the prompt → 2. paste it into Claude.ai or Qwen Chat → 3. paste the whole reply below.</div>
          <div className="row wrap">
            <button className="btn" onClick={() => void copy()} disabled={disabled}><Icon name="copy" /> Copy prompt</button>
            <a className="btn ghost" href="https://claude.ai/new" target="_blank" rel="noreferrer">Claude.ai ↗</a>
            <a className="btn ghost" href="https://chat.qwen.ai" target="_blank" rel="noreferrer">Qwen Chat ↗</a>
          </div>
          <details className="small"><summary className="muted" style={{ cursor: 'pointer' }}>Show prompt</summary><div className="code-box">{prompt}</div></details>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the reply here…" style={{ minHeight: 90 }} />
        </div>
      )}
      {error && <div className="callout warn small">{error}</div>}
      <button className="btn primary" onClick={() => void run()} disabled={disabled || busy || (route === 'direct' ? !direct : !reply.trim())}>
        {busy ? <><span className="spinner" /> Thinking…</> : <><Icon name="sparkle" /> {route === 'paste' ? 'Read reply' : label}</>}
      </button>
    </div>
  );
}
