import { useMemo, useState } from 'react';
import { AiAsk } from '../../components/AiAsk';
import { Icon, Modal, TopBar, toast } from '../../components/ui';
import { askAi, extractJson, getAiSettings, hasDirectAi } from '../../lib/ai';
import { addNote, ensureDeckPath } from '../../lib/collection';
import { QUESTION_TYPES, accuracy, markPrompt, median, pickAnchors, type Marking } from '../../lib/marking';
import { all, patch, put, remove, useAll } from '../../lib/store';
import type { Exemplar } from '../../lib/types';
import { escapeHtml, uid } from '../../lib/util';
import './tools.css';

/** How many independent markings one-click AI does; the median mark is shown. */
const RUNS = 3;

interface Combined extends Marking {
  marks: number[];
}

/** Parse every reply, take the median mark, and keep the feedback from the marking closest to it. */
function combine(replies: string[]): Combined | null {
  const parsed = replies.map((r) => extractJson<Marking>(r)).filter((m): m is Marking => !!m && typeof m.mark === 'number');
  if (!parsed.length) return null;
  const marks = parsed.map((m) => Math.round(m.mark!));
  const mid = median(marks);
  const best = [...parsed].sort((a, b) => Math.abs(a.mark! - mid) - Math.abs(b.mark! - mid))[0];
  return { ...best, mark: mid, marks };
}

