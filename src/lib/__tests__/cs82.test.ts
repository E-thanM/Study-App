import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter } from '../starter';
import { all, put, remove } from '../store';
import { deckPath } from '../collection';

const cs82 = parseStarter('cs82', fs.readFileSync('src/content/cs82.txt', 'utf8'));
cs82.retired = parseStarter('cs82', fs.readFileSync('src/content/retired/cs82.txt', 'utf8')).notes;

describe('Unit 8.2 Advanced Programming cards', () => {
  it('covers the five assessment topics, all as question → answer cards', () => {
    expect(cs82.name).toBe('Computer Science::Unit 8.2 Advanced Programming');
    expect(cs82.topics).toEqual(['1 Procedures and functions', '2 File handling', '3 Maintainable programs', '4 Boolean logic', '5 Databases and SQL']);
    for (const t of cs82.topics) expect(cs82.notes.filter((n) => n.topic === t).length, t).toBeGreaterThanOrEqual(20);
    // "<>" in SQL must not turn a card into a two-way card
    expect(cs82.notes.every((n) => n.type === 'basic' && n.back.length > 0)).toBe(true);
    // every spec point from the photos has cards
    const text = cs82.notes.map((n) => `${n.front} ${n.back}`).join('\n');
    for (const term of ['DIV', 'MOD', 'ROUND', 'RANDOM', 'local variable', 'global variable', 'OPENFILE', 'READFILE', 'WRITEFILE', 'CLOSEFILE', 'meaningful identifier', 'comment',
      'NAND', 'NOR', 'XOR', 'primary key', 'validation', 'Boolean', 'date/time', 'character', 'ORDER BY', 'DESC', 'ASC', 'SUM', 'COUNT', 'WHERE']) expect(text, term).toContain(term);
  });

  it('has file handling in pseudocode only', () => {
    const files = cs82.notes.filter((n) => n.topic === '2 File handling');
    expect(files.length).toBeGreaterThanOrEqual(25);
    expect(files.map((n) => `${n.front} ${n.back}`).join('\n')).not.toMatch(/python|open\(|readline|\.write\(|int\(/i);
  });

  it('makes Quick Learn sets that each stay within one topic', () => {
    for (const s of buildSets(cs82)) {
      const topics = new Set(s.title.split(' + ').map((part) => part.split(' – ')[0]));
      expect(topics.size, s.title).toBe(1);
    }
  });

  it('is added once inside Computer Science, in Flashcards and Quick Learn, and stays removed if deleted', async () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    const n = await autoInstallStarter([cs82]);
    expect(n).toBeGreaterThan(300); // cards + terms
    const decks = all('deck').map((d) => deckPath(d));
    expect(decks).toContain('Computer Science::Unit 8.2 Advanced Programming::4 Boolean logic::Logic gates');
    const sets = all('set').filter((s) => s.id.startsWith('starter-set:cs82:'));
    expect(sets.length).toBeGreaterThan(5);
    expect(new Set(sets.map((s) => s.folder))).toEqual(new Set(['Computer Science::Unit 8.2 Advanced Programming']));
    expect(await autoInstallStarter([cs82])).toBe(0);
    remove('set', sets.map((s) => s.id));
    expect(await autoInstallStarter([cs82])).toBe(0);
    expect(all('set').some((s) => s.id.startsWith('starter-set:cs82:'))).toBe(false);
  });
});

describe('updating an installed Unit 8.2 section', () => {
  it('swaps the Python file-handling cards for pseudocode ones in Flashcards and Quick Learn', async () => {
    for (const d of all('deck').filter((x) => deckPath(x).startsWith('Computer Science'))) remove('deck', d.id);
    // the first version, as installed on the student's device
    const v1text = fs.readFileSync('src/content/cs82.txt', 'utf8').replace('## More file handling examples (pseudocode)', `## File handling in Python\n${fs.readFileSync('src/content/retired/cs82.txt', 'utf8').split('\n').filter((l) => l.includes(' :: ')).join('\n')}\n## More file handling examples (pseudocode)`);
    const v1 = parseStarter('cs82', v1text);
    v1.notes = v1.notes.filter((n) => n.sub !== 'More file handling examples (pseudocode)');
    const { installStarter, installSets } = await import('../starter');
    installStarter(v1); installSets(v1);
    const pyNotes = () => all('note').filter((n) => n.guid?.startsWith('starter:cs82:') && /Python/.test(n.fields.Front || ''));
    expect(pyNotes().some((n) => /file/i.test(n.fields.Front))).toBe(true);
    expect(all('set').some((s) => s.title.includes('File handling in Python'))).toBe(true);
    // the update
    await autoInstallStarter([cs82]);
    expect(pyNotes().filter((n) => /file/i.test(n.fields.Front))).toHaveLength(0);
    expect(all('note').some((n) => n.fields.Front?.startsWith('Write pseudocode to count how many lines'))).toBe(true);
    expect(all('set').some((s) => s.title.includes('File handling in Python'))).toBe(false);
    expect(all('set').some((s) => s.title.includes('More file handling examples'))).toBe(true);
    const conv = all('note').find((n) => n.fields.Front?.startsWith('Why might a number read from a text file'))!;
    expect(conv.fields.Back).not.toContain('Python');
    // nothing left to do
    expect(await autoInstallStarter([cs82])).toBe(0);
  });
});
