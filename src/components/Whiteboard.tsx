import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

const COLORS = ['var(--ink)', '#e5484d', '#4a7cf0', '#3fb984'];

/** A sketch layer over the card: draw a diagram or work a calculation from memory, then reveal and compare. */
export function Whiteboard({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState(0);
  const [erase, setErase] = useState(false);

  // match the canvas to its box (and the screen's pixel density) without losing the drawing
  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (c.width === w && c.height === h) return;
      const keep = c.width && c.height ? c.getContext('2d')!.getImageData(0, 0, c.width, c.height) : null;
      c.width = w;
      c.height = h;
      if (keep) c.getContext('2d')!.putImageData(keep, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) => {
    const ctx = canvas.current!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = getComputedStyle(canvas.current!).getPropertyValue('--wb-color') || '#000';
    ctx.lineWidth = (erase ? 22 : 2.6 + (pressure || 0.5) * 1.6) * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  return (
    <div className="whiteboard" onClick={(e) => e.stopPropagation()}>
      <canvas
        ref={canvas}
        style={{ ['--wb-color' as string]: COLORS[color] }}
        onPointerDown={(e) => { canvas.current!.setPointerCapture(e.pointerId); last.current = pos(e); stroke(last.current, { ...last.current, x: last.current.x + 0.1 }, e.pressure); }}
        onPointerMove={(e) => { if (!last.current) return; const p = pos(e); stroke(last.current, p, e.pressure); last.current = p; }}
        onPointerUp={() => { last.current = null; }}
        onPointerCancel={() => { last.current = null; }}
      />
      <div className="wb-tools">
        {COLORS.map((c, i) => (
          <button key={i} type="button" className={`wb-color ${!erase && color === i ? 'on' : ''}`} style={{ background: c }} onClick={() => { setColor(i); setErase(false); }} aria-label="Pen colour" />
        ))}
        <button type="button" className={`btn sm ${erase ? 'primary' : ''}`} onClick={() => setErase(!erase)}>Eraser</button>
        <button type="button" className="btn sm" onClick={() => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); }}>Clear</button>
        <button type="button" className="btn sm icon" onClick={onClose} aria-label="Close whiteboard"><Icon name="x" /></button>
      </div>
    </div>
  );
}
