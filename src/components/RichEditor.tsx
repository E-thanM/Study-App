import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { all, put } from '../lib/store';
import { uid } from '../lib/util';

/** Downscale an image file to a compact JPEG/PNG data URL and store it as media. Returns the media name. */
export async function storeImage(file: File | Blob, maxSide = 1000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = file.type === 'image/png' && canvas.width * canvas.height < 300_000;
    const dataUrl = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82);
    const name = `paste-${uid().slice(0, 12)}.${png ? 'png' : 'jpg'}`;
    put({ id: uid(), kind: 'media', name, dataUrl });
    return name;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fromEditorHtml(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img[data-media]').forEach((img) => img.setAttribute('src', img.getAttribute('data-media')!));
  clone.querySelectorAll('img').forEach((img) => img.removeAttribute('data-media'));
  let html = clone.innerHTML;
  if (html === '<br>') html = '';
  return html;
}

export function RichEditor({
  value, onChange, placeholder, autoFocus, clozeButton, onCloze, sticky,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  clozeButton?: boolean;
  onCloze?: (same: boolean) => void;
  sticky?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const last = useRef<string>('');

  // sync external value into the editor (but never while it would clobber typing)
  useEffect(() => {
    const el = ref.current;
    if (!el || htmlMode) return;
    if (value !== last.current) {
      el.innerHTML = renderForEdit(value);
      last.current = value;
    }
  }, [value, htmlMode]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = fromEditorHtml(el);
    last.current = html;
    onChange(html);
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertHtml = (html: string) => exec('insertHTML', html);

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = [...e.clipboardData.items];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (img) {
      e.preventDefault();
      const f = img.getAsFile();
      if (f) {
        const name = await storeImage(f);
        insertHtml(`<img src="${name}">`);
        ref.current!.innerHTML = renderForEdit(fromEditorHtml(ref.current!));
        emit();
      }
      return;
    }
    // paste as clean-ish HTML: keep basic formatting, drop styles/classes
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('style,script,meta,link').forEach((n) => n.remove());
      div.querySelectorAll('*').forEach((n) => {
        n.removeAttribute('style');
        n.removeAttribute('class');
        n.removeAttribute('id');
      });
      insertHtml(div.innerHTML);
    }
  };

  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const name = await storeImage(f);
      ref.current?.focus();
      document.execCommand('insertHTML', false, `<img src="${name}">`);
      ref.current!.innerHTML = renderForEdit(fromEditorHtml(ref.current!));
      emit();
    };
    input.click();
  };

  return (
    <div>
      <div className="toolbar" style={sticky ? { position: 'sticky', top: 0 } : undefined}>
        <button type="button" title="Bold (Ctrl+B)" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><b>B</b></button>
        <button type="button" title="Italic (Ctrl+I)" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><i>I</i></button>
        <button type="button" title="Underline (Ctrl+U)" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}><u>U</u></button>
        <button type="button" title="Superscript" onMouseDown={(e) => { e.preventDefault(); exec('superscript'); }}>x²</button>
        <button type="button" title="Subscript" onMouseDown={(e) => { e.preventDefault(); exec('subscript'); }}>x₂</button>
        <button type="button" title="Highlight" onMouseDown={(e) => { e.preventDefault(); exec('hiliteColor', '#fff3a0'); }}>🖍</button>
        <button type="button" title="Bullet list" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}>•</button>
        <button type="button" title="Clear formatting" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}>⌫</button>
        <span className="sep" />
        <button type="button" title="Insert image (or paste one)" onMouseDown={(e) => { e.preventDefault(); addImage(); }}>🖼</button>
        <button type="button" title="Maths: \( … \)" onMouseDown={(e) => { e.preventDefault(); exec('insertText', '\\(  \\)'); }}>∑</button>
        {clozeButton && (
          <button type="button" title="Cloze deletion (Ctrl+Shift+C, same number: Ctrl+Alt+Shift+C)" onMouseDown={(e) => { e.preventDefault(); onCloze?.(e.altKey); }}>[…]</button>
        )}
        <button type="button" title="Edit HTML" onMouseDown={(e) => { e.preventDefault(); setHtmlMode((h) => !h); last.current = ''; }}>{'</>'}</button>
      </div>
      {htmlMode ? (
        <textarea className="rich html" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      ) : (
        <div
          ref={ref}
          className="rich"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c' && clozeButton) {
              e.preventDefault();
              onCloze?.(e.altKey);
            }
          }}
        />
      )}
    </div>
  );
}

/** Editor view: resolve media names to data URLs but remember the original name. */
function renderForEdit(html: string): string {
  const media = new Map(all('media').map((m) => [m.name, m.dataUrl]));
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'script', 'iframe', 'form'] });
  return clean.replace(/<img([^>]*?)\ssrc="([^"]+)"/gi, (m, attrs: string, src: string) => {
    if (/^(data:|https?:|blob:)/i.test(src)) return m;
    const url = media.get(decodeURIComponent(src));
    return url ? `<img${attrs} data-media="${src}" src="${url}"` : m;
  });
}

/** Wrap the current selection in the given cloze number. */
export function wrapSelectionInCloze(n: number) {
  const sel = window.getSelection();
  const text = sel?.toString() || '';
  document.execCommand('insertText', false, `{{c${n}::${text}}}`);
}
