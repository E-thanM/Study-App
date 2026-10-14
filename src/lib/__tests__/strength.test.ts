import { describe, expect, it } from 'vitest';
import { confidenceFor, subjectStrengths } from '../strength';
import { CardState, type Card, type Deck, type RevLog } from '../types';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 14);
const deck = (id: string, name: string, parentId: string | null): Deck => ({ id, kind: 'deck', updatedAt: 0, name, parentId, presetId: 'p', createdAt: 0 });
const card = (id: string, deckId: string, studied: boolean, stability = 20): Card => ({
  id, kind: 'card', updatedAt: 0, noteId: id, deckId, ord: 0, state: studied ? CardState.Review : CardState.New, due: now + DAY,
  stability: studied ? stability : 0, difficulty: 5, ease: 2.5, scheduledDays: 10, learningStep: 0, reps: studied ? 3 : 0, lapses: 0,
  lastReview: studied ? now - DAY : null, queue: 'normal', flag: 0, position: 0, createdAt: 0,
});
const log = (cardId: string, rating: 1 | 3): RevLog => ({ id: cardId + rating + Math.random(), kind: 'revlog', updatedAt: 0, cardId, noteId: cardId, deckId: 'x', rating, state: CardState.Review, review: now - DAY, timeMs: 1000, interval: 1, lastInterval: 1, ease: 2.5 });

describe('topic strength', () => {
  it('rates confidence 1-5', () => {
    expect(confidenceFor(0.9, 10)).toBe(5);
    expect(confidenceFor(0.6, 10)).toBe(3);
    expect(confidenceFor(0.9, 0)).toBe(1);
  });
  it('ranks a well-known topic above a barely started one', () => {
    const decks = [deck('bio', 'Biology', null), deck('cells', 'Cells', 'bio'), deck('eco', 'Ecology', 'bio')];
    const cards = [
      ...Array.from({ length: 10 }, (_, i) => card(`c${i}`, 'cells', true)),
      ...Array.from({ length: 10 }, (_, i) => card(`e${i}`, 'eco', i < 2, 1)),
    ];
    const logs = [...cards.slice(0, 10).map((c) => log(c.id, 3)), log('e0', 1), log('e1', 1)];
    const [bio] = subjectStrengths(decks, cards, logs, now);
    const cells = bio.topics.find((t) => t.name === 'Cells')!;
    const eco = bio.topics.find((t) => t.name === 'Ecology')!;
    expect(cells.confidence).toBe(5);
    expect(eco.confidence).toBeLessThanOrEqual(2);
    expect(bio.overall.total).toBe(20);
  });
});
