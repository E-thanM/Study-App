import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckPath } from '../collection';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter } from '../starter';
import { all, clearAll, put } from '../store';

const deck = parseStarter('historyessay', fs.readFileSync('src/content/historyessay.txt', 'utf8'));
const NAME = 'History::Essay evidence (12 & 16 markers)';
const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('History essay evidence deck', () => {
  it('covers the three essay papers (not the Cold War) with unique questions', () => {
    expect(deck.name).toBe(NAME);
    expect(deck.topics).toEqual(['Medicine c1250–present', 'Elizabethan England 1558–88', 'Weimar and Nazi Germany 1918–39']);
    const fronts = deck.notes.map((n) => n.front);
    expect(new Set(fronts).size).toBe(fronts.length);
    expect(deck.notes.length).toBeGreaterThanOrEqual(250);
    expect(deck.notes.some((n) => /Cold War|Truman|Cuba/.test(n.front + n.back))).toBe(false);
  });

  it('gives precise evidence and says what it proves on every card', () => {
    for (const n of deck.notes) {
      const back = plain(n.back);
      expect(back, n.front).toContain('→');
      // a date, number or named person/thing in bold
      expect(n.back, n.front).toMatch(/<b>/);
    }
    // each essay question ends with a judgement card
    for (const s of buildSets(deck)) expect(s.terms.some((t) => t.term.startsWith('Judgement')), s.title).toBe(true);
  });

  it('makes one Quick Learn set per exam question, inside a folder per paper', () => {
    const sets = buildSets(deck);
    expect(sets.length).toBeGreaterThanOrEqual(25);
    for (const s of sets) {
      expect(deck.topics.some((t) => s.title.startsWith(`${t} – `)), s.title).toBe(true);
      expect(s.title).not.toContain(' + ');
    }
  });

  it('is added to Flashcards and Quick Learn under History automatically', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    expect(await autoInstallStarter([deck])).toBeGreaterThan(500);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:historyessay:'))).toHaveLength(deck.notes.length);
    expect(all('deck').map((d) => deckPath(d))).toContain(`${NAME}::Weimar and Nazi Germany 1918–39`);
    expect(all('deck').filter((d) => !d.parentId && d.name === 'History')).toHaveLength(1);
    expect(await autoInstallStarter([deck])).toBe(0);
  });
});
