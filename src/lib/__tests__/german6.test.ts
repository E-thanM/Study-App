import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter } from '../starter';
import { all, clearAll, put } from '../store';

const deck = parseStarter('german6', fs.readFileSync('src/content/german6.txt', 'utf8'));
const text = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('German Unit 6 topic test', () => {
  it('has one topic per section of the vocabulary list, plus time phrases and the conditional', () => {
    expect(deck.name).toBe('German::Unit 6 topic test');
    expect(deck.topics).toEqual([
      '1 Im Urlaub und unterwegs', '2 Wo fahren wir hin?', '3 Wo werden wir wohnen?', '4 Mein schrecklicher Urlaub',
      '5 Wie waren die Schulferien?', '6 Ich möchte um die Welt reisen!', '7 Time phrases',
      '8 Conditional (würde, wäre, hätte, möchte, könnte)',
    ]);
    const fronts = deck.notes.map((n) => n.front);
    expect(new Set(fronts).size).toBe(fronts.length);
    expect(deck.notes.every((n) => n.back.length > 0)).toBe(true);
  });

  it('says what each time phrase does to the verb', () => {
    const time = deck.notes.filter((n) => n.topic === '7 Time phrases');
    expect(time.length).toBeGreaterThanOrEqual(25);
    for (const n of time) expect(text(n.back), n.front).toMatch(/verb|end|after the comma|Time – Manner – Place/);
  });

  it('gives würde, wäre, hätte, möchte and könnte in every person, not just the infinitive', () => {
    const fronts = deck.notes.map((n) => text(n.front));
    for (const f of ['ich würde', 'du würdest', 'er/sie/es würde', 'wir würden', 'ihr würdet', 'sie/Sie würden', 'er würde sich entspannen', 'du wärst', 'ihr hättet', 'wir könnten'])
      expect(fronts, f).toContain(f);
  });

  it('makes Quick Learn sets that each stay within one section', () => {
    const sets = buildSets(deck);
    for (const s of sets) {
      expect(s.subject).toBe('German::Unit 6 topic test');
      expect(s.terms.length).toBeGreaterThanOrEqual(6);
      const topics = new Set(s.terms.map((t) => deck.notes.find((n) => text(n.front) === t.term || n.front === t.term)?.topic).filter(Boolean));
      expect(topics.size, s.title).toBeLessThanOrEqual(1);
    }
  });

  it('is added to Quick Learn only, once, and deleted sets stay deleted', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    expect(await autoInstallStarter([deck])).toBeGreaterThan(200);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:german6:'))).toHaveLength(0);
    const sets = all('set').filter((s) => s.id.startsWith('starter-set:german6:'));
    expect(sets.length).toBe(buildSets(deck).length);
    expect(await autoInstallStarter([deck])).toBe(0);
    put({ id: sets[0].id, kind: 'set', deleted: true } as never);
    expect(await autoInstallStarter([deck])).toBe(0);
    expect(all('set').some((s) => s.id === sets[0].id)).toBe(false);
  });
});
