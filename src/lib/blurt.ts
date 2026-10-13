import { clozeToTerm, htmlToText, type StarterNote } from './starter';

/*
 * Blurting: write down everything you remember about a topic, then compare it with the topic's
 * key points (the starter flashcards for that topic). The offline check looks for each point's
 * distinctive words in what you wrote – rarer words count for more – so it works with no AI.
 */

export interface BlurtPoint {
  /** the question / prompt for the point */
  question: string;
  answer: string;
  covered: boolean;
  /** key words found / looked for, for showing why */
  found: string[];
  keys: string[];
}

const STOP = new Set(
  ('the a an and or but of to in on at by for with from into onto than then that this these those there their they them it its is are was were be been being has have had do does did not no can could will would should may might must also more most less very such which what when where why how who whom whose as so if each other some any all both only same own about above below over under again further once here out up down off just because while during before after between through per e.g eg i.e ie etc you your we our us he she his her him one two three use used using make makes made give gives example called known')
    .split(' '),
);

/** Lowercase word stems: punctuation dropped, stop words removed, simple suffixes trimmed. */
export function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9²³⁺⁻]+/)
    .filter((w) => w && (w.length > 2 || /\d/.test(w)) && !STOP.has(w))
    .map(stem);
}

export function stem(w: string): string {
  let s = w;
  for (const suf of ['ational', 'isation', 'ization', 'ations', 'ation', 'ments', 'ment', 'ness', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 'ly', 's']) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  return s.length > 7 ? s.slice(0, 7) : s;
}

/** Question and answer text for a starter note (cloze notes become "sentence with […]" + answers). */
export function pointText(n: Pick<StarterNote, 'type' | 'front' | 'back'>): { question: string; answer: string } {
  if (n.type === 'cloze') {
    const t = clozeToTerm(n.front);
    return { question: t.term, answer: t.definition };
  }
  return { question: htmlToText(n.front), answer: htmlToText(n.back) };
}

/**
 * Mark each point covered when enough of its distinctive answer words appear in the blurt.
 * Words that appear in many of the topic's points (e.g. "energy" in an energy topic) carry little weight.
 */
export function checkBlurt(blurt: string, notes: Pick<StarterNote, 'type' | 'front' | 'back'>[], threshold = 0.45): BlurtPoint[] {
  const written = new Set(stems(blurt));
  const points = notes.map((n) => {
    const t = pointText(n);
    const words = [...new Set(stems(t.answer))];
    return { ...t, words, cues: [...new Set(stems(t.question))].filter((w) => !words.includes(w)) };
  });
  const df = new Map<string, number>();
  for (const p of points) for (const w of [...p.words, ...p.cues]) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w: string) => Math.log(1 + points.length / (df.get(w) || 1));
  return points.map((p) => {
    // the most distinctive words of the answer (long answers would otherwise be impossible to cover)
    const keys = [...p.words].sort((a, b) => idf(b) - idf(a)).slice(0, 6);
    const total = keys.reduce((s, w) => s + idf(w), 0);
    const found = keys.filter((w) => written.has(w));
    const got = found.reduce((s, w) => s + idf(w), 0);
    // naming what the point is about (e.g. "mitochondria") lowers the bar for the answer words
    const cued = [...p.cues].sort((a, b) => idf(b) - idf(a)).slice(0, 2).some((w) => written.has(w));
    const ratio = total > 0 ? got / total : 0;
    return { question: p.question, answer: p.answer, keys, found, covered: ratio >= threshold || (cued && ratio >= 0.25) };
  });
}

/** Prompt asking an AI to compare a blurt with the topic's key points. */
export function blurtPrompt(subject: string, topic: string, blurt: string, points: { question: string; answer: string }[]): string {
  return `You are an experienced GCSE ${subject} teacher. A student did a "blurt": they wrote down everything they could remember about the topic "${topic}" without notes.

Compare the blurt with the key points from the specification below. Be encouraging but precise.

Key points (question → answer):
${points.map((p, i) => `${i + 1}. ${p.question} → ${p.answer.replace(/\n+/g, ' ')}`).join('\n')}

Student's blurt:
"""
${blurt.trim()}
"""

Reply with ONLY a JSON object (no code fences):
{"score": <0-100 estimate of how much of the topic they recalled>,
 "covered": ["key points they clearly got, short"],
 "missing": ["important key points they left out, short, most exam-relevant first"],
 "mistakes": ["anything they wrote that is wrong or a misconception, with the correction"],
 "feedback": "2-4 sentences: what to revise next and one exam tip"}`;
}

export interface BlurtFeedback {
  score?: number;
  covered?: string[];
  missing?: string[];
  mistakes?: string[];
  feedback?: string;
}
