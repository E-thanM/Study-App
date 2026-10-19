import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, MenuButton, TopBar } from '../../components/ui';
import { get, remove, useAll } from '../../lib/store';
import type { StudySet } from '../../lib/types';
import { StarterSetsModal } from './StarterSets';
import { StarterUpdates } from '../../components/StarterUpdates';
import { studyToday } from '../../lib/goals';
import { syncNovemberSection } from '../../lib/novtest';
import { getPlan, sprintEnd } from '../../lib/plan';

/*
 * Sets shown as a folder tree, like the long-term deck list. Folders come from each set's folder,
 * nested with "::" (e.g. "Biology::Year 9–10 test"); sets without one go under "Other".
 * GCSE topic sets named "Topic – Part" sit under their topic's own set, like subdecks in the
 * deck list. Columns: terms not studied yet, learning, mastered (from Learn / Flashcards progress).
 */

interface Counts { fresh: number; learning: number; mastered: number }
interface Folder { name: string; path: string; folders: Folder[]; sets: StudySet[]; /** the topic's own set, opened by tapping the row */ own?: StudySet }
type Labels = Map<string, string>;

const OPEN_KEY = 'quick-open-folders';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function loadOpen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') as string[]); } catch { return new Set(); }
}
function saveOpen(s: Set<string>) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

const SEP = ' – ';

function buildTree(sets: StudySet[]): { root: Folder; labels: Labels } {
  const root: Folder = { name: '', path: '', folders: [], sets: [] };
  const labels: Labels = new Map();
  for (const s of sets) {
    let node = root;
    const parts = (s.folder || 'Other').split('::').map((x) => x.trim()).filter(Boolean);
    // "2c Biological molecules – Enzyme practicals" goes under "2c Biological molecules"
    if (s.id.startsWith('starter-set:') && s.title.includes(SEP)) {
      const topic = s.title.slice(0, s.title.indexOf(SEP));
      parts.push(topic);
      labels.set(s.id, s.title.slice(topic.length + SEP.length).split(` + ${topic}${SEP}`).join(' + '));
    }
    for (const part of parts) {
      const path = node.path ? `${node.path}::${part}` : part;
      let next = node.folders.find((f) => f.path === path);
      if (!next) { next = { name: part, path, folders: [], sets: [] }; node.folders.push(next); }
      node = next;
    }
    node.sets.push(s);
  }
  const tidy = (f: Folder) => {
    // a topic's own set becomes the row its parts hang under
    for (const sub of f.folders) {
      const i = f.sets.findIndex((x) => x.id.startsWith('starter-set:') && x.title === sub.name);
      if (i >= 0) sub.own = f.sets.splice(i, 1)[0];
    }
    f.folders.sort((a, b) => (a.name === 'Other' ? 1 : b.name === 'Other' ? -1 : byName(a.name, b.name)));
    f.sets.sort((a, b) => byName(labels.get(a.id) || a.title, labels.get(b.id) || b.title));
    f.folders.forEach(tidy);
  };
  tidy(root);
  return { root, labels };
}

function setCounts(s: StudySet): Counts {
  const prog = get('setprogress', `prog-${s.id}`);
  const c = { fresh: 0, learning: 0, mastered: 0 };
  for (const t of s.terms) {
    const l = prog?.terms[t.id]?.level || 0;
    if (l >= 3) c.mastered++;
    else if (l > 0) c.learning++;
    else c.fresh++;
  }
  return c;
}

function folderCounts(f: Folder): Counts {
  const c = { fresh: 0, learning: 0, mastered: 0 };
  const add = (x: Counts) => { c.fresh += x.fresh; c.learning += x.learning; c.mastered += x.mastered; };
  if (f.own) add(setCounts(f.own));
  f.sets.forEach((s) => add(setCounts(s)));
  f.folders.forEach((sub) => add(folderCounts(sub)));
  return c;
}

const n = (x: number, cls: string) => <span className={`num ${x ? cls : 'n-zero'}`}>{x}</span>;

