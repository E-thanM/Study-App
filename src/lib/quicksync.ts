import { answerCard, cardsOfNote } from './collection';
import { all, get, remove } from './store';
import type { Rating } from './scheduler';
import type { Card } from './types';
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
