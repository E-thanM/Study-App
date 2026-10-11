import { describe, expect, it } from 'vitest';
import { schedule, parseStep } from '../scheduler';
import { DEFAULT_PRESET } from '../seed';
import { CardState, type Card } from '../types';
import { parseCsv, parseQuizlet, parseTimetable, parseAnkiText } from '../importers';
import { clozeOrds, typeCompare } from '../templates';
import { parseAiReply } from '../ai';
import { parseStarter } from '../starter';
import { answersMatch } from '../util';

const newCard = (): Card => ({
  id: 'c1', kind: 'card', updatedAt: 0, noteId: 'n1', deckId: 'd1', ord: 0, state: CardState.New, due: 0,
  stability: 0, difficulty: 0, ease: 0, scheduledDays: 0, learningStep: 0, reps: 0, lapses: 0, lastReview: null,
  queue: 'normal', flag: 0, position: 1, createdAt: 0,
});

describe('scheduler', () => {
  it('parses steps', () => {
    expect(parseStep('10m')).toBe(10);
    expect(parseStep('1h')).toBe(60);
    expect(parseStep('1d')).toBe(1440);
    expect(parseStep('30s')).toBe(0.5);
  });

  for (const algorithm of ['fsrs', 'sm2'] as const) {
    it(`${algorithm}: again on a new card uses the first learning step`, () => {
      const now = Date.UTC(2026, 9, 1, 12);
      const r = schedule(newCard(), { ...DEFAULT_PRESET, algorithm }, 1, now);
      expect(r.card.state).toBe(CardState.Learning);
      expect(Math.round(r.delayMs / 60000)).toBe(1);
    });
    it(`${algorithm}: intervals grow with Good answers`, () => {
      let c = newCard();
      let t = Date.UTC(2026, 9, 1, 12);
      const p = { ...DEFAULT_PRESET, algorithm };
      const gaps: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = schedule(c, p, 3, t);
        c = r.card;
        gaps.push(r.delayMs);
        t = c.due;
      }
      expect(c.state).toBe(CardState.Review);
      expect(gaps[5]).toBeGreaterThan(gaps[3]);
    });
    it(`${algorithm}: easy > good > hard > again`, () => {
      const p = { ...DEFAULT_PRESET, algorithm };
      const now = Date.UTC(2026, 9, 10, 12);
      const review: Card = { ...newCard(), state: CardState.Review, stability: 10, difficulty: 5, ease: 2.5, scheduledDays: 10, lastReview: now - 10 * 86400000, due: now, reps: 4 };
      const d = [1, 2, 3, 4].map((r) => schedule(review, p, r as 1 | 2 | 3 | 4, now).delayMs);
      expect(d[0]).toBeLessThan(d[1]);
      expect(d[1]).toBeLessThan(d[2]);
      expect(d[2]).toBeLessThan(d[3]);
    });
  }
});

describe('importers', () => {
  it('parses CSV with quotes', () => {
    expect(parseCsv('a,"b, c",d\n"x ""y""",2,3', ',')).toEqual([['a', 'b, c', 'd'], ['x "y"', '2', '3']]);
  });
  it('parses Quizlet text', () => {
    expect(parseQuizlet('dog\tchien\ncat\tchat', 'tab', 'newline')).toEqual([{ term: 'dog', definition: 'chien' }, { term: 'cat', definition: 'chat' }]);
    expect(parseQuizlet('a - b;c - d', 'dash', 'semicolon')).toHaveLength(2);
  });
  it('reads Anki text headers', () => {
    const f = parseAnkiText('#separator:tab\n#html:true\n#tags column:3\nfront\tback\ttag1');
    expect(f.rows[0]).toEqual(['front', 'back', 'tag1']);
    expect(f.tagsColumn).toBe(2);
    expect(f.html).toBe(true);
  });
  it('parses a grid timetable', () => {
    const { sessions, layout } = parseTimetable([
      ['Time', 'Monday', 'Tuesday'],
      ['16:00-17:00', 'Biology - Cells', 'Free'],
      ['17:00', 'Physics', ''],
    ]);
    expect(layout).toContain('grid');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ weekday: 0, start: '16:00', end: '17:00', subject: 'Biology', topic: 'Cells' });
    expect(sessions[1]).toMatchObject({ start: '17:00', end: '18:00', subject: 'Physics' });
  });
  it('parses a list timetable with UK dates', () => {
    const { sessions, layout } = parseTimetable([
      ['Date', 'Start', 'End', 'Subject', 'Topic'],
      ['13/10/2026', '9:00', '10:30', 'History', 'Weimar'],
    ]);
    expect(layout).toBe('list');
    expect(sessions[0]).toMatchObject({ date: '2026-10-13', start: '09:00', end: '10:30', subject: 'History', topic: 'Weimar' });
  });
});

describe('templates & answers', () => {
  it('finds cloze ordinals', () => {
    expect(clozeOrds('{{c1::a}} {{c3::b::hint}} {{c1::c}}')).toEqual([1, 3]);
  });
  it('compares typed answers', () => {
    expect(typeCompare('mitochondria', 'mitochondria')).toContain('ta-good');
    expect(typeCompare('mitocondria', 'mitochondria')).toContain('ta-missed');
  });
  it('matches answers leniently', () => {
    expect(answersMatch('Mitochondria.', 'mitochondria')).toBe(true);
    expect(answersMatch('mitocondria', 'mitochondria')).toBe(true);
    expect(answersMatch('nucleus', 'mitochondria')).toBe(false);
  });
});

describe('AI reply parsing', () => {
  it('reads fenced JSON', () => {
    const cards = parseAiReply('Here you go:\n```json\n[{"type":"cloze","front":"","back":"","text":"The {{c1::heart}} pumps blood"},{"type":"basic","front":"Q","back":"A"}]\n```');
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe('cloze');
  });
});

describe('starter decks', () => {
  it('parses the deck format', () => {
    const d = parseStarter('x', '@deck Bio\n@board Board\n# Topic\nQ? :: A ;; **B**\nC: The {{c1::cell}} membrane');
    expect(d.name).toBe('Bio');
    expect(d.notes).toHaveLength(2);
    expect(d.notes[0]).toMatchObject({ deckPath: 'Bio::Topic', back: 'A<br><b>B</b>' });
    expect(d.notes[1].type).toBe('cloze');
  });
});
