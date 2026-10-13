import { useMemo, useState } from 'react';
import { AiAsk } from '../../components/AiAsk';
import { Icon, TopBar, toast } from '../../components/ui';
import { extractJson } from '../../lib/ai';
import { addNote, ensureDeckPath } from '../../lib/collection';
import { all } from '../../lib/store';
import { escapeHtml } from '../../lib/util';
import './tools.css';

interface Marking {
  mark?: number;
  outOf?: number;
  level?: string;
  strengths?: string[];
  improvements?: string[];
  missing?: string[];
  modelAnswer?: string;
  flashcards?: { front: string; back: string }[];
}

function markPrompt(f: { subject: string; board: string; question: string; marks: number; scheme: string; answer: string }) {
  return `You are a senior GCSE examiner for ${f.board || 'the exam board'} in ${f.subject || 'this subject'}. Mark the student's answer exactly as an examiner would, strictly but fairly.

Question (${f.marks} marks):
${f.question.trim()}

${f.scheme.trim() ? `Mark scheme / level descriptors:\n${f.scheme.trim()}` : `No mark scheme was provided: use the standard ${f.board || 'GCSE'} approach for a ${f.marks}-mark question in ${f.subject || 'this subject'} (for levels-based questions use the usual level descriptors and assessment objectives, e.g. AO1–AO3 for English Literature).`}

Student's answer:
"""
${f.answer.trim()}
"""

Reply with ONLY a JSON object (no code fences):
{"mark": <marks awarded>, "outOf": ${f.marks}, "level": "level/band if levels-based, else empty",
 "strengths": ["what earned marks, quoting their words briefly"],
 "improvements": ["specific changes that would gain marks, most valuable first"],
 "missing": ["creditworthy points or AOs they didn't cover"],
 "modelAnswer": "a concise full-mark answer",
 "flashcards": [{"front": "question testing a missing fact or skill", "back": "answer"}]}`;
}

/** Long-answer marking: AI marks against the mark scheme and the gaps become flashcards. */
export function MarkPage() {
  const subjects = useMemo(() => all('deck').filter((d) => !d.parentId && !d.filtered).map((d) => d.name).sort(), []);
  const [subject, setSubject] = useState('');
  const [board, setBoard] = useState('');
  const [question, setQuestion] = useState('');
  const [marks, setMarks] = useState(6);
  const [scheme, setScheme] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<Marking | null>(null);
  const [raw, setRaw] = useState('');
  const [saved, setSaved] = useState(false);
  const ready = question.trim() && answer.trim() && marks > 0;
  const prompt = markPrompt({ subject, board, question, marks, scheme, answer });

  const read = (reply: string) => {
    const r = extractJson<Marking>(reply);
    setResult(r || {});
    setRaw(r ? '' : reply);
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

  return (
    <>
      <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Mark my answer' }]} />
      <div className="page-head">
        <div>
          <h1>Mark my answer</h1>
          <div className="sub">Paste an exam question and your answer – get a mark, what earned it, what would gain more, and flashcards for the gaps.</div>
        </div>
      </div>
      <section className="panel pad col" style={{ gap: 14 }}>
        <div className="form-grid">
          <label className="field">Subject
            <input type="text" list="mark-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Biology" />
            <datalist id="mark-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="field">Exam board <span className="faint">(optional)</span>
            <input type="text" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="e.g. Edexcel IGCSE" />
          </label>
          <label className="field">Marks
            <input type="number" inputMode="numeric" min={1} max={40} value={marks} onChange={(e) => setMarks(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <label className="field">Question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Paste the exam question, including any extract or data it refers to" style={{ minHeight: 80 }} />
        </label>
        <label className="field">Mark scheme <span className="faint">(optional – paste it for the most accurate marking)</span>
          <textarea value={scheme} onChange={(e) => setScheme(e.target.value)} placeholder="Indicative content, level descriptors…" style={{ minHeight: 70 }} />
        </label>
        <label className="field">Your answer
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer as you would in the exam" style={{ minHeight: 160 }} />
        </label>
        {!result && <AiAsk prompt={prompt} onReply={read} label="Mark it" disabled={!ready} />}
      </section>

      {result && (
        <section className="panel pad col mt" style={{ gap: 14 }}>
          {raw ? (
            <>
              <p className="muted small">The reply wasn't in the expected format – here it is as written:</p>
              <div className="code-box">{raw}</div>
            </>
          ) : (
            <>
              <div className="row between wrap">
                <div className="mark-score">{result.mark ?? '?'}<small> / {result.outOf ?? marks}</small></div>
                {result.level && <span className="pill">{result.level}</span>}
              </div>
              {!!result.strengths?.length && <div><b>What earned marks</b><ul className="mark-list small">{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {!!result.improvements?.length && <div><b>How to gain more</b><ul className="mark-list small">{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {!!result.missing?.length && <div><b>Missing</b><ul className="mark-list small">{result.missing.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {result.modelAnswer && <details><summary style={{ cursor: 'pointer' }}><b>Model answer</b></summary><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{result.modelAnswer}</p></details>}
              {!!result.flashcards?.length && (
                <div className="callout small row between wrap">
                  <span>{result.flashcards.length} flashcards ready for what you missed.</span>
                  <button className="btn sm primary" onClick={saveCards} disabled={saved}>{saved ? '✓ Added' : <><Icon name="plus" /> Add to flashcards</>}</button>
                </div>
              )}
              <p className="muted tiny">AI marking is a guide – check it against the real mark scheme.</p>
            </>
          )}
          <div className="row wrap">
            <button className="btn" onClick={() => { setResult(null); setRaw(''); }}>Edit and re-mark</button>
            <button className="btn ghost" onClick={() => { setResult(null); setRaw(''); setAnswer(''); setQuestion(''); setScheme(''); }}>New question</button>
          </div>
        </section>
      )}
    </>
  );
}
