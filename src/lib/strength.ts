import { retrievability } from './scheduler';
import { CardState, type Card, type Deck, type RevLog } from './types';
import { DAY } from './util';

/*
 * How well each topic is known, from the flashcards. For every subject (top-level deck) and each
 * of its topics (child decks, including their subdecks) we combine:
 *  - coverage: share of the topic's cards studied at least once
 *  - memory:   predicted chance of recalling the studied cards right now (FSRS), blended with
 *              how often reviews in the last 30 days were answered correctly
 * into a 1–5 confidence rating. Topics with no reviews yet are "not started" (1).
 */

export interface TopicStrength {
  deckId: string;
  name: string;
  total: number;
  studied: number;
  /** average predicted recall of studied cards, 0–1 (null if none studied) */
  recall: number | null;
  /** share of reviews in the last 30 days not answered "Again", 0–1 (null if none) */
  accuracy: number | null;
  reviews30: number;
  lapses: number;
  confidence: 1 | 2 | 3 | 4 | 5;
  /** 0–1, used for sorting and the bar */
  score: number;
}

export interface SubjectStrength {
  deckId: string;
  name: string;
  topics: TopicStrength[];
  overall: TopicStrength;
}

export function confidenceFor(score: number, studied: number): 1 | 2 | 3 | 4 | 5 {
  if (!studied) return 1;
  return score >= 0.85 ? 5 : score >= 0.7 ? 4 : score >= 0.5 ? 3 : score >= 0.3 ? 2 : 1;
}

export function topicStrength(deckId: string, name: string, cards: Card[], logs: RevLog[], now = Date.now()): TopicStrength {
  const studiedCards = cards.filter((c) => c.state !== CardState.New && c.queue !== 'suspended');
  const live = cards.filter((c) => c.queue !== 'suspended');
  const rs = studiedCards.map((c) => retrievability(c, now) ?? (c.state === CardState.Review ? 0.9 : 0.6));
  const recall = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const recent = logs.filter((l) => now - l.review < 30 * DAY);
  const accuracy = recent.length ? recent.filter((l) => l.rating > 1).length / recent.length : null;
  const coverage = live.length ? studiedCards.length / live.length : 0;
  const memory = recall === null ? 0 : accuracy === null ? recall : 0.6 * recall + 0.4 * accuracy;
  // knowing half the topic perfectly is not the same as knowing the whole topic
  const score = Math.sqrt(coverage) * memory;
  return {
    deckId, name, total: live.length, studied: studiedCards.length, recall, accuracy, reviews30: recent.length,
    lapses: cards.reduce((n, c) => n + c.lapses, 0), confidence: confidenceFor(score, studiedCards.length), score,
  };
}

/** Strength per subject and topic. Filtered decks are left out; cards in them count for their home deck. */
export function subjectStrengths(decks: Deck[], cards: Card[], logs: RevLog[], now = Date.now()): SubjectStrength[] {
  const real = decks.filter((d) => !d.filtered && !d.deleted);
  const children = new Map<string, Deck[]>();
  for (const d of real) if (d.parentId) children.set(d.parentId, [...(children.get(d.parentId) || []), d]);
  const subtree = (id: string) => {
    const out = [id];
    for (let i = 0; i < out.length; i++) out.push(...(children.get(out[i]) || []).map((d) => d.id));
    return new Set(out);
  };
  const home = (c: Card) => c.odid || c.deckId;
  const byName = (a: Deck, b: Deck) => a.name.localeCompare(b.name, undefined, { numeric: true });
  return real
    .filter((d) => !d.parentId)
    .sort(byName)
    .map((root) => {
      const pick = (ids: Set<string>) => {
        const cs = cards.filter((c) => ids.has(home(c)));
        const cardIds = new Set(cs.map((c) => c.id));
        return { cs, ls: logs.filter((l) => cardIds.has(l.cardId)) };
      };
      const all = pick(subtree(root.id));
      const topics = (children.get(root.id) || []).sort(byName).map((t) => {
        const { cs, ls } = pick(subtree(t.id));
        return topicStrength(t.id, t.name, cs, ls, now);
      });
      // cards sitting directly in the subject deck (not in a topic) still count towards "overall"
      return { deckId: root.id, name: root.name, topics: topics.filter((t) => t.total > 0), overall: topicStrength(root.id, root.name, all.cs, all.ls, now) };
    })
    .filter((s) => s.overall.total > 0);
}
