import { answerCard, cardsOfNote } from './collection';
import { all, get, put, remove } from './store';
import type { Rating } from './scheduler';
import type { Card, SetProgress } from './types';
import { dayNumber } from './util';

/*
 * Quick Learn answers on GCSE topic sets count as long-term reviews of the same cards, so cramming
 * in Quick Learn still moves the spaced-repetition schedule on (and shows up in stats and topic
 * confidence). Each card gets at most one such review a day:
 *  - a card already reviewed in Flashcards today is left alone;
 *  - a later Quick Learn answer can turn today's "knew it" into "forgot it", but a miss stays a
 *    miss (except straight after, when "I was right" corrects a marking slip).
 */

/** Which starter deck a Quick Learn set's terms come from, or null for the student's own sets. */
export function setDeckKey(setId: string): string | null {
  if (setId.startsWith('starter-set:')) return setId.split(':')[1] || null;
  if (setId.startsWith('y910-set:')) return 'biology';
  return null;
}

/** The long-term cards behind a Quick Learn term: all cloze cards, or the front → back card. */
export function linkedCards(setId: string, termId: string): Card[] {
  const key = setDeckKey(setId);
  if (!key || !termId.startsWith('t-')) return [];
  const guid = `starter:${key}:${termId.slice(2)}`;
  const note = get('note', `n-${guid}`) || all('note').find((n) => n.guid === guid && !n.deleted);
  if (!note || note.deleted) return [];
  const cards = cardsOfNote(note.id).filter((c) => !c.deleted && c.queue !== 'suspended');
  return note.noteTypeId === 'nt-cloze' ? cards : cards.filter((c) => c.ord === 0);
}

const CORRECTION_MS = 60_000;

/** Copies a Quick Learn answer to the long-term cards. Returns how many cards were updated. */
export function syncQuickAnswer(setId: string, termId: string, correct: boolean, now = Date.now()): number {
  const cards = linkedCards(setId, termId);
  if (!cards.length) return 0;
  const today = dayNumber(now);
  const rating: Rating = correct ? 3 : 1;
  const todays = all('revlog').filter((l) => dayNumber(l.review) === today && cards.some((c) => c.id === l.cardId));
  let n = 0;
  for (const card of cards) {
    const logs = todays.filter((l) => l.cardId === card.id);
    if (logs.some((l) => !l.quick)) continue;
    const prev = logs.sort((a, b) => b.review - a.review)[0];
    let base = card;
    if (prev) {
      if (prev.rating === rating) continue;
      if (prev.rating === 1 && now - prev.review > CORRECTION_MS) continue;
      // replace today's Quick Learn review with the new answer
      base = { ...card, ...prev.prev, id: card.id, kind: 'card' } as Card;
      remove('revlog', prev.id);
    }
    // time is already logged by the Quick Learn session, so don't count it twice
    answerCard(base, rating, 0, now, { quick: true });
    n++;
  }
  return n;
}

/*
 * The same card can sit in more than one GCSE set – e.g. "Biology › 2e Plant nutrition" and
 * "Biology › Year 9–10 test › 2e Plant nutrition". Its Quick Learn progress is shared between
 * them, so finishing one set counts in the other.
 */

type TermProgress = SetProgress['terms'][string];

/** Other sets from the same GCSE subject that contain this card. */
export function linkedSets(setId: string, termId: string): string[] {
  const key = setDeckKey(setId);
  if (!key || !termId.startsWith('t-')) return [];
  return all('set').filter((s) => s.id !== setId && setDeckKey(s.id) === key && s.terms.some((t) => t.id === termId)).map((s) => s.id);
}

function writeTerms(updates: Map<string, Record<string, TermProgress>>) {
  const recs: SetProgress[] = [];
  for (const [setId, terms] of updates) {
    const id = `prog-${setId}`;
    const cur = get('setprogress', id) || { id, kind: 'setprogress' as const, updatedAt: 0, setId, terms: {} };
    recs.push({ ...cur, terms: { ...cur.terms, ...terms } });
  }
  if (recs.length) put(recs);
}

