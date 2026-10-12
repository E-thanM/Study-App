import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Progress, TopBar } from '../../components/ui';
import { all, useAll } from '../../lib/store';
import type { StudySet } from '../../lib/types';
import { StarterSetsModal } from './StarterSets';

export function SetList() {
  const sets = useAll('set');
  useAll('setprogress');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [starterOpen, setStarterOpen] = useState(false);
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sets) if (s.folder) m.set(s.folder, (m.get(s.folder) || 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [sets]);
  const searching = q.trim().length > 0;
  const shown = sets
    .filter((s) => (!folder || s.folder === folder) && (!searching || (s.title + ' ' + s.description + ' ' + s.folder).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.lastStudied || 0) - (a.lastStudied || 0) || a.createdAt - b.createdAt);

  // grouped by subject unless the list is filtered/searched
  const groups = useMemo(() => {
    const m = new Map<string, StudySet[]>();
    for (const s of shown) m.set(s.folder || 'Other', [...(m.get(s.folder || 'Other') || []), s]);
    return [...m].sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : a[0].localeCompare(b[0])));
  }, [shown]);
  const recent = !folder && !searching ? sets.filter((s) => s.lastStudied).sort((a, b) => b.lastStudied! - a.lastStudied!).slice(0, 3) : [];

  const card = (s: StudySet) => {
    const prog = all('setprogress').find((p) => p.setId === s.id);
    const levels = s.terms.map((t) => prog?.terms[t.id]?.level || 0);
    const mastered = levels.filter((l) => l >= 3).length;
    const learning = levels.filter((l) => l > 0 && l < 3).length;
    return (
      <Link key={s.id} to={`/quick/${s.id}`} className="panel pad col" style={{ gap: 10 }}>
        <div className="row between">
          <span className="pill">{s.terms.length} terms</span>
          {s.folder && (folder || searching || recent.length) ? <span className="muted tiny ellipsis">{s.folder}</span> : null}
        </div>
        <h3 style={{ overflowWrap: 'anywhere' }}>{s.title || 'Untitled set'}</h3>
        {s.description && !s.id.startsWith('starter-set:') && <p className="muted small ellipsis">{s.description}</p>}
        <Progress parts={[{ value: mastered, color: 'var(--good)' }, { value: learning, color: 'var(--warn)' }, { value: s.terms.length - mastered - learning, color: 'transparent' }]} />
        <div className="tiny muted">{mastered} mastered · {learning} learning{s.convertedDeckId ? ' · in long-term deck' : ''}</div>
      </Link>
    );
  };

  return (
    <>
      <TopBar crumbs={[{ label: 'Quick Learn' }]} />
      <div className="page-head">
        <div>
          <h1>Quick Learn</h1>
          <div className="sub">Cram for a test tomorrow – then convert to long-term flashcards so it sticks.</div>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => setStarterOpen(true)}><Icon name="sparkle" /> GCSE topic sets</button>
          <Link to="/quick/new" className="btn primary"><Icon name="plus" /> New set</Link>
        </div>
      </div>
      {sets.length > 0 && (
        <div className="col mb" style={{ gap: 10 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets" style={{ maxWidth: 360 }} />
          {folderCounts.length > 0 && (
            <div className="pill-scroll">
              <button className={`btn sm ${!folder ? 'primary' : ''}`} onClick={() => setFolder('')}>All</button>
              {folderCounts.map(([f, n]) => <button key={f} className={`btn sm ${folder === f ? 'primary' : ''}`} onClick={() => setFolder(f)}>{f} <span className="faint">{n}</span></button>)}
            </div>
          )}
        </div>
      )}
      {!sets.length ? (
        <div className="panel pad">
          <div className="empty">
            <h3>No sets yet</h3>
            <p>Add a ready-made set for every GCSE topic, or create your own by typing terms, pasting from Quizlet, or importing a file.</p>
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
              <button className="btn primary" onClick={() => setStarterOpen(true)}><Icon name="sparkle" /> Add GCSE topic sets</button>
              <Link to="/quick/new" className="btn"><Icon name="plus" /> Create a set</Link>
            </div>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">No sets match.</div>
      ) : (
        <div className="col" style={{ gap: 26 }}>
          {recent.length > 0 && (
            <section>
              <div className="section-title" style={{ marginTop: 0 }}>Recently studied</div>
              <div className="grid-3">{recent.map(card)}</div>
            </section>
          )}
          {groups.map(([name, list]) => (
            <section key={name}>
              {(groups.length > 1 || recent.length > 0) && <div className="section-title" style={{ marginTop: 0 }}>{name} · {list.length}</div>}
              <div className="grid-3">{list.map(card)}</div>
            </section>
          ))}
        </div>
      )}
      {starterOpen && <StarterSetsModal onClose={() => setStarterOpen(false)} />}
    </>
  );
}
