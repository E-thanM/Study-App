import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { OCCLUSION_FIELDS as F, occlusionImage, parseOcclusion, serializeOcclusion, type Mask, type Occlusion } from '../lib/occlusion';
import { all } from '../lib/store';
import { uid } from '../lib/util';
import { RichEditor, storeImage } from './RichEditor';
import { Icon, Seg, toast } from './ui';

type Tool = 'rect' | 'ellipse' | 'select';
type Drag =
  | { kind: 'draw'; x0: number; y0: number; x: number; y: number }
  | { kind: 'move'; x0: number; y0: number; start: Mask[]; moved: boolean }
  | { kind: 'resize'; id: string; start: Mask };

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Editor for cover-up diagrams: pick or paste an image, then drag boxes over the labels.
 * Each box (or group of boxes) becomes its own card.
 */
export function OcclusionEditor({ fields, onChange }: { fields: Record<string, string>; onChange: (f: Record<string, string>) => void }) {
  const occ = useMemo(() => parseOcclusion(fields[F.masks]), [fields]);
  const imgName = occlusionImage(fields);
  const imgUrl = useMemo(() => {
    if (!imgName) return '';
    if (/^(data:|https?:|blob:)/i.test(imgName)) return imgName;
    return all('media').find((m) => m.name === decodeURIComponent(imgName))?.dataUrl || '';
  }, [imgName]);
  const [tool, setTool] = useState<Tool>('rect');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Mask[] | null>(null);
  const undo = useRef<string[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (o: Occlusion, f = fields) => {
    undo.current = [...undo.current.slice(-40), f[F.masks] || ''];
    onChange({ ...f, [F.masks]: serializeOcclusion(o) });
  };
  const masks = preview || occ.masks;
  const selected = masks.filter((m) => sel.has(m.id));

  const setImage = async (file: File | Blob) => {
    try {
      const name = await storeImage(file, 1600);
      onChange({ ...fields, [F.image]: `<img src="${name}">` });
    } catch {
      toast("Couldn't read that image");
    }
  };

  // paste an image (e.g. a screenshot of a textbook diagram)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      if ((e.target as HTMLElement | null)?.closest?.('[contenteditable]')) return;
      e.preventDefault();
      void setImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const rel = (e: RPointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const maskAt = (e: RPointerEvent) => (e.target as HTMLElement).closest<HTMLElement>('[data-mask]')?.dataset.mask;

  const down = (e: RPointerEvent) => {
    if (e.button > 0) return;
    const p = rel(e);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    area.current!.setPointerCapture(e.pointerId);
    if (handle) {
      const m = occ.masks.find((x) => x.id === handle);
      if (m) setDrag({ kind: 'resize', id: handle, start: m });
      return;
    }
    const hit = maskAt(e);
    if (tool === 'select' || (hit && sel.has(hit))) {
      if (!hit) { setSel(new Set()); return; }
      const next = e.shiftKey ? new Set(sel).add(hit) : sel.has(hit) ? sel : new Set([hit]);
      setSel(next);
      setDrag({ kind: 'move', x0: p.x, y0: p.y, start: occ.masks.filter((m) => next.has(m.id)), moved: false });
      return;
    }
    setDrag({ kind: 'draw', x0: p.x, y0: p.y, x: p.x, y: p.y });
  };

  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const p = rel(e);
    if (drag.kind === 'draw') setDrag({ ...drag, x: p.x, y: p.y });
    else if (drag.kind === 'move') {
      const dx = p.x - drag.x0, dy = p.y - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 0.004) drag.moved = true;
      const moved = new Map(drag.start.map((m) => [m.id, { ...m, x: clamp(Math.min(1 - m.w, m.x + dx)), y: clamp(Math.min(1 - m.h, m.y + dy)) }]));
      setPreview(occ.masks.map((m) => moved.get(m.id) || m));
    } else {
      const s = drag.start;
      const r = { ...s, w: Math.max(0.01, clamp(p.x) - s.x), h: Math.max(0.01, clamp(p.y) - s.y) };
      setPreview(occ.masks.map((m) => (m.id === s.id ? r : m)));
    }
  };

  const up = (e: RPointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'draw') {
      const x = Math.min(drag.x0, drag.x), y = Math.min(drag.y0, drag.y);
      const w = Math.abs(drag.x - drag.x0), h = Math.abs(drag.y - drag.y0);
      if (w > 0.012 && h > 0.012) {
        const group = Math.max(0, ...occ.masks.map((m) => m.group)) + 1;
        const m: Mask = { id: uid().slice(0, 8), x, y, w, h, shape: tool === 'ellipse' ? 'ellipse' : 'rect', group };
        save({ ...occ, masks: [...occ.masks, m] });
        setSel(new Set([m.id]));
      } else {
        // a tap: select the box under the finger, if any
        const hit = maskAt(e);
        setSel(hit ? new Set([hit]) : new Set());
      }
    } else if (preview && (drag.kind === 'resize' || drag.moved)) {
      save({ ...occ, masks: preview });
    }
    setDrag(null);
    setPreview(null);
  };

  const remove = () => { save({ ...occ, masks: occ.masks.filter((m) => !sel.has(m.id)) }); setSel(new Set()); };
  const group = () => {
    const g = Math.min(...selected.map((m) => m.group));
    save({ ...occ, masks: occ.masks.map((m) => (sel.has(m.id) ? { ...m, group: g } : m)) });
  };
  const ungroup = () => {
    let next = Math.max(0, ...occ.masks.map((m) => m.group));
    const seen = new Set<number>();
    save({ ...occ, masks: occ.masks.map((m) => { if (!sel.has(m.id)) return m; if (!seen.has(m.group)) { seen.add(m.group); return m; } return { ...m, group: ++next }; }) });
  };
  const doUndo = () => {
    const prev = undo.current.pop();
    if (prev === undefined) return;
    onChange({ ...fields, [F.masks]: prev });
    setSel(new Set());
  };
  const setLabel = (label: string) => {
    const id = selected[0]?.id;
    onChange({ ...fields, [F.masks]: serializeOcclusion({ ...occ, masks: occ.masks.map((m) => (m.id === id ? { ...m, label } : m)) }) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); remove(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const draft = drag?.kind === 'draw' ? { x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y), w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0) } : null;
  const cards = new Set(occ.masks.map((m) => m.group)).size;
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="col" style={{ gap: 14 }}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void setImage(f); e.target.value = ''; }} />
      {!imgUrl ? (
        <div className="io-empty" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={22} />
          <b>Choose a diagram</b>
          <span className="muted small">Take a photo, pick a screenshot, or paste an image. Then drag boxes over the labels you want to learn – each box becomes a card.</span>
        </div>
      ) : (
        <>
          <div className="io-toolbar">
            <Seg value={tool} onChange={setTool} options={[{ value: 'rect', label: '▭ Box' }, { value: 'ellipse', label: '◯ Oval' }, { value: 'select', label: 'Select' }]} />
            <Seg value={occ.mode} onChange={(mode) => save({ ...occ, mode })} options={[{ value: 'all', label: 'Hide all' }, { value: 'one', label: 'Hide one' }]} />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm" onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>Change image</button>
            </div>
          </div>
          <div className="io-stage">
            <div
              ref={area}
              className={`io-area tool-${tool}`}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => { setDrag(null); setPreview(null); }}
            >
              <img src={imgUrl} alt="" draggable={false} />
              {masks.map((m) => (
                <div
                  key={m.id}
                  data-mask={m.id}
                  className={`io-edit-mask ${sel.has(m.id) ? 'sel' : ''}`}
                  style={{ left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h), borderRadius: m.shape === 'ellipse' ? '50%' : undefined }}
                >
                  <span>{m.group}</span>
                  {sel.size === 1 && sel.has(m.id) && <i data-handle={m.id} className="io-handle" />}
                </div>
              ))}
              {draft && <div className="io-edit-mask draft" style={{ left: pct(draft.x), top: pct(draft.y), width: pct(draft.w), height: pct(draft.h), borderRadius: tool === 'ellipse' ? '50%' : undefined }} />}
            </div>
          </div>
          <div className="row between wrap" style={{ gap: 8 }}>
            <span className="muted small">
              {occ.masks.length ? `${occ.masks.length} box${occ.masks.length === 1 ? '' : 'es'} → ${cards} card${cards === 1 ? '' : 's'}` : 'Drag over a label to cover it.'}
              {' '}{occ.mode === 'all' ? 'Hide all: every box stays covered; one is tested.' : 'Hide one: only the tested box is covered.'}
            </span>
            {selected.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                {selected.length > 1 && <button type="button" className="btn sm" onClick={group} title="Recall these boxes together on one card">Make one card</button>}
                {selected.length > 1 && new Set(selected.map((m) => m.group)).size < selected.length && <button type="button" className="btn sm" onClick={ungroup}>Separate cards</button>}
                <button type="button" className="btn sm danger" onClick={remove}><Icon name="trash" /> Delete</button>
              </div>
            )}
          </div>
          {selected.length === 1 && (
            <label className="field">Answer for box {selected[0].group} <span className="faint">(optional – shown when revealed)</span>
              <input type="text" value={selected[0].label || ''} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. left ventricle" />
            </label>
          )}
        </>
      )}
      <div>
        <div className="field-label"><span>{F.header}</span><span className="faint">optional question shown above the diagram</span></div>
        <RichEditor value={fields[F.header] || ''} onChange={(html) => onChange({ ...fields, [F.header]: html })} />
      </div>
      <div>
        <div className="field-label"><span>{F.extra}</span><span className="faint">optional notes shown with the answer</span></div>
        <RichEditor value={fields[F.extra] || ''} onChange={(html) => onChange({ ...fields, [F.extra]: html })} />
      </div>
    </div>
  );
}
