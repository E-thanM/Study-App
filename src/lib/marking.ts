import type { Exemplar } from './types';

/*
 * Examiner-style marking for long answers. Levels-based questions (English especially) are marked
 * the way examiners do it: decide the level for each assessment objective by best fit, quoting
 * evidence, then place the mark within the level. The AI is run several times and the median taken,
 * and examiner-marked examples saved by the student are included as anchors.
 *
 * The level descriptors below are summaries in our own words of the boards' published criteria –
 * the student can edit them or paste the official mark scheme for the exact wording.
 */

export interface QuestionType {
  id: string;
  group: string;
  label: string;
  subject: string;
  board: string;
  marks: number;
  scheme: string;
}

const LIT_AO = `AO1 – knowledge and understanding of the text, a personal and critical response, well-chosen references and quotations.
AO2 – analysis of language, form and structure and their effects, using subject terminology.
AO3 – links and comparisons between texts.
AO4 – the relationship between the text and its context.`;

const LIT_LEVELS = `Levels (apply best fit for each assessed AO, then decide the overall level):
Level 1 – limited: some knowledge, mostly narrative or descriptive, few or no references, little awareness of the writer's methods or context.
Level 2 – basic/some: some relevant points with some supporting references, simple comments on methods or context, explanation is uneven.
Level 3 – sound/clear: relevant, clear response; references support points; clear explanation of methods and their effects; relevant context linked to the text.
Level 4 – sustained/thorough: thoughtful, developed response; well-integrated, apt references; detailed analysis of methods with precise terminology; context integrated into the argument.
Level 5 – perceptive/assured: critical, original and convincing argument; discriminating, embedded references; perceptive analysis of subtle effects; context woven in perceptively throughout.
Within a level: top of the level if every descriptor is securely met, bottom if only just.`;

const LANG_READ = `Reading AOs:
AO1 – read and understand a variety of texts, selecting and interpreting information, ideas and perspectives.
AO2 – understand and analyse how writers use linguistic and structural devices to achieve their effects.
AO3 – explore links and comparisons between texts (comparison questions only).
Levels: 1 limited/simple identification; 2 some understanding with simple comment on effects; 3 clear understanding, relevant examples and clear explanation of effects; 4 thorough, sustained analysis with well-chosen examples; 5 perceptive, detailed analysis of subtle effects with discriminating, integrated references.`;

const LANG_WRITE = `Writing AOs (two separate marks, then added):
AO4 – communicate effectively and imaginatively, adapting form, tone and register for the purpose and audience (content and organisation).
AO5 – write clearly using a range of vocabulary and sentence structures, with appropriate paragraphing and accurate spelling, punctuation and grammar (technical accuracy).
Levels for each: 1 basic, often unclear; 2 some awareness of purpose/audience, simple structure, errors that sometimes impede; 3 clear, generally appropriate, organised paragraphs, mostly accurate; 4 effective, engaging, well-structured, wide vocabulary, accurate with occasional slips; 5 compelling, sophisticated, assured control of structure and register, ambitious vocabulary, consistently accurate.`;

export const QUESTION_TYPES: QuestionType[] = [
  { id: '4ET1-unseen', group: 'Edexcel IGCSE English Literature (4ET1)', label: 'Paper 1 A – Unseen poetry', subject: 'English Literature', board: 'Edexcel International GCSE (4ET1)', marks: 20, scheme: `Assessed: AO1 and AO2.\n${LIT_AO}\n${LIT_LEVELS}` },
  { id: '4ET1-anthology', group: 'Edexcel IGCSE English Literature (4ET1)', label: 'Paper 1 B – Anthology poetry comparison', subject: 'English Literature', board: 'Edexcel International GCSE (4ET1)', marks: 30, scheme: `Assessed: AO1, AO2 and AO3 (comparison is essential – an answer that doesn't compare can't reach the higher levels).\n${LIT_AO}\n${LIT_LEVELS}` },
  { id: '4ET1-prose', group: 'Edexcel IGCSE English Literature (4ET1)', label: 'Paper 1 C – Modern prose (e.g. Of Mice and Men)', subject: 'English Literature', board: 'Edexcel International GCSE (4ET1)', marks: 40, scheme: `Assessed: AO1 and AO4 (context must be relevant and linked to the text, not bolted on).\n${LIT_AO}\n${LIT_LEVELS}` },
  { id: '4ET1-drama', group: 'Edexcel IGCSE English Literature (4ET1)', label: 'Paper 2 A – Modern drama (e.g. An Inspector Calls)', subject: 'English Literature', board: 'Edexcel International GCSE (4ET1)', marks: 30, scheme: `Assessed: AO1 and AO4.\n${LIT_AO}\n${LIT_LEVELS}` },
  { id: '4ET1-heritage', group: 'Edexcel IGCSE English Literature (4ET1)', label: 'Paper 2 B – Literary heritage (e.g. Macbeth)', subject: 'English Literature', board: 'Edexcel International GCSE (4ET1)', marks: 30, scheme: `Assessed: AO1 and AO2.\n${LIT_AO}\n${LIT_LEVELS}` },
  { id: '4EA1-reading', group: 'Edexcel IGCSE English Language A (4EA1)', label: 'Reading – analysis question', subject: 'English Language', board: 'Edexcel International GCSE English Language A (4EA1)', marks: 12, scheme: `Assessed: AO2 (and AO1 where the question asks for understanding).\n${LANG_READ}` },
  { id: '4EA1-compare', group: 'Edexcel IGCSE English Language A (4EA1)', label: 'Reading – comparison question', subject: 'English Language', board: 'Edexcel International GCSE English Language A (4EA1)', marks: 22, scheme: `Assessed: AO3 (with AO1/AO2 supporting). Both texts must be compared throughout for the higher levels.\n${LANG_READ}` },
  { id: '4EA1-transactional', group: 'Edexcel IGCSE English Language A (4EA1)', label: 'Writing – transactional (article, letter, speech…)', subject: 'English Language', board: 'Edexcel International GCSE English Language A (4EA1)', marks: 45, scheme: `Two marks: AO4 (about 60% of the marks) and AO5 (about 40%). Give each separately, then add.\n${LANG_WRITE}` },
  { id: '4EA1-imaginative', group: 'Edexcel IGCSE English Language A (4EA1)', label: 'Writing – imaginative (story / description)', subject: 'English Language', board: 'Edexcel International GCSE English Language A (4EA1)', marks: 30, scheme: `Two marks: AO4 (about 60% of the marks) and AO5 (about 40%). Give each separately, then add.\n${LANG_WRITE}` },
];

