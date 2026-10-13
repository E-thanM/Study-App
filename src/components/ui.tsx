import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSyncStatus } from '../lib/sync';

/* ───────── icons (1.6px stroke, 24 grid) ───────── */

const paths: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19v-8.5Z" />,
  timetable: <><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9.5h17M8 3v3M16 3v3M8 13.5h3M8 17h6" /></>,
  cards: <><rect x="6.5" y="3.5" width="13" height="16" rx="2.5" /><path d="M4.5 7v11a3 3 0 0 0 3 3H15" /><path d="M10 9.5h6M10 13h4" /></>,
  calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9.5h17M8 3v3M16 3v3" /><circle cx="8.5" cy="14" r="1" /><circle cx="12" cy="14" r="1" /><circle cx="15.5" cy="14" r="1" /><circle cx="8.5" cy="17.5" r="1" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  arrow: <path d="M7 17 17 7M9 7h8v8" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  more: <><circle cx="5.5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18.5" cy="12" r="1.3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  flame: <path d="M12 21c4 0 7-2.7 7-6.6 0-3.1-2-5.4-3.6-7.1-.4 1.6-1.3 2.7-2.4 3.1.3-2.9-.9-5.9-3.5-7.4.2 2.6-1.1 4.3-2.6 6C5.6 10.4 5 12.2 5 14.4 5 18.3 8 21 12 21Z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4.5 15v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4.5 15v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4" />,
  trash: <path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />,
  shuffle: <path d="M4 7h3.5c2.6 0 4 1.2 5.5 5s2.9 5 5.5 5H20M4 17h3.5c1.4 0 2.4-.4 3.2-1.2M15.3 8.2c.8-.8 1.8-1.2 3.2-1.2H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />,
  learn: <path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5ZM7 11.5v4.5c3 2.3 7 2.3 10 0v-4.5M21 9.5v5" />,
  test: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></>,
  match: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  speaker: <path d="M5 9.5h3l4.5-4v13L8 14.5H5v-5ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  flip: <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5" />,
  stats: <path d="M5 20V11M10 20V5M15 20v-7M20 20V9" />,
  browse: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9h17M9 9v10.5" /></>,
  sparkle: <path d="M12 3.5 13.8 9l5.7 1.5-5.7 1.6L12 17.5l-1.8-5.4L4.5 10.5 10.2 9 12 3.5ZM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
  sync: <path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3h3M4 13a8 8 0 0 0 14.6 4.5M20 20v-3h-3" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  grid: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16M10 4v16" /></>,
  note: <path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5ZM14 3.5V8h4M8.5 12.5h7M8.5 16h5" />,
  flag: <path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  write: <path d="M4 20h16M6 16l9.5-9.5a2.1 2.1 0 0 1 3 3L9 19H6v-3Z" />,
};

export function Icon({ name, size, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size || 18} height={size || 18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] || null}
    </svg>
  );
}

/* ───────── top bar ───────── */

const SECTIONS = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/timetable', label: 'Timetable', icon: 'timetable' },
  { to: '/cards', label: 'Flashcards', icon: 'cards' },
  { to: '/quick', label: 'Quick Learn', icon: 'bolt' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/tools', label: 'Tools', icon: 'target' },
];

export function TopBar({ crumbs, right }: { crumbs?: { to?: string; label: string }[]; right?: ReactNode }) {
  const st = useSyncStatus();
  const color =
    st.state === 'error' ? 'var(--bad)' : st.state === 'syncing' ? 'var(--warn)' : st.state === 'idle' ? 'var(--good)' : 'var(--faint)';
  const title =
    st.state === 'local' ? 'Not syncing – set up Supabase in Settings' : st.state === 'signed-out' ? 'Signed out – sign in to sync' : st.state === 'error' ? `Sync error: ${st.error}` : st.state === 'offline' ? 'Offline – changes saved on this device' : st.state === 'syncing' ? 'Syncing…' : 'Synced';
  // on phones: a back arrow to the parent page plus the current page title
  const parent = crumbs ? [...crumbs.slice(0, -1)].reverse().find((c) => c.to)?.to ?? '/' : null;
  const current = crumbs?.[crumbs.length - 1]?.label;
  return (
    <header className="topbar">
      <Link to="/" className={`brand ${crumbs?.length ? 'hide-sm' : ''}`} aria-label="Home">
        <span className="brand-dot" />
        <span>Study</span>
      </Link>
      {parent !== null && (
        <Link to={parent} className="btn ghost icon show-sm topbar-back" aria-label="Back">
          <Icon name="back" />
        </Link>
      )}
      {current && <span className="show-sm topbar-title">{current}</span>}
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs hide-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: 6, minWidth: 0 }}>
              <span className="sep">/</span>
              {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="spacer" />
      <nav className="topnav">
        {SECTIONS.slice(1).map((s) => (
          <NavLink key={s.to} to={s.to} className={({ isActive }) => (isActive ? 'on' : '')}>{s.label}</NavLink>
        ))}
      </nav>
      {right}
      <Link to="/settings" className="btn ghost icon" title={title} aria-label="Settings" style={{ position: 'relative' }}>
        <Icon name="settings" />
        <span className="sync-dot" style={{ background: color, position: 'absolute', top: 6, right: 6 }} />
      </Link>
    </header>
  );
}