export function SetList() {
  const sets = useAll('set');
  useAll('setprogress');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(loadOpen);
  const [starterOpen, setStarterOpen] = useState(false);
  // builds the Biology › Year 9–10 test topic sets
  useEffect(() => { void syncNovemberSection(studyToday(), sprintEnd(getPlan().dates)); }, []);

  const searching = q.trim().length > 0;
  const shown = searching ? sets.filter((s) => `${s.title} ${s.description} ${s.folder}`.toLowerCase().includes(q.trim().toLowerCase())) : sets;
  const { root: tree, labels } = useMemo(() => buildTree(shown), [shown]);
  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOpen(next);
    saveOpen(next);
  };
  // search results open every folder so the matches show
  const isOpen = (path: string) => searching || open.has(path);

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
      <StarterUpdates kind="sets" />
      {sets.length > 0 && <input type="search" className="mb" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets" style={{ maxWidth: 360 }} />}
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
        <div className="panel">
          <div className="deck-row deck-head set-row">
            <span>Set</span>
            <span className="num" title="Terms not studied yet">New</span>
            <span className="num" title="Terms you're still learning">Learn</span>
            <span className="num" title="Terms mastered">Known</span>
            <span />
          </div>
          {tree.folders.map((f) => <FolderRow key={f.path} folder={f} depth={0} isOpen={isOpen} toggle={toggle} labels={labels} />)}
        </div>
      )}
      <p className="muted small mt center">Tap a folder to open it, a set to study it · ⋯ for study modes</p>
      {starterOpen && <StarterSetsModal onClose={() => setStarterOpen(false)} />}
    </>
  );
}

function FolderRow({ folder, depth, isOpen, toggle, labels }: { folder: Folder; depth: number; isOpen: (p: string) => boolean; toggle: (p: string) => void; labels: Labels }) {
  const nav = useNavigate();
  const c = folderCounts(folder);
  const open = isOpen(folder.path);
  // folders and sets mixed in name order, like subdecks
  const children = [
    ...folder.folders.map((f) => ({ key: f.path, name: f.name, el: <FolderRow key={f.path} folder={f} depth={depth + 1} isOpen={isOpen} toggle={toggle} labels={labels} /> })),
    ...folder.sets.map((x) => ({ key: x.id, name: labels.get(x.id) || x.title, el: <SetRow key={x.id} set={x} depth={depth + 1} label={labels.get(x.id)} /> })),
  ].sort((a, b) => byName(a.name, b.name));
  return (
    <>
      <div className="deck-row set-row">
        <div className="name" style={{ paddingLeft: depth * 20 }} onClick={() => (folder.own ? nav(`/quick/${folder.own.id}`) : toggle(folder.path))}>
          <button className={`twisty ${open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(folder.path); }} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
            <Icon name="chevron" />
          </button>
          <span className="label">{folder.name}</span>
        </div>
        {n(c.fresh, 'n-new')}
        {n(c.learning, 'n-learn')}
        {n(c.mastered, 'n-review')}
        {folder.own ? <SetMenu set={folder.own} /> : <span />}
      </div>
      {open && children.map((x) => x.el)}
    </>
  );
}

function SetRow({ set, depth, label }: { set: StudySet; depth: number; label?: string }) {
  const nav = useNavigate();
  const c = setCounts(set);
  return (
    <div className="deck-row set-row">
      <div className="name" style={{ paddingLeft: depth * 20 }} onClick={() => nav(`/quick/${set.id}`)}>
        <span style={{ width: 20, flex: 'none' }} />
        <span className="label">{label || set.title || 'Untitled set'}</span>
      </div>
      {n(c.fresh, 'n-new')}
      {n(c.learning, 'n-learn')}
      {n(c.mastered, 'n-review')}
      <SetMenu set={set} />
    </div>
  );
}

function SetMenu({ set }: { set: StudySet }) {
  const nav = useNavigate();
  const go = (mode = '') => nav(`/quick/${set.id}${mode ? `/${mode}` : ''}`);
  return (
    <MenuButton
      items={[
        { label: 'Flashcards', icon: 'cards', onClick: () => go('flashcards') },
        { label: 'Learn', icon: 'learn', onClick: () => go('learn') },
        { label: 'Test', icon: 'test', onClick: () => go('test') },
        { label: 'Match', icon: 'match', onClick: () => go('match') },
        { label: 'Edit', icon: 'edit', onClick: () => go('edit') },
        { divider: true, label: '', onClick: () => {} },
        { label: 'Delete set', icon: 'trash', danger: true, onClick: () => { if (confirm(`Delete "${set.title}"?`)) { remove('set', set.id); remove('setprogress', `prog-${set.id}`); } } },
      ]}
    />
  );
}
