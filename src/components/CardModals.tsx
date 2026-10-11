import { useState } from 'react';
import { deckPath, updateNote } from '../lib/collection';
import { retrievability } from '../lib/scheduler';
import { all, get } from '../lib/store';
import { CardState, type Card, type Note } from '../lib/types';
import { fmtHours, fmtInterval, stripHtml } from '../lib/util';
import { NoteFields } from './NoteFields';
import { Modal, TagInput, toast } from './ui';

const STATE = ['New', 'Learning', 'Review', 'Relearning'];
const RATING = ['', 'Again', 'Hard', 'Good', 'Easy'];

export function EditNoteModal({ note, onClose }: { note: Note; onClose: () => void }) {
  const nt = get('notetype', note.noteTypeId)!;
  const [fields, setFields] = useState(note.fields);
  const [tags, setTags] = useState(note.tags);
  const save = () => {
    updateNote({ ...note, fields, tags });
    toast('Saved');
    onClose();
  };
  return (
    <Modal title={`Edit note · ${nt.name}`} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col" style={{ gap: 14 }} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save(); }}>
        <NoteFields noteType={nt} fields={fields} onChange={setFields} autoFocus />
        <div>
          <div className="field-label">Tags</div>
          <TagInput value={tags} onChange={setTags} />
        </div>
      </div>
    </Modal>
  );
}

export function CardInfoModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const note = get('note', card.noteId);
  const nt = get('notetype', note?.noteTypeId);
  const logs = all('revlog').filter((r) => r.cardId === card.id).sort((a, b) => b.review - a.review);
  const total = logs.reduce((s, r) => s + r.timeMs, 0);
  const r = retrievability(card);
  const fmt = (ts: number) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <Modal title="Card info" size="wide" onClose={onClose}>
      <div className="col" style={{ gap: 16 }}>
        <div className="muted small ellipsis">{stripHtml(Object.values(note?.fields || {})[0] || '').slice(0, 120)}</div>
        <div className="kv">
          <span>Added</span><span>{fmt(card.createdAt)}</span>
          {logs.length > 0 && <><span>First review</span><span>{fmt(logs[logs.length - 1].review)}</span></>}
          {logs.length > 0 && <><span>Latest review</span><span>{fmt(logs[0].review)}</span></>}
          <span>State</span><span>{card.queue === 'suspended' ? 'Suspended' : STATE[card.state]}</span>
          {card.state !== CardState.New && <><span>Next review</span><span>{fmt(card.due)} ({card.due > Date.now() ? `in ${fmtInterval(card.due - Date.now())}` : 'due now'})</span></>}
          {card.state === CardState.Review && <><span>Interval</span><span>{card.scheduledDays} days</span></>}
          <span>Reviews (cycles)</span><span>{card.reps}</span>
          <span>Lapses</span><span>{card.lapses}</span>
          {card.stability > 0 && <><span>Stability</span><span>{card.stability.toFixed(1)} days</span></>}
          {card.difficulty > 0 && <><span>Difficulty</span><span>{Math.round(((card.difficulty - 1) / 9) * 100)}%</span></>}
          {r !== null && <><span>Retrievability now</span><span>{Math.round(r * 100)}%</span></>}
          {card.ease > 0 && <><span>Ease (SM-2)</span><span>{Math.round(card.ease * 100)}%</span></>}
          <span>Average time</span><span>{logs.length ? `${(total / logs.length / 1000).toFixed(1)}s` : '–'}</span>
          <span>Total time</span><span>{fmtHours(total)}</span>
          <span>Card type</span><span>{nt?.type === 'cloze' ? `Cloze ${card.ord}` : nt?.templates[card.ord]?.name}</span>
          <span>Note type</span><span>{nt?.name}</span>
          <span>Deck</span><span>{deckPath(get('deck', card.deckId))}</span>
        </div>
        {logs.length > 0 && (
          <div className="preview-box">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Type</th><th>Rating</th><th>Interval</th><th>Time</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap">{fmt(l.review)}</td>
                    <td>{STATE[l.state]}</td>
                    <td style={{ color: l.rating === 1 ? 'var(--bad)' : undefined }}>{RATING[l.rating]}</td>
                    <td>{l.interval > 0 ? `${l.interval}d` : fmtInterval(-l.interval * 1000)}</td>
                    <td>{(l.timeMs / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