export interface AoMark {
  ao: string;
  level: string;
  evidence: string;
}

export interface Marking {
  mark?: number;
  outOf?: number;
  level?: string;
  aos?: AoMark[];
  strengths?: string[];
  improvements?: string[];
  missing?: string[];
  modelAnswer?: string;
  flashcards?: { front: string; back: string }[];
}

export function markPrompt(f: { subject: string; board: string; question: string; marks: number; scheme: string; answer: string; anchors?: Exemplar[]; levels?: boolean }): string {
  const anchors = (f.anchors || []).slice(0, 2);
  const levelsBased = f.levels ?? /level/i.test(f.scheme);
  return `You are a senior GCSE examiner for ${f.board || 'the exam board'} in ${f.subject || 'this subject'}, standardised to mark exactly as the board does. Mark the student's answer strictly and fairly.

Question (${f.marks} marks):
${f.question.trim()}

${f.scheme.trim() ? `Mark scheme / assessment criteria:\n${f.scheme.trim()}` : `No mark scheme was provided: use the standard ${f.board || 'GCSE'} approach for a ${f.marks}-mark question in ${f.subject || 'this subject'}.`}
${anchors.length ? `\nStandardisation – answers to similar questions already marked by an examiner. Match this standard:\n${anchors.map((a, i) => `Example ${i + 1} (awarded ${a.mark}/${a.outOf}${a.comment ? ` – ${a.comment}` : ''}):\nQuestion: ${a.question.trim().slice(0, 400)}\nAnswer: """${a.answer.trim().slice(0, 2500)}"""`).join('\n\n')}\n` : ''}
How to mark:
${levelsBased ? `1. For each assessed objective, decide the level by BEST FIT and quote the student's own words as evidence.
2. Decide the overall level, then place the mark within that level's band: top if every descriptor is securely met, middle if most are, bottom if only just.
3. Don't reward length, quotations that aren't analysed, or context that isn't linked to the question. Narrative retelling stays in the lower levels.
4. Examiners rarely give full marks; an answer that is good but not perceptive belongs in Level 4, not 5. If unsure between two levels, choose the lower.` : `1. Award marks only for creditworthy points that match the mark scheme; each mark needs a distinct, correct point.
2. Don't credit vague or contradictory statements, and don't give the benefit of the doubt.`}

Student's answer:
"""
${f.answer.trim()}
"""

Reply with ONLY a JSON object (no code fences):
{"mark": <marks awarded, a whole number>, "outOf": ${f.marks}, "level": "${levelsBased ? 'overall level, e.g. Level 3' : ''}",
 "aos": [${levelsBased ? '{"ao": "AO1", "level": "Level 3", "evidence": "short quote from the answer and why"}' : ''}],
 "strengths": ["what earned marks, quoting their words briefly"],
 "improvements": ["specific changes that would move it up, most valuable first"],
 "missing": ["creditworthy points or objectives they didn't cover"],
 "modelAnswer": "a concise top-level answer or paragraph",
 "flashcards": [{"front": "question testing a missing fact or skill", "back": "answer"}]}`;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Examples to anchor the marking: same question type first, then same subject; never the answer being marked. */
export function pickAnchors(all: Exemplar[], qtype: string, subject: string, exclude?: string): Exemplar[] {
  const pool = all.filter((e) => !e.deleted && e.id !== exclude);
  const same = pool.filter((e) => e.qtype === qtype && qtype !== 'custom');
  const subj = pool.filter((e) => !same.includes(e) && e.subject.toLowerCase() === subject.toLowerCase());
  // one strong and one weaker example tells the AI more than two similar ones
  const sorted = (xs: Exemplar[]) => [...xs].sort((a, b) => b.mark / b.outOf - a.mark / a.outOf);
  const s = sorted(same);
  const picked = s.length >= 2 ? [s[0], s[s.length - 1]] : [...s, ...sorted(subj)];
  return picked.slice(0, 2);
}

/** Accuracy summary for the calibration check. */
export function accuracy(rows: { mark: number; outOf: number; ai: number }[]) {
  if (!rows.length) return null;
  const err = rows.map((r) => Math.abs(r.ai - r.mark));
  const pctErr = rows.map((r) => Math.abs(r.ai - r.mark) / r.outOf);
  const bias = rows.reduce((s, r) => s + (r.ai - r.mark), 0) / rows.length;
  return {
    meanError: err.reduce((a, b) => a + b, 0) / rows.length,
    meanPctError: (pctErr.reduce((a, b) => a + b, 0) / rows.length) * 100,
    /** within roughly one level band (10% of the marks) */
    within10: rows.filter((r) => Math.abs(r.ai - r.mark) / r.outOf <= 0.1).length / rows.length,
    bias,
  };
}
