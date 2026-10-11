import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, MenuButton, Progress, TopBar, toast } from '../../components/ui';
import { buildQueue, childDecks, deckPath, deckTotals, emptyFiltered, rebuildFiltered, subtreeIds, unburyDeck } from '../../lib/collection';
import { compileSearch } from '../../lib/search';
import { getPreset } from '../../lib/seed';
import { all, get, patch, useVersion } from '../../lib/store';
import { CardState } from '../../lib/types';
import { dayNumber, fmtHours, fmtInterval } from '../../lib/util';
import { DeckOptions } from './DeckOptions';
import { FilteredDeckModal } from './DeckList';

export function DeckOverview() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const v = useVersion('deck', 'card', 'revlog', 'preset');
  const deck = get('deck', id);
  const [opts, setOpts] = useState(false);
  const [custom, setCustom] = useState(false);
  const [editDesc, setEditDesc] = useState(false);

  const info = useMemo(() => {
    if (!deck) return null;
    const q = buildQueue(id);
    const ids = new Set(subtreeIds(id));
    const cards = all('card').filter((c) => ids.has(c.deckId));
    let neu = 0, learning = 0, young = 0, mature = 0, suspended = 0, buried = 0;
    let nextDue = Infinity;
    const today = dayNumber();
    for (const c of cards) {
      if (c.queue === 'suspended') { suspended++; continue; }
      if ((c.queue === 'buried' || c.queue === 'userBuried') && (c.buriedDay ?? today) >= today) buried++;
      if (c.state === CardState.New) neu++;
      else if (c.state !== CardState.Review) learning++;
      else if (c.scheduledDays >= 21) mature++;
      else young++;
      if (c.state !== CardState.New && c.due > Date.now()) nextDue = Math.min(nextDue, c.due);
    }
    return { q, total: cards.length, neu, learning, young, mature, suspended, buried, nextDue, totals: deckTotals(id) };
  }, [deck, id, v]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deck || !info) return <><TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, { label: 'Not found' }]} /><div className="empty">Deck not found.</div></>;

  const path = deckPath(deck).split('::');
  const counts = { new: info.q.new.length, learn: info.q.learnNow.length + info.q.learnAhead.length + info.q.learnLater, review: info.q.review.length };
  const anyNow = counts.new + info.q.learnNow.length + info.q.learnAhead.length + counts.review > 0;
  const preset = getPreset(deck.presetId);
  const kids = childDecks(id);

  return (
    <>
      <TopBar crumbs={[{ to: '/cards', label: 'Flashcards' }, ...path.slice(0, -1).map((p) => ({ label: p })), { label: deck.name }]} />
      <div style={{ maxWidth: 640, margin: '24px auto 0' }}>
        <div className="panel pad center col" style={{ gap: 18, padding: 32 }}>
          <div>
            <div className="muted small">{deck.filtered ? 'Filtered deck' : path.length > 1 ? path.slice(0, -1).join(' › ') : 'Deck'}</div>
            <h1 style={{ marginTop: 2 }}>{deck.name}</h1>
          </div>
          {anyNow || counts.learn ? (
            <>
              <div className="row" style={{ justifyContent: 'center', gap: 28 }}>
                <div><div className="muted small">New</div><div className="n-new" style={{ fontSize: 30 }}>{counts.new}</div></div>
                <div><div className="muted small">Learning</div><div className="n-learn" style={{ fontSize: 30 }}>{counts.learn}</div></div>
                <div><div className="muted small">To review</div><div className="n-review" style={{ fontSize: 30 }}>{counts.review}</div></div>
              </div>
              {anyNow ? (
                <button className="btn primary lg" style={{ minWidth: 200, alignSelf: 'center' }} onClick={() => nav(`/cards/review/${id}`)} autoFocus>Study now</button>
              ) : (
                <div className="muted">Learning cards will be ready in {fmtInterval(Math.max(0, Math.min(...all('card').filter((c) => subtreeIds(id).includes(c.deckId) && (c.state === CardState.Learning || c.state === CardState.Relearning)).map((c) => c.due)) - Date.now()))}.</div>
              )}
            </>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              <div style={{ fontSize: 34 }}>🎉</div>
              <h3>Congratulations! You've finished this deck for now.</h3>
              <p className="muted small">
                {info.nextDue < Infinity ? `Next card due in ${fmtInterval(info.nextDue - Date.now())}.` : info.total ? 'Nothing scheduled.' : 'This deck is empty.'}
                {info.neu > 0 && ` ${info.neu} new cards waiting (limit ${preset.newPerDay}/day).`}
              </p>
              <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {!deck.filtered && <button className="btn" onClick={() => setCustom(true)}>Custom study</button>}
                {info.buried > 0 && <button className="btn" onClick={() => { unburyDeck(id); toast('Unburied'); }}>Unbury {info.buried}</button>}
                {info.total === 0 && <Link className="btn primary" to={`/cards/add?deck=${id}`}>Add cards</Link>}
              </div>
            </div>
          )}

          {editDesc ? (
            <textarea defaultValue={deck.description || ''} autoFocus onBlur={(e) => { patch('deck', id, { description: e.target.value }); setEditDesc(false); }} placeholder="Description – e.g. specification points, exam board…" />
          ) : deck.description ? (
            <p className="muted small" style={{ whiteSpace: 'pre-wrap', cursor: 'text' }} onClick={() => setEditDesc(true)}>{deck.description}</p>
          ) : null}

          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={`/cards/add?deck=${id}`} className="btn sm"><Icon name="plus" /> Add</Link>
            <Link to={`/cards/browse?q=${encodeURIComponent(`deck:"${deckPath(deck)}"`)}`} className="btn sm"><Icon name="browse" /> Browse</Link>
            {deck.filtered ? (
              <>
                <button className="btn sm" onClick={() => { const n = rebuildFiltered(id, compileSearch(deck.filtered!.search)); toast(`${n} cards gathered`); }}><Icon name="sync" /> Rebuild</button>
                <button className="btn sm" onClick={() => emptyFiltered(id)}>Empty</button>
                <button className="btn sm" onClick={() => setCustom(true)}><Icon name="search" /> Edit</button>
              </>
            ) : (
              <>
                <button className="btn sm" onClick={() => setOpts(true)}><Icon name="settings" /> Options</button>
                <MenuButton className="btn sm" label={<>More</>} items={[
                  { label: 'Custom study session', icon: 'search', onClick: () => setCustom(true) },
                  { label: 'Edit description', icon: 'edit', onClick: () => setEditDesc(true) },
                  { label: 'Unbury', icon: 'undo', onClick: () => { unburyDeck(id); toast('Unburied'); } },
                  { label: 'Stats', icon: 'stats', onClick: () => nav(`/cards/stats?deck=${id}`) },
                ]} />
              </>
            )}
          </div>
        </div>

        {info.total > 0 && (
          <div className="panel pad mt">
            <div className="row between small" style={{ marginBottom: 8 }}>
              <b>{info.total} cards</b>
              <span className="muted">{preset.algorithm === 'fsrs' ? `FSRS · ${Math.round(preset.desiredRetention * 100)}% retention` : 'SM-2'} · {preset.name}</span>
            </div>
            <Progress parts={[
              { value: info.mature, color: 'var(--good)' },
              { value: info.young, color: 'color-mix(in srgb, var(--good) 45%, transparent)' },
              { value: info.learning, color: 'var(--bad)' },
              { value: info.neu, color: 'var(--accent)' },
              { value: info.suspended, color: 'var(--warn)' },
            ]} />
            <div className="row wrap small muted" style={{ marginTop: 8, gap: 14 }}>
              <span><span className="dot" style={{ background: 'var(--good)' }} /> Mature {info.mature}</span>
              <span><span className="dot" style={{ background: 'color-mix(in srgb, var(--good) 45%, transparent)' }} /> Young {info.young}</span>
              <span><span className="dot" style={{ background: 'var(--bad)' }} /> Learning {info.learning}</span>
              <span><span className="dot" style={{ background: 'var(--accent)' }} /> New {info.neu}</span>
              {info.suspended > 0 && <span><span className="dot" style={{ background: 'var(--warn)' }} /> Suspended {info.suspended}</span>}
            </div>
            <hr />
            <div className="kv">
              <span>Reviews done (cycles)</span><span>{info.totals.reviews}</span>
              <span>Average reviews per card</span><span>{info.total ? (info.totals.reviews / info.total).toFixed(1) : '0'}</span>
              <span>Time spent on this deck</span><span>{fmtHours(info.totals.ms)}</span>
              <span>Next recommended review</span><span>{info.nextDue < Infinity ? (info.nextDue <= Date.now() ? 'now' : `${new Date(info.nextDue).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (in ${fmtInterval(info.nextDue - Date.now())})`) : '–'}</span>
            </div>
          </div>
        )}

        {kids.length > 0 && (
          <div className="panel mt list">
            {kids.map((k) => (
              <Link key={k.id} to={`/cards/deck/${k.id}`} className="list-row link">
                <Icon name="folder" size={16} className="faint" />
                <span className="grow">{k.name}</span>
                <Icon name="chevron" size={16} className="faint" />
              </Link>
            ))}
          </div>
        )}
      </div>
      {opts && <DeckOptions deckId={id} onClose={() => setOpts(false)} />}
      {custom && <FilteredDeckModal deck={deck.filtered ? deck : undefined} initialSearch={deck.filtered ? undefined : `deck:"${deckPath(deck)}"`} onClose={() => setCustom(false)} />}
    </>
  );
}
