import { useEffect, useRef } from 'react';
import { get, patch, put, useRec } from '../../lib/store';
import type { SetProgress, StudySet, Term } from '../../lib/types';
import { uid } from '../../lib/util';

export function useSet(id: string | undefined): StudySet | undefined {
  return useRec('set', id);
}

export function useProgress(setId: string): SetProgress {
  const p = useRec('setprogress', `prog-${setId}`);
  return p || { id: `prog-${setId}`, kind: 'setprogress', updatedAt: 0, setId, terms: {} };
}

export function recordAnswer(setId: string, termId: string, correct: boolean, written = false) {
  const id = `prog-${setId}`;
  const cur = get('setprogress', id) || { id, kind: 'setprogress' as const, updatedAt: 0, setId, terms: {} };
  const t = cur.terms[termId] || { level: 0, correct: 0, wrong: 0 };
  let level = t.level;
  if (correct) level = written ? 3 : Math.max(level, 2);
  else level = level > 0 ? 1 : 1;
  put({ ...cur, terms: { ...cur.terms, [termId]: { ...t, level, correct: t.correct + (correct ? 1 : 0), wrong: t.wrong + (correct ? 0 : 1) } } });
}

export function setKnown(setId: string, termId: string, known: boolean) {
  const id = `prog-${setId}`;
  const cur = get('setprogress', id) || { id, kind: 'setprogress' as const, updatedAt: 0, setId, terms: {} };
  const t = cur.terms[termId] || { level: 0, correct: 0, wrong: 0 };
  put({ ...cur, terms: { ...cur.terms, [termId]: { ...t, known, level: known ? Math.max(t.level, 2) : Math.min(t.level || 1, 1) } } });
}

export function resetProgress(setId: string) {
  put({ id: `prog-${setId}`, kind: 'setprogress', setId, terms: {} });
}

export function toggleStar(set: StudySet, termId: string) {
  patch('set', set.id, { terms: set.terms.map((t) => (t.id === termId ? { ...t, starred: !t.starred } : t)) });
}

/** Tracks active study time (pauses after 90s idle or when hidden) and logs it on leave. */
export function useStudyTimer(setId: string | undefined) {
  const ms = useRef(0);
  const lastInteract = useRef(Date.now());
  useEffect(() => {
    if (!setId) return;
    const bump = () => { lastInteract.current = Date.now(); };
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInteract.current < 90_000) ms.current += 1000;
    }, 1000);
    window.addEventListener('keydown', bump);
    window.addEventListener('pointerdown', bump);
    const save = () => {
      if (ms.current >= 5000) {
        put({ id: uid(), kind: 'studylog', source: 'set', start: Date.now() - ms.current, ms: ms.current, refId: setId });
        patch('set', setId, { lastStudied: Date.now() });
      }
      ms.current = 0;
    };
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(tick);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [setId]);
}

export type AnswerWith = 'definition' | 'term' | 'both';

/** Prompt/answer for a term given the "answer with" setting. */
export function qa(t: Term, answerWith: AnswerWith): { prompt: string; answer: string; promptIsTerm: boolean } {
  const termFirst = answerWith === 'definition' || (answerWith === 'both' && hashBool(t.id));
  return termFirst ? { prompt: t.term, answer: t.definition, promptIsTerm: true } : { prompt: t.definition, answer: t.term, promptIsTerm: false };
}

function hashBool(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h + Math.floor(Date.now() / 60000)) % 2 === 0;
}

export function newTerm(term = '', definition = ''): Term {
  return { id: uid(), term, definition };
}

/** Long, sentence-style answers (e.g. "Describe…" cards) are poor for typing, spelling and tile games. */
export function isLongText(text: string): boolean {
  return text.length > 60 || text.split(/\s+/).length > 9 || text.includes('\n');
}

/** True when most terms are short words/phrases (vocabulary-style), so Spell makes sense. */
export function isVocabLike(terms: Term[]): boolean {
  const real = terms.filter((t) => t.term.trim());
  if (!real.length) return false;
  return real.filter((t) => t.term.length <= 30 && !t.term.includes('\n')).length / real.length >= 0.6;
}
