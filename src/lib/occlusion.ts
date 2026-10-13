import type { Note } from './types';
import { escapeHtml } from './util';

/*
 * Image occlusion ("cover-up diagrams"): an image with boxes drawn over labels.
 * Each group of boxes becomes one card: the box(es) to recall are shown in colour with "?",
 * and in "hide all" mode every other box stays covered too so you can't read the answer
 * off neighbouring labels. Box positions are stored as fractions of the image size.
 */

export interface Mask {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'rect' | 'ellipse';
  /** card number – boxes sharing a group are recalled together */
  group: number;
  /** optional answer shown when revealed */
  label?: string;
}

export interface Occlusion {
  /** all = hide all boxes, guess one; one = hide only the box being tested */
  mode: 'all' | 'one';
  masks: Mask[];
}

export const OCCLUSION_FIELDS = { image: 'Image', header: 'Header', extra: 'Back Extra', masks: 'Masks' } as const;

export function parseOcclusion(raw: string | undefined): Occlusion {
  try {
    const text = (raw || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    if (!text) return { mode: 'all', masks: [] };
    const d = JSON.parse(text) as Partial<Occlusion>;
    const masks = (Array.isArray(d.masks) ? d.masks : [])
      .filter((m) => m && [m.x, m.y, m.w, m.h, m.group].every((v) => typeof v === 'number' && Number.isFinite(v)))
      .map((m) => ({ ...m, shape: m.shape === 'ellipse' ? 'ellipse' : 'rect' })) as Mask[];
    return { mode: d.mode === 'one' ? 'one' : 'all', masks };
  } catch {
    return { mode: 'all', masks: [] };
  }
}

export const serializeOcclusion = (o: Occlusion) =>
  JSON.stringify({
    mode: o.mode,
    masks: o.masks.map((m) => ({ ...m, x: round(m.x), y: round(m.y), w: round(m.w), h: round(m.h), label: m.label?.trim() || undefined })),
  });

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Card ordinals for an occlusion note: one per group, numbered like cloze cards (1, 2, 3…). */
export function occlusionOrds(fields: Record<string, string>): number[] {
  return [...new Set(parseOcclusion(fields[OCCLUSION_FIELDS.masks]).masks.map((m) => m.group))].sort((a, b) => a - b);
}

/** The image reference in the Image field (its media name or URL). */
export function occlusionImage(fields: Record<string, string>): string {
  return /<img[^>]*\ssrc="([^"]+)"/i.exec(fields[OCCLUSION_FIELDS.image] || '')?.[1] || '';
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function renderOcclusion(note: Pick<Note, 'fields'>, ord: number, side: 'front' | 'back'): string {
  const f = note.fields;
  const o = parseOcclusion(f[OCCLUSION_FIELDS.masks]);
  const src = occlusionImage(f);
  const header = f[OCCLUSION_FIELDS.header] || '';
  const extra = f[OCCLUSION_FIELDS.extra] || '';
  const targets = o.masks.filter((m) => m.group === ord);
  const boxes = o.masks
    .map((m) => {
      const target = m.group === ord;
      if (!target && o.mode === 'one') return '';
      const cls = target ? (side === 'front' ? 'io-mask io-target' : 'io-mask io-revealed') : 'io-mask io-other';
      const style = `left:${pct(m.x)};top:${pct(m.y)};width:${pct(m.w)};height:${pct(m.h)}${m.shape === 'ellipse' ? ';border-radius:50%' : ''}`;
      const text = target && side === 'front' ? '?' : target && m.label ? escapeHtml(m.label) : '';
      return `<div class="${cls}" style="${style}"><span>${text}</span></div>`;
    })
    .join('');
  const missing = !targets.length ? '<div class="muted small">This card\'s box was removed from the diagram.</div>' : '';
  return [
    header ? `<div class="io-header">${header}</div>` : '',
    src ? `<div class="io-wrap"><img src="${src}" alt="">${boxes}</div>` : '<i>No image</i>',
    missing,
    side === 'back' && extra ? `<div class="io-extra">${extra}</div>` : '',
  ].join('');
}