/** Long-answer marking: examiner-style, levels-based, standardised with examiner-marked examples. */
export function MarkPage() {
  const subjects = useMemo(() => all('deck').filter((d) => !d.parentId && !d.filtered).map((d) => d.name).sort(), []);
  const exemplars = useAll('exemplar');
  const [qtype, setQtype] = useState('custom');
  const [subject, setSubject] = useState('');
  const [board, setBoard] = useState('');
  const [question, setQuestion] = useState('');
  const [marks, setMarks] = useState(6);
  const [scheme, setScheme] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<Combined | null>(null);
  const [raw, setRaw] = useState('');
  const [saved, setSaved] = useState(false);
  const [examples, setExamples] = useState(false);
  const ready = !!(question.trim() && answer.trim() && marks > 0);
  const anchors = pickAnchors(exemplars, qtype, subject);
  const prompt = markPrompt({ subject, board, question, marks, scheme, answer, anchors });
  const direct = hasDirectAi(getAiSettings());

  const chooseType = (id: string) => {
    setQtype(id);
    const t = QUESTION_TYPES.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBoard(t.board);
    setMarks(t.marks);
    setScheme(t.scheme);
  };
  const read = (replies: string[]) => {
    const r = combine(replies);
    setResult(r);
    setRaw(r ? '' : replies[0] || '');
    setSaved(false);
  };
  const saveCards = () => {
    const cards = result?.flashcards || [];
    if (!cards.length) return;
    const deckId = ensureDeckPath(`${subject || 'Marking'}::Marking feedback`);
    let n = 0;
    for (const c of cards) if (addNote({ noteTypeId: 'nt-basic', deckId, fields: { Front: escapeHtml(c.front), Back: escapeHtml(c.back) }, tags: ['marking_feedback'] })) n++;
    setSaved(true);
    toast(`Added ${n} flashcard${n === 1 ? '' : 's'} to ${subject || 'Marking'} › Marking feedback`);
  };
  const saveAsExample = () => {
    const v = window.prompt(`What mark did your teacher or the examiner give this answer (out of ${marks})?`);
    if (v === null) return;
    const mark = Number(v);
    if (!Number.isFinite(mark) || mark < 0 || mark > marks) return toast(`Enter a number from 0 to ${marks}`);
    put({ id: uid(), kind: 'exemplar', qtype, subject, question, answer, mark, outOf: marks, comment: '', createdAt: Date.now(), aiMark: result?.mark } as Exemplar);
    toast('Saved – future marking for this question type will be standardised against it');
  };

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Mark my answer' }]} />
      <div className="page-head">
        <div>
          <h1>Mark my answer</h1>
          <div className="sub">Examiner-style marking against the assessment objectives – level first, then the mark – with what to do to move up.</div>
        </div>
        <button className="btn" onClick={() => setExamples(true)}>Examiner-marked examples{exemplars.length ? ` (${exemplars.length})` : ''}</button>
      </div>
      <section className="panel pad col" style={{ gap: 14 }}>
        <label className="field">Question type
          <select value={qtype} onChange={(e) => chooseType(e.target.value)}>
            <option value="custom">Other subject / I'll paste the mark scheme</option>
            {[...new Set(QUESTION_TYPES.map((t) => t.group))].map((g) => (
              <optgroup key={g} label={g}>{QUESTION_TYPES.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{t.label} ({t.marks})</option>)}</optgroup>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">Subject
            <input type="text" list="mark-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Biology" />
            <datalist id="mark-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="field">Exam board <span className="faint">(optional)</span>
            <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="e.g. Edexcel IGCSE" />
          </label>
          <label className="field">Marks
            <input type="number" inputMode="numeric" min={1} max={60} value={marks} onChange={(e) => setMarks(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <label className="field">Question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Paste the exam question, including any extract or data it refers to" style={{ minHeight: 80 }} />
        </label>
        <details open={qtype === 'custom'}>
          <summary className="field-label" style={{ cursor: 'pointer' }}>Mark scheme {qtype !== 'custom' && <span className="faint">– built in; tap to check, edit or paste the official one</span>}</summary>
          <textarea value={scheme} onChange={(e) => setScheme(e.target.value)} placeholder="Indicative content, level descriptors… (pasting the official mark scheme gives the most accurate marking)" style={{ minHeight: qtype === 'custom' ? 70 : 180, marginTop: 6 }} />
        </details>
        <label className="field">Your answer
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer as you would in the exam" style={{ minHeight: 160 }} />
        </label>
        <div className="small muted">
          {anchors.length ? <>Standardised against <b>{anchors.length}</b> examiner-marked example{anchors.length === 1 ? '' : 's'}. </> : <>Tip: add examiner-marked answers (from your teacher or the board's exemplar scripts) to make marking match the real standard. </>}
          {direct ? `One-click AI marks it ${RUNS} times independently and uses the middle mark.` : 'One-click AI (Settings) marks it 3 times and uses the middle mark for consistency.'}
        </div>
        {!result && <AiAsk prompt={prompt} onReplies={read} runs={RUNS} label="Mark it" disabled={!ready} />}
      </section>

      {result !== null || raw ? (
        <section className="panel pad col mt" style={{ gap: 14 }}>
          {raw || !result ? (
            <>
              <p className="muted small">The reply wasn't in the expected format – here it is as written:</p>
              <div className="code-box">{raw}</div>
            </>
          ) : (
            <>
              <div className="row between wrap">
                <div className="mark-score">{result.mark ?? '?'}<small> / {result.outOf ?? marks}</small></div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {result.level && <span className="pill">{result.level}</span>}
                  {result.marks.length > 1 && <span className="pill" title="Independent markings">{result.marks.join(' · ')}</span>}
                </div>
              </div>
              {result.marks.length > 1 && Math.max(...result.marks) - Math.min(...result.marks) > Math.max(2, marks * 0.1) && (
                <div className="callout warn small">The markings disagreed by more than a level – treat this one as a rough guide, or paste the official mark scheme and mark again.</div>
              )}
              {!!result.aos?.length && (
                <div className="col" style={{ gap: 6 }}>
                  <b>By assessment objective</b>
                  {result.aos.map((a, i) => <div key={i} className="small"><span className="pill">{a.ao}</span> <b>{a.level}</b> – <span className="muted">{a.evidence}</span></div>)}
                </div>
              )}
              {!!result.strengths?.length && <div><b>What earned marks</b><ul className="mark-list small">{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {!!result.improvements?.length && <div><b>How to move up</b><ul className="mark-list small">{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {!!result.missing?.length && <div><b>Missing</b><ul className="mark-list small">{result.missing.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {result.modelAnswer && <details><summary style={{ cursor: 'pointer' }}><b>Model answer</b></summary><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{result.modelAnswer}</p></details>}
              {!!result.flashcards?.length && (
                <div className="callout small row between wrap">
                  <span>{result.flashcards.length} flashcards ready for what you missed.</span>
                  <button className="btn sm primary" onClick={saveCards} disabled={saved}>{saved ? '✓ Added' : <><Icon name="plus" /> Add to flashcards</>}</button>
                </div>
              )}
              <p className="muted tiny">AI marking is a guide. If your teacher marks this answer, tap "I know the real mark" – it is then used to standardise future marking.</p>
            </>
          )}
          <div className="row wrap">
            <button className="btn" onClick={() => { setResult(null); setRaw(''); }}>Edit and re-mark</button>
            {result && <button className="btn" onClick={saveAsExample}>I know the real mark</button>}
            <button className="btn ghost" onClick={() => { setResult(null); setRaw(''); setAnswer(''); setQuestion(''); }}>New question</button>
          </div>
        </section>
      ) : null}
      {examples && <ExamplesModal onClose={() => setExamples(false)} defaultType={qtype} />}
    </>
  );
}

/** Examiner-marked answers: used as anchors, and to measure how close the AI's marks are. */
function ExamplesModal({ onClose, defaultType }: { onClose: () => void; defaultType: string }) {
  const list = useAll('exemplar').sort((a, b) => b.createdAt - a.createdAt);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ qtype: defaultType, subject: QUESTION_TYPES.find((t) => t.id === defaultType)?.subject || '', question: '', answer: '', mark: '', outOf: String(QUESTION_TYPES.find((t) => t.id === defaultType)?.marks || ''), comment: '' });
  const [busy, setBusy] = useState('');
  const direct = hasDirectAi(getAiSettings());
  const acc = accuracy(list.filter((e) => typeof e.aiMark === 'number').map((e) => ({ mark: e.mark, outOf: e.outOf, ai: e.aiMark! })));

  const add = () => {
    const mark = Number(form.mark), outOf = Number(form.outOf);
    if (!form.question.trim() || !form.answer.trim() || !Number.isFinite(mark) || !(outOf > 0) || mark < 0 || mark > outOf) return toast('Fill in the question, answer and a valid mark');
    put({ id: uid(), kind: 'exemplar', qtype: form.qtype, subject: form.subject, question: form.question, answer: form.answer, mark, outOf, comment: form.comment, createdAt: Date.now() } as Exemplar);
    setAdding(false);
    setForm({ ...form, question: '', answer: '', mark: '', comment: '' });
  };

  // mark each example blind (it is left out of its own anchors) and compare with the real mark
  const check = async () => {
    let n = 0;
    for (const e of list) {
      setBusy(`Marking example ${++n} of ${list.length}…`);
      const t = QUESTION_TYPES.find((x) => x.id === e.qtype);
      try {
        const reply = await askAi(markPrompt({ subject: e.subject, board: t?.board || '', question: e.question, marks: e.outOf, scheme: t?.scheme || '', answer: e.answer, anchors: pickAnchors(list, e.qtype, e.subject, e.id) }));
        const m = extractJson<Marking>(reply);
        if (typeof m?.mark === 'number') patch('exemplar', e.id, { aiMark: Math.round(m.mark) });
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err));
        break;
      }
    }
    setBusy('');
  };

  return (
    <Modal title="Examiner-marked examples" size="wide" onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <p className="muted small">Add answers that a teacher or examiner has marked – e.g. from your marked mocks or the board's exemplar scripts with examiner commentary. The AI is shown the closest examples before it marks (so it matches the real standard), and you can check how close its marks are.</p>
        {acc && (
          <div className="callout small">
            <b>Accuracy on {list.filter((e) => typeof e.aiMark === 'number').length} examples:</b> average difference {acc.meanError.toFixed(1)} marks ({acc.meanPctError.toFixed(0)}%), {Math.round(acc.within10 * 100)}% within one level band.
            {Math.abs(acc.bias) >= 0.5 && <> The AI tends to mark {acc.bias > 0 ? 'high' : 'low'} by about {Math.abs(acc.bias).toFixed(1)} marks.</>}
          </div>
        )}
        <div className="row wrap">
          <button className="btn primary" onClick={() => setAdding(!adding)}><Icon name="plus" /> Add example</button>
          <button className="btn" onClick={() => void check()} disabled={!direct || !list.length || !!busy} title={direct ? '' : 'Needs one-click AI in Settings'}>{busy || 'Check AI accuracy'}</button>
          {!direct && <span className="muted tiny">Checking accuracy needs one-click AI (Settings).</span>}
        </div>
        {adding && (
          <div className="panel pad col" style={{ gap: 10 }}>
            <label className="field">Question type
              <select value={form.qtype} onChange={(e) => { const t = QUESTION_TYPES.find((x) => x.id === e.target.value); setForm({ ...form, qtype: e.target.value, subject: t?.subject || form.subject, outOf: t ? String(t.marks) : form.outOf }); }}>
                <option value="custom">Other</option>
                {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.group.split(' (')[0]} – {t.label}</option>)}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">Subject<input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
              <label className="field">Mark given<input type="number" inputMode="numeric" value={form.mark} onChange={(e) => setForm({ ...form, mark: e.target.value })} /></label>
              <label className="field">Out of<input type="number" inputMode="numeric" value={form.outOf} onChange={(e) => setForm({ ...form, outOf: e.target.value })} /></label>
            </div>
            <label className="field">Question<textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} style={{ minHeight: 60 }} /></label>
            <label className="field">Answer<textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} style={{ minHeight: 120 }} /></label>
            <label className="field">Examiner's comment / level <span className="faint">(optional)</span><input type="text" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="e.g. Level 4 – sustained analysis, context not fully integrated" /></label>
            <button className="btn primary" onClick={add}>Save example</button>
          </div>
        )}
        <div className="list">
          {list.map((e) => (
            <div key={e.id} className="list-row">
              <span className="grow ellipsis small"><b>{e.subject || 'Other'}</b> · {QUESTION_TYPES.find((t) => t.id === e.qtype)?.label || 'Custom'} · {e.question.slice(0, 60)}</span>
              <span className="pill">{e.mark}/{e.outOf}</span>
              {typeof e.aiMark === 'number' && <span className={`pill ${Math.abs(e.aiMark - e.mark) / e.outOf <= 0.1 ? 'good' : 'warn'}`} title="AI mark">AI {e.aiMark}</span>}
              <button className="btn ghost icon sm" onClick={() => { if (confirm('Delete this example?')) remove('exemplar', e.id); }} aria-label="Delete"><Icon name="trash" /></button>
            </div>
          ))}
          {!list.length && <div className="list-row muted small">No examples yet.</div>}
        </div>
      </div>
    </Modal>
  );
}
