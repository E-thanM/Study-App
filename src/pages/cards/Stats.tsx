import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/ui';
import { childDecks, deckPath, subtreeIds } from '../../lib/collection';
import { all, useVersion } from '../../lib/store';
import { CardState } from '../../lib/types';
import { DAY, dayNumber, dayStart, fmtHours, fmtInterval, startOfWeek } from '../../lib/util';

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const v = useVersion('card', 'revlog', 'deck');
  const [deckId, setDeckId] = useState(params.get('deck') || '');

  const data = useMemo(() => {
    const ids = deckId ? new Set(subtreeIds(deckId)) : null;
    const cards = all('card').filter((c) => !ids || ids.has(c.odid || c.deckId));
    const cardIds = new Set(cards.map((c) => c.id));
    const logs = all('revlog').filter((r) => !ids || cardIds.has(r.cardId) || ids.has(r.deckId));
    const today = dayNumber();
    const tStart = dayStart(today);

    // today
    const todayLogs = logs.filter((r) => r.review >= tStart);
    const todayTime = todayLogs.reduce((s, r) => s + r.timeMs, 0);
    const todayAgain = todayLogs.filter((r) => r.rating === 1).length;
    const todayReviewCorrect = todayLogs.filter((r) => r.state === CardState.Review && r.rating > 1).length;
    const todayReviewTotal = todayLogs.filter((r) => r.state === CardState.Review).length;

    // heatmap (52 weeks)
    const counts = new Map<number, number>();
    for (const r of logs) {
      const d = dayNumber(r.review);
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    const weeks = 53;
    const startDay = today - (weeks * 7 - 1) - ((new Date().getDay() + 6) % 7) + 6;
    const heat: { day: number; n: number }[] = [];
    for (let d = startDay; d <= today; d++) heat.push({ day: d, n: counts.get(d) || 0 });
    const maxHeat = Math.max(1, ...heat.map((h) => h.n));
    const daysStudied = heat.filter((h) => h.n).length;

    // forecast
    const fc = new Array(31).fill(0);
    for (const c of cards) {
      if (c.queue === 'suspended' || c.state === CardState.New) continue;
      const d = Math.max(0, dayNumber(c.due) - today);
      if (d <= 30) fc[d]++;
    }

    // counts
    let neu = 0, learn = 0, young = 0, mature = 0, susp = 0;
    for (const c of cards) {
      if (c.queue === 'suspended') susp++;
      else if (c.state === CardState.New) neu++;
      else if (c.state !== CardState.Review) learn++;
      else if (c.scheduledDays >= 21) mature++;
      else young++;
    }

    // retention (last 30 days)
    const since = dayStart(today - 29);
    let yP = 0, yT = 0, mP = 0, mT = 0;
    for (const r of logs) {
      if (r.review < since || r.state !== CardState.Review) continue;
      if (r.lastInterval >= 21) { mT++; if (r.rating > 1) mP++; } else { yT++; if (r.rating > 1) yP++; }
    }
    const totalTime = logs.reduce((s, r) => s + r.timeMs, 0);
    return { cards, logs, todayLogs, todayTime, todayAgain, todayReviewCorrect, todayReviewTotal, heat, maxHeat, daysStudied, fc, neu, learn, young, mature, susp, yP, yT, mP, mT, totalTime };
  }, [deckId, v]);

  const perDeck = useMemo(() => {
    const weekStart = startOfWeek().getTime();
    const logs = all('revlog');
    const cards = all('card');
    return childDecks(null).filter((d) => !d.filtered).map((d) => {
      const ids = new Set(subtreeIds(d.id));
      const dl = logs.filter((r) => ids.has(r.deckId));
      const dc = cards.filter((c) => ids.has(c.odid || c.deckId));
      const nextDue = Math.min(...dc.filter((c) => c.state !== CardState.New && c.queue !== 'suspended').map((c) => c.due));
      return {
        deck: d,
        cards: dc.length,
        reviews: dl.length,
        time: dl.reduce((s, r) => s + r.timeMs, 0),
        week: dl.filter((r) => r.review >= weekStart).reduce((s, r) => s + r.timeMs, 0),
        nextDue,
        children: childDecks(d.id).map((k) => {
          const kids = new Set(subtreeIds(k.id));
          const kl = logs.filter((r) => kids.has(r.deckId));
          return { deck: k, reviews: kl.length, time: kl.reduce((s, r) => s + r.timeMs, 0) };
        }),
      };
    });
  }, [v]);

  const maxFc = Math.max(1, ...data.fc);
  const heatColor = (n: number) => {
    if (!n) return 'var(--line)';
    const t = Math.min(1, n / data.maxHeat);
    return `color-mix(in srgb, var(--good) ${Math.round(25 + t * 75)}%, var(--surface))`;
  };
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Stats' }]} />
      <div className="page-head">
        <h1>Statistics</h1>
        <select value={deckId} onChange={(e) => { setDeckId(e.target.value); setParams(e.target.value ? { deck: e.target.value } : {}); }} style={{ width: 'auto', maxWidth: '100%' }}>
          <option value="">Whole collection</option>
          {all('deck').map((d) => ({ d, p: deckPath(d) })).sort((a, b) => a.p.localeCompare(b.p)).map(({ d, p }) => <option key={d.id} value={d.id}>{p}</option>)}
        </select>
      </div>

      <div className="grid-3">
        <div className="panel pad">
          <h3>Today</h3>
          <div className="kv mt">
            <span>Cards studied</span><span>{data.todayLogs.length}</span>
            <span>Time</span><span>{fmtHours(data.todayTime)}</span>
            <span>Again</span><span>{data.todayAgain}</span>
            <span>Review accuracy</span><span>{pct(data.todayReviewCorrect, data.todayReviewTotal)}</span>
          </div>
        </div>
        <div className="panel pad">
          <h3>Cards</h3>
          <div className="kv mt">
            <span className="n-new">New</span><span>{data.neu}</span>
            <span className="n-learn">Learning</span><span>{data.learn}</span>
            <span>Young (&lt;21d)</span><span>{data.young}</span>
            <span className="n-review">Mature</span><span>{data.mature}</span>
            <span>Suspended</span><span>{data.susp}</span>
          </div>
        </div>
        <div className="panel pad">
          <h3>True retention · 30 days</h3>
          <div className="kv mt">
            <span>Young cards</span><span>{pct(data.yP, data.yT)}</span>
            <span>Mature cards</span><span>{pct(data.mP, data.mT)}</span>
            <span>Total reviews</span><span>{data.logs.length}</span>
            <span>Total time</span><span>{fmtHours(data.totalTime)}</span>
          </div>
        </div>
      </div>

      <div className="section-title">Reviews · last year <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· studied on {data.daysStudied} days</span></div>
      <div className="panel pad">
        <div className="heatmap">
          {data.heat.map((h) => <i key={h.day} style={{ background: heatColor(h.n) }} title={`${new Date(h.day * DAY).toLocaleDateString('en-GB')}: ${h.n} reviews`} />)}
        </div>
      </div>

      <div className="section-title">Forecast · reviews due in the next 30 days</div>
      <div className="panel pad">
        <div className="bars">
          {data.fc.map((n, i) => <div key={i} style={{ height: `${(n / maxFc) * 100}%`, opacity: i === 0 ? 1 : 0.75 }} title={`${i === 0 ? 'Today (incl. overdue)' : `In ${i} days`}: ${n}`} />)}
        </div>
        <div className="row between tiny faint" style={{ marginTop: 6 }}><span>Today</span><span>+15d</span><span>+30d</span></div>
      </div>

      <div className="section-title">Time spent by deck</div>
      <div className="panel" style={{ overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Deck</th><th>Cards</th><th>Reviews</th><th>Time (total)</th><th>This week</th><th>Next review</th></tr></thead>
          <tbody>
            {perDeck.map((r) => (
              <Fragment key={r.deck.id}>
                <tr>
                  <td><Link to={`/cards/deck/${r.deck.id}`}><b>{r.deck.name}</b></Link></td>
                  <td>{r.cards}</td>
                  <td>{r.reviews}</td>
                  <td className="nowrap">{fmtHours(r.time, true)}</td>
                  <td className="nowrap">{fmtHours(r.week, true)}</td>
                  <td className="nowrap">{Number.isFinite(r.nextDue) ? (r.nextDue <= Date.now() ? 'due now' : `in ${fmtInterval(r.nextDue - Date.now())}`) : '–'}</td>
                </tr>
                {r.children.filter((k) => k.reviews).map((k) => (
                  <tr key={k.deck.id}>
                    <td style={{ paddingLeft: 28 }} className="muted">{k.deck.name}</td>
                    <td></td>
                    <td className="muted">{k.reviews}</td>
                    <td className="muted nowrap">{fmtHours(k.time, true)}</td>
                    <td></td><td></td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {!perDeck.length && <tr><td colSpan={6} className="muted">No decks yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
