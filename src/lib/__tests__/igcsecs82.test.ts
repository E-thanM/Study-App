import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckPath } from '../collection';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter } from '../starter';
import { all, clearAll, put } from '../store';

const NAME = 'IGCSE CS 8.2 – Advanced Programming, Databases & Boolean Logic';
const deck = parseStarter('igcsecs82', fs.readFileSync('src/content/igcsecs82.txt', 'utf8'));
const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

describe('IGCSE CS 8.2 deck', () => {
  it('has the requested name, and the cards you wrote as plain question → answer', () => {
    expect(deck.name).toBe(NAME);
    expect(deck.notes).toHaveLength(63);
    expect(deck.notes.every((n) => n.type === 'basic' && n.front && n.back)).toBe(true);
    const front = (q: string) => deck.notes.find((n) => unescape(n.front) === q);
    expect(unescape(front('What is a procedure?')!.back)).toBe('A named set of instructions that performs a task but does NOT return a value. Called using CALL.');
    expect(unescape(front('How do you call a function?')!.back)).toBe('Assign or output it, e.g. Result ← Square(5) or OUTPUT Square(5)');
    expect(unescape(front('SQL to show names of students in 11A, sorted by Surname Z→A')!.back)).toBe("SELECT FirstName, Surname FROM STUDENT WHERE Form = '11A' ORDER BY Surname DESC;");
    expect(unescape(front('How do you get a random whole number from 1 to 6?')!.back)).toBe('ROUND(RANDOM() * 5, 0) + 1');
    expect(unescape(front('Expression: alarm X sounds if door open (A) and armed (B), or window broken (C)')!.back)).toBe('X = (A AND B) OR C');
  });

  it('is split into topics large enough to make their own Quick Learn sets', () => {
    expect(deck.topics).toEqual(['1 Procedures, functions and library routines', '2 File handling and maintainable programs', '3 Databases and SQL', '4 Boolean logic']);
    const sets = buildSets(deck);
    expect(sets).toHaveLength(4);
    expect(sets.map((s) => s.terms.length)).toEqual([21, 12, 17, 13]);
  });

  it('is added once as its own deck, in Flashcards and Quick Learn, and stays removed if deleted', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    expect(await autoInstallStarter([deck])).toBeGreaterThan(100); // cards + terms
    const top = all('deck').find((d) => !d.parentId && d.name === NAME);
    expect(top).toBeTruthy();
    expect(all('deck').map((d) => deckPath(d))).toContain(`${NAME}::4 Boolean logic`);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:igcsecs82:'))).toHaveLength(63);
    const sets = all('set').filter((s) => s.id.startsWith('starter-set:igcsecs82:'));
    expect(sets).toHaveLength(4);
    expect(new Set(sets.map((s) => s.folder))).toEqual(new Set([NAME]));
    expect(await autoInstallStarter([deck])).toBe(0);
  });
});
