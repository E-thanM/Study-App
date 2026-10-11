import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Progress, TopBar } from '../../components/ui';
import { all, useAll } from '../../lib/store';

export function SetList() {
  const sets = useAll('set');
  useAll('setprogress');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const folders = useMemo(() => [...new Set(sets.map((s) => s.folder).filter(Boolean))].sort(), [sets]);
  const shown = sets
    .filter((s) => (!folder || s.folder === folder) && (!q || (s.title + ' ' + s.description + ' ' + s.folder).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.lastStudied || b.createdAt) - (a.lastStudied || a.createdAt));

  return (
    <>
      <TopBar crumbs={[{ label: 'Quick Learn' }]} />
      <div className="page-head">
        <div>
          <h1>Quick Learn</h1>
          <div className="sub">Cram for a test tomorrow – then convert to long-term flashcards so it sticks.</div>
        </div>
        <Link to="/quick/new" className="btn primary"><Icon name="plus" /> New set</Link>
      </div>
      {sets.length > 0 && (
        <div className="row wrap mb">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets" style={{ maxWidth: 320 }} />
          {folders.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              <button className={`btn sm ${!folder ? 'primary' : ''}`} onClick={() => setFolder('')}>All</button>
              {folders.map((f) => <button key={f} className={`btn sm ${folder === f ? 'primary' : ''}`} onClick={() => setFolder(f)}><Icon name="folder" /> {f}</button>)}
            </div>
          )}
        </div>
      )}
      {!sets.length ? (
        <div className="panel pad">
          <div className="empty">
            <h3>No sets yet</h3>
            <p>Create a set by typing terms, pasting from Quizlet, or importing a file.</p>
            <Link to="/quick/new" className="btn primary mt"><Icon name="plus" /> Create a set</Link>
          </div>
        </div>
      ) : (
        <div className="grid-3">
          {shown.map((s) => {
            const prog = all('setprogress').find((p) => p.setId === s.id);
            const levels = s.terms.map((t) => prog?.terms[t.id]?.level || 0);
            const mastered = levels.filter((l) => l >= 3).length;
            const learning = levels.filter((l) => l > 0 && l < 3).length;
            return (
              <Link key={s.id} to={`/quick/${s.id}`} className="panel pad col" style={{ gap: 10 }}>
                <div className="row between">
                  <span className="pill">{s.terms.length} terms</span>
                  {s.folder && <span className="muted tiny ellipsis">{s.folder}</span>}
                </div>
                <h3 className="ellipsis">{s.title || 'Untitled set'}</h3>
                {s.description && <p className="muted small ellipsis">{s.description}</p>}
                <Progress parts={[{ value: mastered, color: 'var(--good)' }, { value: learning, color: 'var(--warn)' }, { value: s.terms.length - mastered - learning, color: 'transparent' }]} />
                <div className="tiny muted">{mastered} mastered · {learning} learning{s.convertedDeckId ? ' · in long-term deck' : ''}</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
