import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, MenuButton, Modal, Progress, TopBar, toast, useKey } from '../../components/ui';
import {
  MASTERED, STAGES, checkQuote, cueParts, extractQuotes, hashText, isDue, nextStage, pickSession, statusOf,
  type BuiltinQuote, type CheckResult, type CuePart,
} from '../../lib/quotes';
import { parseStarter } from '../../lib/starter';
import { get, patch, put, remove, useAll } from '../../lib/store';
import type { Quote } from '../../lib/types';
import { isoDate, plural, uid } from '../../lib/util';
import './quotes.css';

const CRUMBS = [{ to: '/tools', label: 'Revision tools' }, { label: 'Quote learner' }];
const SESSION_SIZE = 10;
const WORK_ORDER = ['Macbeth', 'An Inspector Calls', 'Of Mice and Men'];

/** A quote as shown on the page: a built-in one (maybe not started yet) or a saved record. */
interface Item { id: string; work: string; text: string; source: string; rec?: Quote; custom: boolean }

/* ───────── built-in quotes (loaded once, only the English Lit file) ───────── */

let builtinCache: Promise<BuiltinQuote[]> | null = null;
function loadBuiltins(): Promise<BuiltinQuote[]> {
  builtinCache ||= import('../../content/englishlit.txt?raw')
    .then((m) => extractQuotes(parseStarter('englishlit', m.default).notes))
    .catch(() => {
      builtinCache = null;
      return [];
    });
  return builtinCache;
}

function useItems(): { items: Item[]; loading: boolean } {
  const recs = useAll('quote');
  const [builtins, setBuiltins] = useState<BuiltinQuote[] | null>(null);
  useEffect(() => {
    let live = true;
    loadBuiltins().then((b) => live && setBuiltins(b));
    return () => { live = false; };
  }, []);
  const items = useMemo(() => {
    const byId = new Map(recs.map((r) => [r.id, r]));
    const out: Item[] = (builtins || []).map((b) => {
      const rec = byId.get(b.id);
      byId.delete(b.id);
      return { ...b, rec, custom: false };
    });
    // the student's own quotes (and any saved built-in that is no longer in the starter file)
    for (const r of byId.values()) out.push({ id: r.id, work: r.work, text: r.text, source: r.source, rec: r, custom: !!r.custom });
    return out;
  }, [recs, builtins]);
  return { items, loading: !builtins };
}

