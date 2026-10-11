import { clozeOrds } from '../lib/templates';
import type { NoteType } from '../lib/types';
import { RichEditor, wrapSelectionInCloze } from './RichEditor';

/** Editors for every field of a note, with cloze support. */
export function NoteFields({
  noteType, fields, onChange, autoFocus,
}: { noteType: NoteType; fields: Record<string, string>; onChange: (f: Record<string, string>) => void; autoFocus?: boolean }) {
  const onCloze = (same: boolean) => {
    const all = Object.values(fields).join(' ');
    const ords = clozeOrds(all);
    const max = ords.length ? Math.max(...ords) : 0;
    wrapSelectionInCloze(same ? Math.max(1, max) : max + 1);
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      {noteType.fields.map((f, i) => (
        <div key={f}>
          <div className="field-label">
            <span>{f}</span>
            {noteType.type === 'cloze' && i === 0 && <span className="faint">Select text, then […] or Ctrl+Shift+C</span>}
            {f === 'Add Reverse' && <span className="faint">type anything to also create a reverse card</span>}
          </div>
          <RichEditor
            value={fields[f] || ''}
            onChange={(html) => onChange({ ...fields, [f]: html })}
            autoFocus={autoFocus && i === 0}
            clozeButton={noteType.type === 'cloze'}
            onCloze={onCloze}
          />
        </div>
      ))}
    </div>
  );
}
