import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Seg, TopBar } from '../../components/ui';
import { subjectStrengths, type TopicStrength } from '../../lib/strength';
import { useAll } from '../../lib/store';
import { download } from '../../lib/util';
import './tools.css';

const LABEL = ['', 'Weak', 'Shaky', 'OK', 'Good', 'Strong'];
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);

export function Dots({ n }: { n: number }) {
  return (
    <span className={`conf conf-${n}`} title={`${n}/5 – ${LABEL[n]}`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
      <b>{n}</b>
    </span>
  );
}

/** Strongest and weakest topics in every subject, rated 1–5 from flashcard history. */
export function StrengthsPage() {
  const decks = useAll('deck');
  const cards = useAll('card');
  const logs = useAll('revlog');
  const blurts = useAll('blurt');
  const [sort, setSort] = useState<'weak' | 'order'>('weak');
  const subjects = useMemo(() => subjectStrengths(decks, cards, logs), [decks, cards, logs]);
  const lastBlurt = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of [...blurts].sort((a, c) => a.date - c.date)) m.set(`${b.subject}|${b.topic}`.toLowerCase(), Math.round(((b.covered || 0) / Math.max(1, b.total || 1)) * 100));
    return m;
  }, [blurts]);
  const started = subjects.flatMap((s) => s.topics.map((t) => ({ ...t, subject: s.name }))).filter((t) => t.studied > 0);
  const weakest = [...started].sort((a, b) => a.score - b.score).slice(0, 5);
  const strongest = [...started].sort((a, b) => b.score - a.score).slice(0, 5);

  // weakest started topics first, then the ones not started yet
  const order = (ts: TopicStrength[]) => (sort === 'weak' ? [...ts].sort((a, b) => Number(!a.studied) - Number(!b.studied) || a.score - b.score) : ts);
  const exportCsv = () => {
    const rows = [['Subject', 'Topic', 'Confidence (1-5)', 'Cards studied', 'Cards total', 'Predicted recall', 'Accuracy (30 days)', 'Reviews (30 days)']];
    for (const s of subjects) for (const t of s.topics) rows.push([s.name, t.name, String(t.confidence), String(t.studied), String(t.total), pct(t.recall), pct(t.accuracy), String(t.reviews30)]);
    download(`topic-confidence-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Strengths & weaknesses' }]} />
      <div className="page-head">
        <div>
          <h1>Strengths &amp; weaknesses</h1>
          <div className="sub">Confidence 1–5 for every topic, worked out from your flashcards: how much of the topic you've studied, how likely you are to remember it now, and how often you've got it right in the last 30 days.</div>
        </div>
        <div className="row wrap">
          <Seg value={sort} onChange={setSort} options={[{ value: 'weak', label: 'Weakest first' }, { value: 'order', label: 'Spec order' }]} />
          <button className="btn" onClick={exportCsv} disabled={!subjects.length}>Export CSV</button>
        </div>
      </div>

      {!subjects.length ? (
        <div className="panel pad empty">Add some flashcards and review them – your topic ratings appear here.</div>
      ) : (
        <>
          {started.length > 0 && (
            <div className="blurt-grid mb">
              <section className="panel">
                <div className="panel-head"><h3>Weakest topics</h3></div>
                <div className="list">{weakest.map((t) => <Link key={t.deckId} to={`/cards/deck/${t.deckId}`} className="list-row link"><span className="grow ellipsis small"><b>{t.subject}</b> · {t.name}</span><Dots n={t.confidence} /></Link>)}</div>
              </section>
              <section className="panel">
                <div className="panel-head"><h3>Strongest topics</h3></div>
                <div className="list">{strongest.map((t) => <Link key={t.deckId} to={`/cards/deck/${t.deckId}`} className="list-row link"><span className="grow ellipsis small"><b>{t.subject}</b> · {t.name}</span><Dots n={t.confidence} /></Link>)}</div>
              </section>
            </div>
          )}
          <div className="col" style={{ gap: 18 }}>
            {subjects.map((s) => (
              <section key={s.deckId} className="panel">
                <div className="panel-head">
                  <h3>{s.name}</h3>
                  <span className="row" style={{ gap: 8 }}><span className="muted small hide-sm">{s.overall.studied}/{s.overall.total} cards studied</span><Dots n={s.overall.confidence} /></span>
                </div>
                <div className="strength-scroll">
                  <table className="tbl strength-tbl">
                    <thead><tr><th>Topic</th><th>Confidence</th><th className="num">Studied</th><th className="num">Recall</th><th className="num hide-sm">Accuracy</th><th className="num hide-sm">Blurt</th></tr></thead>
                    <tbody>
                      {order(s.topics).map((t) => (
                        <tr key={t.deckId}>
                          <td><Link to={`/cards/deck/${t.deckId}`}>{t.name}</Link>{!t.studied && <span className="faint tiny"> · not started</span>}</td>
                          <td><Dots n={t.confidence} /></td>
                          <td className="num">{Math.round((t.studied / Math.max(1, t.total)) * 100)}%<span className="faint tiny"> of {t.total}</span></td>
                          <td className="num">{pct(t.recall)}</td>
                          <td className="num hide-sm">{pct(t.accuracy)}</td>
                          <td className="num hide-sm">{lastBlurt.has(`${s.name}|${t.name}`.toLowerCase()) ? `${lastBlurt.get(`${s.name}|${t.name}`.toLowerCase())}%` : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
          <p className="muted tiny mt">
            <b>How it's rated:</b> 5 Strong ≥ 85 · 4 Good ≥ 70 · 3 OK ≥ 50 · 2 Shaky ≥ 30 · 1 Weak or not started. The score is √(share of cards studied) × memory, where memory blends predicted recall now (60%) with your last-30-day accuracy (40%). Recall = chance you'd remember a studied card today; Blurt = your latest blurt on that topic.
          </p>
        </>
      )}
    </>
  );
}