/** Copies a card's progress in one set to every other set it's in. */
export function shareTermProgress(setId: string, termId: string): number {
  const entry = get('setprogress', `prog-${setId}`)?.terms[termId];
  if (!entry) return 0;
  const others = linkedSets(setId, termId).filter((id) => JSON.stringify(get('setprogress', `prog-${id}`)?.terms[termId]) !== JSON.stringify(entry));
  writeTerms(new Map(others.map((id) => [id, { [termId]: entry }])));
  return others.length;
}

/** The fuller record of the same card: more answers wins, then the higher level. */
const better = (a: TermProgress, b: TermProgress) => {
  const na = a.correct + a.wrong, nb = b.correct + b.wrong;
  return nb !== na ? (nb > na ? b : a) : b.level > a.level ? b : a;
};

/**
 * Brings progress made before sharing existed into line: for each card in more than one set of a
 * subject, every set gets the fullest record of it. Returns how many sets were updated.
 */
export function mergeLinkedProgress(): number {
  const groups = new Map<string, string[]>(); // subject + card → sets
  for (const s of all('set')) {
    const key = setDeckKey(s.id);
    if (!key) continue;
    for (const t of s.terms) if (t.id.startsWith('t-')) {
      const g = `${key}|${t.id}`;
      const list = groups.get(g);
      if (list) list.push(s.id); else groups.set(g, [s.id]);
    }
  }
  const progress = new Map(all('setprogress').map((p) => [p.setId, p.terms]));
  const updates = new Map<string, Record<string, TermProgress>>();
  for (const [g, setIds] of groups) {
    if (setIds.length < 2) continue;
    const termId = g.slice(g.indexOf('|') + 1);
    const entries = setIds.map((id) => progress.get(id)?.[termId]).filter(Boolean) as TermProgress[];
    if (!entries.length) continue;
    const best = entries.reduce(better);
    for (const id of setIds) {
      if (JSON.stringify(progress.get(id)?.[termId]) === JSON.stringify(best)) continue;
      updates.set(id, { ...(updates.get(id) || {}), [termId]: best });
    }
  }
  writeTerms(updates);
  return updates.size;
}

/*
 * Undo for a Quick Learn answer: everything one answer can change – the card's progress in every
 * set that has it, and the long-term cards and today's Quick Learn reviews – is snapshotted first
 * and can be put back exactly.
 */
export function snapshotAnswer(setId: string, termId: string): () => void {
  const setIds = [setId, ...linkedSets(setId, termId)];
  const progress = setIds.map((id) => ({ id, entry: get('setprogress', `prog-${id}`)?.terms[termId] }));
  const noteIds = [...new Set(linkedCards(setId, termId).map((c) => c.noteId))];
  const cards = noteIds.flatMap((n) => cardsOfNote(n)).map((c) => ({ ...c }));
  const cardIds = new Set(cards.map((c) => c.id));
  const logsBefore = all('revlog').filter((l) => cardIds.has(l.cardId)).map((l) => ({ ...l }));
  return () => {
    // progress in each set
    const recs: SetProgress[] = [];
    for (const { id, entry } of progress) {
      const cur = get('setprogress', `prog-${id}`);
      if (!cur) continue;
      const terms = { ...cur.terms };
      if (entry) terms[termId] = entry; else delete terms[termId];
      recs.push({ ...cur, terms });
    }
    if (recs.length) put(recs);
    // long-term cards and their reviews
    const before = new Set(logsBefore.map((l) => l.id));
    const now = all('revlog').filter((l) => cardIds.has(l.cardId));
    const added = now.filter((l) => !before.has(l.id)).map((l) => l.id);
    const gone = logsBefore.filter((l) => !now.some((x) => x.id === l.id));
    if (added.length) remove('revlog', added);
    if (cards.length || gone.length) put([...cards, ...gone]);
  };
}