/** Routes where the bottom tab bar is hidden so study screens get the full height. */
export const isFocusRoute = (path: string) =>
  /^\/cards\/review\//.test(path) || /^\/quick\/[^/]+\/(flashcards|learn|test|match|spell)$/.test(path);

/** Phone-only tab bar for moving between the four sections. */
export function BottomNav() {
  const { pathname } = useLocation();
  if (isFocusRoute(pathname)) return null;
  return (
    <nav className="bottomnav" aria-label="Sections">
      {SECTIONS.map((s) => (
        <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => (isActive ? 'on' : '')}>
          <Icon name={s.icon} size={22} />
          <span>{s.label === 'Quick Learn' ? 'Quick' : s.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Scroll to the top whenever the page changes (otherwise phones keep the old scroll position). */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** True on phone-sized screens. */
export function useIsMobile(query = '(max-width: 640px)') {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/* ───────── modal ───────── */

export function Modal({
  title, onClose, children, footer, size,
}: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xwide' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size || ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 style={{ fontSize: 18 }}>{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ───────── toasts ───────── */

interface ToastItem { id: number; text: string; action?: { label: string; fn: () => void } }
let toasts: ToastItem[] = [];
const toastListeners = new Set<() => void>();
let toastId = 0;
export function toast(text: string, action?: ToastItem['action'], ms = 3200) {
  const t = { id: ++toastId, text, action };
  // keep at most two on screen so quick reviewing doesn't stack them over the card
  toasts = [...toasts.slice(-1), t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, ms);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (l) => { toastListeners.add(l); return () => toastListeners.delete(l); },
    () => toasts,
  );
  return createPortal(
    <div className="toast-wrap">
      {list.map((t) => (
        <div className="toast" key={t.id}>
          {t.text}
          {t.action && <button onClick={t.action.fn}>{t.action.label}</button>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ───────── dropdown menu ───────── */

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; icon?: string; divider?: boolean }

export function MenuButton({ items, label, className }: { items: (MenuItem | null)[]; label?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', close));
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = () => {
    const r = ref.current!.getBoundingClientRect();
    const width = 220;
    // open upwards when there isn't room below (e.g. the last deck on a phone)
    const height = Math.min(items.filter(Boolean).length * 38 + 12, window.innerHeight - 24);
    const below = r.bottom + 6 + height < window.innerHeight;
    const top = below ? r.bottom + 6 : Math.max(12, r.top - 6 - height);
    setPos({ top: top + window.scrollY, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) + window.scrollX });
    setOpen((o) => !o);
  };
  return (
    <div ref={ref} style={{ display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
      <button className={className || 'btn ghost icon sm'} onClick={toggle} aria-label="More">
        {label || <Icon name="more" />}
      </button>
      {open &&
        createPortal(
          <div className="menu" style={{ top: pos.top, left: pos.left, width: 220, maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto' }}>
            {items.filter(Boolean).map((it, i) =>
              it!.divider ? <hr key={i} /> : (
                <button key={i} className={it!.danger ? 'danger' : ''} onClick={() => { setOpen(false); it!.onClick(); }}>
                  {it!.icon && <Icon name={it!.icon} size={16} />}
                  {it!.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ───────── tag input ───────── */

export function TagInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (t: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="pill">
          {t}
          <button onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
      <input
        type="text"
        list="tag-suggestions"
        value={text}
        placeholder={value.length ? '' : 'Add tags…'}
        onChange={(e) => {
          if (/[\s,]$/.test(e.target.value)) add(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      <datalist id="tag-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/* ───────── file drop ───────── */

export function FileDrop({ accept, onFile, label, multiple }: { accept: string; onFile: (f: File) => void; label: ReactNode; multiple?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        [...e.dataTransfer.files].slice(0, multiple ? 50 : 1).forEach(onFile);
      }}
    >
      <Icon name="upload" size={22} />
      <div style={{ marginTop: 6 }}>{label}</div>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { [...(e.target.files || [])].forEach(onFile); e.target.value = ''; }} />
    </div>
  );
}

export function Progress({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="progress">
      {parts.map((p, i) => <div key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="btn-group">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function useKey(handler: (e: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      handler(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
