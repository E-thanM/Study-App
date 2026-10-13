import { useEffect, useMemo, useRef } from 'react';
import { audioUrl, renderCard, scopeCss, toDisplayHtml } from '../lib/templates';
import type { Note, NoteType } from '../lib/types';

const FLAG_COLORS = ['', '#e5484d', '#f08c2e', '#3fb984', '#4a7cf0', '#e46cb6', '#2bb5b0', '#8e5cf0'];
export { FLAG_COLORS };

let audio: HTMLAudioElement | null = null;
export function playAudio(name: string) {
  const url = audioUrl(name);
  if (!url) return;
  audio?.pause();
  audio = new Audio(url);
  void audio.play().catch(() => {});
}
export function speak(text: string, lang = 'en-GB') {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.speak(u);
}

const ANSWER_HR = /<hr id=["']?answer["']?\s*\/?>/i;

/** Long answers (quotes + analysis, mark schemes) are wrapped so they can be laid out as left-aligned paragraphs. */
function formatLong(html: string): string {
  if (html.includes('typeans-slot')) return html;
  const m = ANSWER_HR.exec(html);
  const ans = m ? html.slice(m.index + m[0].length) : html;
  const len = ans.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim().length;
  if (len < 160) return html;
  // each line ("Quote:", "Analysis:", mark-scheme points) becomes its own spaced paragraph
  const body = ans.replace(/^(\s*<br\s*\/?>)+/i, '').replace(/(<br\s*\/?>\s*)+/gi, '<br><span class="para-gap"></span>');
  return m ? `${html.slice(0, m.index)}${m[0]}<div class="long-ans">${body}</div>` : `<div class="long-ans">${body}</div>`;
}

/** Renders a card side with the note type's CSS, media, maths, audio buttons and type-in box. */
export function CardView({
  note, noteType, ord, side, deckName, typed, onTyped, onEnter, flag = 0, autoplay,
}: {
  note: Note;
  noteType: NoteType;
  ord: number;
  side: 'front' | 'back';
  deckName?: string;
  typed?: string;
  onTyped?: (s: string) => void;
  onEnter?: () => void;
  flag?: number;
  autoplay?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const r = useMemo(() => renderCard({ note, noteType, ord, deckName, typed }), [note, noteType, ord, deckName, typed]);
  const shown = side === 'front' ? r.front : r.back;
  const html = useMemo(() => formatLong(toDisplayHtml(shown.html)), [shown.html]);
  const long = html.includes('class="long-ans"');
  const scope = `nt-${noteType.id.replace(/[^\w-]/g, '')}`;
  const css = useMemo(() => scopeCss(noteType.css || '', `.${scope}`), [noteType.css, scope]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (autoplay) {
      const first = el.querySelector<HTMLElement>('.audio-btn');
      if (first?.dataset.audio) playAudio(first.dataset.audio);
    }
  }, [html, autoplay]);

  const hasTypeSlot = side === 'front' && html.includes('typeans-slot');
  const parts = hasTypeSlot ? html.split('<div class="typeans-slot"></div>') : [html];

  return (
    <div
      className={`card-face ${scope}${long ? ' long' : ''}`}
      ref={ref}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const a = t.closest<HTMLElement>('.audio-btn');
        if (a?.dataset.audio) { e.stopPropagation(); playAudio(a.dataset.audio); }
        const s = t.closest<HTMLElement>('.tts-btn');
        if (s?.dataset.tts) { e.stopPropagation(); speak(s.dataset.tts, s.dataset.lang); }
      }}
    >
      <style>{css}</style>
      {flag > 0 && <div className="flag-bar" style={{ background: FLAG_COLORS[flag] }} />}
      <div className="card">
        {parts.map((p, i) => (
          <span key={i}>
            <span dangerouslySetInnerHTML={{ __html: p }} />
            {hasTypeSlot && i < parts.length - 1 && (
              <input
                type="text"
                className="typeans-input"
                autoFocus
                value={typed || ''}
                placeholder="Type the answer"
                onChange={(e) => onTyped?.(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
