import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter, type StarterDeck } from '../starter';
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

  it('makes one Quick Learn set per section, with no sub-folders', () => {
    const sets = buildSets(deck);
    expect(sets.map((s) => s.title)).toEqual(deck.topics);
    expect(sets.every((s) => s.subject === 'German::Unit 6 topic test')).toBe(true);
    expect(sets[0].terms).toHaveLength(24);
    expect(sets.reduce((a, s) => a + s.terms.length, 0)).toBe(deck.notes.length);
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

  it('replaces the earlier split-up sets with one set per section', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    // the earlier version: each section split into parts
    const split: StarterDeck = { ...deck, notes: deck.notes.map((n, i) => ({ ...n, sub: `Part ${Math.floor(i / 8)}` })) };
    await autoInstallStarter([split]);
    const ids = () => all('set').filter((s) => s.id.startsWith('starter-set:german6:')).map((s) => s.id).sort();
    expect(ids().length).toBeGreaterThan(8);
    await autoInstallStarter([deck]);
    expect(ids()).toEqual(buildSets(deck).map((s) => s.id).sort());
    expect(await autoInstallStarter([deck])).toBe(0);
  });
});