const sortWorks = (works: string[]) =>
  [...new Set(works)].sort((a, b) => {
    const ia = WORK_ORDER.indexOf(a), ib = WORK_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

/** Records are only created when a quote is first practised, with an id derived from its text. */
function ensureRec(it: Item): Quote {
  const cur = get('quote', it.id);
  if (cur) return cur;
  const rec: Quote = { id: it.id, kind: 'quote', updatedAt: Date.now(), work: it.work, text: it.text, source: it.source, stage: 0, correct: 0, wrong: 0 };
  put(rec);
  return rec;
}

const stageLabel = (q: Quote | undefined) => (statusOf(q) === 'new' ? 'New' : STAGES[Math.min(q!.stage, MASTERED)]);
const stagePill = (q: Quote | undefined) => {
  const s = statusOf(q);
  return <span className={`pill ${s === 'mastered' ? 'good' : s === 'learning' ? 'warn' : ''}`}>{stageLabel(q)}</span>;
};

/* ───────── page ───────── */

export function QuotesPage() {
  const { items, loading } = useItems();
  const [session, setSession] = useState<{ ids: string[]; work: string | null; key: number } | null>(null);

  const start = (pool: Item[], work: string | null) => {
    const ids = pickSession(pool.map((it) => ({ id: it.id, stage: it.rec?.stage || 0, last: it.rec?.last, isNew: statusOf(it.rec) === 'new' })), SESSION_SIZE);
    if (!ids.length) return toast('No quotes to practise yet');
    ids.forEach((id) => ensureRec(pool.find((it) => it.id === id)!));
    setSession({ ids, work, key: Date.now() });
    window.scrollTo(0, 0);
  };

  if (session) {
    return (
      <Practice
        key={session.key}
        ids={session.ids}
        title={session.work || 'Quotes'}
        onExit={() => { setSession(null); window.scrollTo(0, 0); }}
        onAgain={() => start(session.work ? items.filter((it) => it.work === session.work) : items.filter((it) => session.ids.includes(it.id)), session.work)}
      />
    );
  }
  return <Overview items={items} loading={loading} onLearn={start} />;
}

/* ───────── overview ───────── */

function Overview({ items, loading, onLearn }: { items: Item[]; loading: boolean; onLearn: (pool: Item[], work: string | null) => void }) {
  const [q, setQ] = useState('');
  const [workFilter, setWorkFilter] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const works = sortWorks(items.map((it) => it.work));
  const today = isoDate();
  const todayCount = items.reduce((s, it) => s + (it.rec?.history?.[today] || 0), 0);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((it) => (!workFilter || it.work === workFilter) && (!needle || `${it.text} ${it.source} ${it.work}`.toLowerCase().includes(needle)));
  const groups = sortWorks(shown.map((it) => it.work)).map((w) => [w, shown.filter((it) => it.work === w)] as const);

  const del = (it: Item) => {
    const rec = it.rec;
    if (!rec || !confirm('Delete this quote?')) return;
    remove('quote', rec.id);
    toast('Quote deleted', { label: 'Undo', fn: () => put({ ...rec, deleted: false }) });
  };

  return (
    <>
      <TopBar crumbs={CRUMBS} />
      <div className="page-head">
        <div>
          <h1>Quote learner</h1>
          <div className="sub">Learn key quotes word-perfect: read it, then first letters, then half the words, then from memory.</div>
        </div>
        <div className="row">
          {todayCount > 0 && <span className="pill accent">{plural(todayCount, 'attempt')} today</span>}
          <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" /> Add quote</button>
        </div>
      </div>

      {loading && !items.length ? (
        <div className="empty"><span className="spinner" /></div>
      ) : (
        <div className="qt-works">
          {works.map((w) => {
            const list = items.filter((it) => it.work === w);
            const mastered = list.filter((it) => statusOf(it.rec) === 'mastered').length;
            const learning = list.filter((it) => statusOf(it.rec) === 'learning').length;
            const due = list.filter((it) => it.rec && isDue(it.rec)).length;
            return (
              <div key={w} className="panel pad col qt-work">
                <div className="row between">
                  <h3 className="grow" style={{ overflowWrap: 'anywhere' }}>{w}</h3>
                  <span className="pill">{plural(list.length, 'quote')}</span>
                </div>
                <Progress parts={[{ value: mastered, color: 'var(--good)' }, { value: learning, color: 'var(--warn)' }, { value: list.length - mastered - learning, color: 'var(--line)' }]} />
                <div className="tiny muted">
                  {mastered} mastered · {learning} learning · {list.length - mastered - learning} new{due ? <> · <b style={{ color: 'var(--accent)' }}>{due} to review</b></> : null}
                </div>
                <button className="btn primary qt-learn" onClick={() => onLearn(list, w)}><Icon name="learn" /> Learn</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="qt-toolbar">
        <div className="qt-search">
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search quotes, characters…" aria-label="Search quotes" />
        </div>
        <select value={workFilter} onChange={(e) => setWorkFilter(e.target.value)} aria-label="Work">
          <option value="">All texts</option>
          {works.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      {!shown.length && !loading && <div className="empty">{needle ? 'No quotes match your search.' : 'No quotes yet – add your own.'}</div>}
      {groups.map(([w, list]) => (
        <section key={w}>
          <div className="section-title">{w}</div>
          <div className="panel list">
            {list.map((it) => (
              <div key={it.id} className="list-row qt-row">
                <div className="grow col" style={{ gap: 4 }}>
                  <div className="qt-row-text">“{it.text}”</div>
                  <div className="row wrap tiny muted" style={{ gap: 6 }}>
                    {stagePill(it.rec)}
                    {it.custom && <span className="pill accent">Yours</span>}
                    <span>{it.source}</span>
                  </div>
                </div>
                <div className="row qt-row-actions">
                  <button className="btn ghost icon" onClick={() => onLearn([it], null)} aria-label="Practise this quote" title="Practise this quote"><Icon name="bolt" /></button>
                  {it.custom && (
                    <MenuButton className="btn ghost icon" items={[
                      { label: 'Edit', icon: 'edit', onClick: () => setEditing(it) },
                      { label: 'Delete', icon: 'trash', danger: true, onClick: () => del(it) },
                    ]} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && <QuoteEditor item={editing === 'new' ? null : editing} works={works} defaultWork={workFilter || works[0] || ''} onClose={() => setEditing(null)} />}
    </>
  );
}

function QuoteEditor({ item, works, defaultWork, onClose }: { item: Item | null; works: string[]; defaultWork: string; onClose: () => void }) {
  const [work, setWork] = useState(item?.work ?? defaultWork);
  const [text, setText] = useState(item?.text ?? '');
  const [source, setSource] = useState(item?.source ?? '');
  const save = () => {
    // quote marks typed around the quote aren't part of it
    const t = text.trim().replace(/^["“”']+|["“”']+$/g, '').trim();
    if (!work.trim() || !t) return toast('Add the text and the quote');
    if (item?.rec) patch('quote', item.rec.id, { work: work.trim(), text: t, source: source.trim() });
    else put({ id: `quote-c-${hashText(uid())}`, kind: 'quote', work: work.trim(), text: t, source: source.trim(), stage: 0, correct: 0, wrong: 0, custom: true });
    toast(item ? 'Quote saved' : 'Quote added');
    onClose();
  };
  return (
    <Modal title={item ? 'Edit quote' : 'Add a quote'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <label className="col" style={{ gap: 0 }}>
          <span className="field-label">Text (play, novel or poem)</span>
          <input type="text" list="qt-works" value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Macbeth" />
          <datalist id="qt-works">{works.map((w) => <option key={w} value={w} />)}</datalist>
        </label>
        <label className="col" style={{ gap: 0 }}>
          <span className="field-label">Quote</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the quote exactly – use / for a line break" rows={3} autoFocus />
        </label>
        <label className="col" style={{ gap: 0 }}>
          <span className="field-label">Who says it / where</span>
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Lady Macbeth, Act 1 Scene 5" />
        </label>
      </div>
    </Modal>
  );
}

/* ───────── practice session ───────── */

interface Track { start: number; right: number; wrong: number; left: number }

/** How many correct steps a quote gets this session: new quotes climb through the cues, others get one go. */
const stepsFor = (stage: number) => (stage === 0 ? 3 : stage < 3 ? 2 : 1);
const MAX_TRIES = 5;

function Practice({ ids, title, onExit, onAgain }: { ids: string[]; title: string; onExit: () => void; onAgain: () => void }) {
  useAll('quote');
  const [queue, setQueue] = useState<string[]>(ids);
  const [track, setTrack] = useState<Record<string, Track>>(() =>
    Object.fromEntries(ids.map((id) => { const s = get('quote', id)?.stage || 0; return [id, { start: s, right: 0, wrong: 0, left: stepsFor(s) }]; })),
  );
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<(CheckResult & { from: number; to: number }) | null>(null);
  const [hint, setHint] = useState(false);
  const [turn, setTurn] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const cur = get('quote', queue[0]);

  useEffect(() => { if (!result) input.current?.focus({ preventScroll: true }); }, [turn, result]);

  const record = (ok: boolean, res: CheckResult) => {
    if (!cur || result) return;
    const from = cur.stage;
    // a hint means a right answer only keeps the stage
    const to = ok && hint ? from : nextStage(from, ok);
    const day = isoDate();
    patch('quote', cur.id, {
      stage: to,
      correct: cur.correct + (ok ? 1 : 0),
      wrong: cur.wrong + (ok ? 0 : 1),
      last: Date.now(),
      history: { ...cur.history, [day]: (cur.history?.[day] || 0) + 1 },
    });
    setTrack((t) => {
      const x = t[cur.id];
      return { ...t, [cur.id]: { ...x, right: x.right + (ok ? 1 : 0), wrong: x.wrong + (ok ? 0 : 1), left: ok ? x.left - 1 : x.left } };
    });
    setResult({ ...res, ok, from, to });
  };

  const submit = () => {
    if (!cur) return;
    if (result) return advance();
    if (!typed.trim()) return;
    const res = checkQuote(typed, cur.text);
    record(res.ok, res);
  };

  const advance = () => {
    if (!cur || !result) return;
    const [head, ...rest] = queue;
    const t = track[head];
    const tries = t.right + t.wrong;
    let next = rest;
    // wrong → see it again soon at the easier cue; right with steps left → back later at the next cue
    if (!result.ok && tries < MAX_TRIES) next = [...rest.slice(0, 2), head, ...rest.slice(2)];
    else if (result.ok && t.left > 0 && result.to < MASTERED && tries < MAX_TRIES) next = [...rest.slice(0, 3), head, ...rest.slice(3)];
    setQueue(next);
    setTyped('');
    setResult(null);
    setHint(false);
    setTurn((n) => n + 1);
  };

  useKey((e) => {
    if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
    if (e.key === 'Enter' && result) { e.preventDefault(); advance(); }
  }, [result, queue, track]);

  const doneCount = ids.filter((id) => !queue.includes(id)).length;
  const crumbs = [CRUMBS[0], { to: '/tools/quotes', label: 'Quote learner' }, { label: title }];
  const exitBtn = <button className="btn ghost sm" onClick={onExit}>End</button>;

  if (!cur || !queue.length) {
    return (
      <>
        <TopBar crumbs={crumbs} />
        <Summary ids={ids} track={track} onExit={onExit} onAgain={onAgain} />
      </>
    );
  }

  const stage = cur.stage;
  // stage 4 reviews look like stage 3 (from memory); a hint shows the first letters
  const cueStage = hint ? 1 : Math.min(stage, 3);
  const parts = cueParts(cur.text, cueStage, Number.parseInt(hashText(cur.id + turn).slice(0, 6), 36));
  const instructions = [
    'Read the quote aloud, then type it out once.',
    'Type the quote – you get the first letter of each word.',
    'Fill in the whole quote – about half the words are hidden.',
    'Type the quote from memory.',
    'Review: type the quote from memory.',
  ][Math.min(stage, 4)];

  return (
    <>
      <TopBar crumbs={crumbs} right={exitBtn} />
      <div className="qt-practice">
        <div className="row between small muted" style={{ marginBottom: 6 }}>
          <span>{doneCount} of {ids.length} done</span>
          <span>{stageLabel(cur) === 'New' ? 'New quote' : `Stage: ${STAGES[Math.min(stage, MASTERED)]}`}</span>
        </div>
        <Progress parts={[{ value: doneCount, color: 'var(--good)' }, { value: ids.length - doneCount, color: 'var(--line)' }]} />

        <div className="q-card mt col qt-card">
          <div className="qt-stages" aria-label={`Stage ${stage + 1} of 5`}>
            {STAGES.map((s, i) => <i key={s} className={i < stage ? 'done' : i === stage ? 'on' : ''} title={s} />)}
          </div>
          <div className="muted small">{instructions}</div>
          <div className="qt-source"><b>{cur.source || 'Quote'}</b><span className="muted"> · {cur.work}</span></div>

          {(cueStage < 3 || result) && !(result && !result.ok) && (
            <Cue parts={result ? cueParts(cur.text, 0) : parts} />
          )}
          {cueStage >= 3 && !result && (
            <div className="qt-memory muted small">{plural(cur.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 'word')} · from memory</div>
          )}

          {!result ? (
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="col">
              <textarea
                ref={input}
                className="qt-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder={stage === 0 ? 'Type the quote out' : 'Type the whole quote'}
                rows={3}
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Your answer"
              />
              <div className="row between wrap qt-actions">
                {stage === 0 ? (
                  <button type="button" className="btn ghost" onClick={() => record(true, checkQuote(cur.text, cur.text))}>I said it aloud</button>
                ) : cueStage >= 2 && !hint ? (
                  <button type="button" className="btn ghost" onClick={() => setHint(true)}>Hint</button>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => record(false, checkQuote('', cur.text))}>Don't know</button>
                )}
                <button className="btn primary lg" type="submit" disabled={!typed.trim()}>Check <kbd className="qt-kbd">Enter</kbd></button>
              </div>
            </form>
          ) : (
            <Feedback result={result} text={cur.text} typed={typed} onNext={advance} />
          )}
        </div>
      </div>
    </>
  );
}

function Cue({ parts }: { parts: CuePart[] }) {
  return (
    <div className="qt-quote">
      {parts.map((p, i) => (
        <Fragment key={i}>
          <span className="qt-w">
            {p.pre}
            {p.show === 'full' ? p.word : p.show === 'initial' ? (
              <>{p.word.charAt(0)}<span className="qt-gap" style={{ width: `${Math.min(p.word.length - 1, 9) * 0.5}em` }} /></>
            ) : (
              <span className="qt-blank" style={{ width: `${Math.max(1.4, Math.min(p.word.length, 10) * 0.55)}em` }} />
            )}
            {p.post}
          </span>
          {i < parts.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </div>
  );
}

function Feedback({ result, text, typed, onNext }: { result: CheckResult & { from: number; to: number }; text: string; typed: string; onNext: () => void }) {
  // only show the word diff when the answer was roughly the right quote
  const showDiff = !!typed.trim() && result.diff.filter((d) => d.kind === 'ok').length * 3 >= result.diff.filter((d) => d.kind !== 'extra').length;
  const moved = result.to > result.from ? `Up to: ${STAGES[result.to]}` : result.to < result.from ? `Back to: ${STAGES[result.to]}` : result.ok ? `Stays at: ${STAGES[result.to]}` : `Stage: ${STAGES[result.to]}`;
  return (
    <div className="col" style={{ gap: 12 }}>
      {result.ok ? (
        <div className="feedback good">✓ Word-perfect! <span className="qt-move">{moved}</span></div>
      ) : (
        <>
          <div className="feedback bad">
            {showDiff ? `${plural(result.mistakes, 'mistake')} – every word has to be right.` : typed.trim() ? 'Not quite – here is the quote.' : 'Here it is – have another go soon.'} <span className="qt-move">{moved}</span>
          </div>
          {showDiff ? (
            <>
              <div className="qt-quote qt-diff">
                {result.diff.map((d, i) => (
                  <span key={i} className={`qt-d ${d.kind}`} title={d.kind === 'wrong' ? `You wrote “${d.typed}”` : d.kind}>
                    {d.kind === 'wrong' && <s className="qt-typed">{d.typed}</s>}
                    {d.word}
                  </span>
                ))}
              </div>
              <div className="qt-legend tiny muted">
                <span><i className="qt-d missed">word</i> missed</span>
                <span><i className="qt-d wrong">word</i> wrong</span>
                <span><i className="qt-d extra">word</i> not in the quote</span>
              </div>
            </>
          ) : (
            <>
              {typed.trim() && <div className="small muted qt-you">You wrote: <s>{typed}</s></div>}
              <div className="qt-quote">{text}</div>
            </>
          )}
        </>
      )}
      <button className="btn primary lg" onClick={onNext}>Continue <kbd className="qt-kbd">Enter</kbd></button>
    </div>
  );
}

function Summary({ ids, track, onExit, onAgain }: { ids: string[]; track: Record<string, Track>; onExit: () => void; onAgain: () => void }) {
  const recs = ids.map((id) => get('quote', id)).filter(Boolean) as Quote[];
  const firstTime = recs.filter((r) => track[r.id]?.wrong === 0 && track[r.id]?.right > 0).length;
  const up = recs.filter((r) => r.stage > (track[r.id]?.start ?? 0)).length;
  const nowMastered = recs.filter((r) => r.stage >= MASTERED).length;
  useKey((e) => { if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') onAgain(); }, [onAgain]);
  return (
    <div className="qt-practice">
      <div className="q-card col" style={{ gap: 16 }}>
        <div className="center col" style={{ gap: 6 }}>
          <div style={{ fontSize: 40 }}>{firstTime === recs.length ? '🏆' : '📜'}</div>
          <h2>Session complete</h2>
          <p className="muted">{firstTime} of {recs.length} word-perfect without a slip · {up} moved up · {nowMastered} mastered</p>
        </div>
        <div className="list">
          {recs.map((r) => {
            const t = track[r.id];
            return (
              <div key={r.id} className="list-row qt-sum-row">
                <div className="grow col" style={{ gap: 4 }}>
                  <div className="qt-row-text">“{r.text}”</div>
                  <div className="row wrap tiny muted" style={{ gap: 6 }}>
                    <span>{STAGES[Math.min(t.start, MASTERED)]}</span>
                    <span>→</span>
                    {stagePill(r)}
                    <span className="grow" />
                    <span style={{ color: 'var(--good)' }}>✓ {t.right}</span>
                    <span style={{ color: t.wrong ? 'var(--bad)' : undefined }}>✗ {t.wrong}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row qt-sum-actions">
          <button className="btn lg" onClick={onExit}>Back to quotes</button>
          <button className="btn primary lg" onClick={onAgain}>Keep going <kbd className="qt-kbd">Enter</kbd></button>
        </div>
      </div>
    </div>
  );
}
