import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckPath } from '../collection';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, parseStarter, type StarterDeck } from '../starter';
import { all, clearAll, get, put } from '../store';
import { setKnown } from '../../pages/quick/common';

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

  it('makes one Quick Learn set per exam question, plus one set with the whole paper', () => {
    const sets = buildSets(deck);
    const parts = sets.filter((s) => !s.id.includes(':all:'));
    const whole = sets.filter((s) => s.id.includes(':all:'));
    expect(parts.length).toBeGreaterThanOrEqual(25);
    for (const s of parts) {
      expect(deck.topics.some((t) => s.title.startsWith(`${t} – `)), s.title).toBe(true);
      expect(s.title).not.toContain(' + ');
    }
    expect(whole.map((s) => s.title)).toEqual(deck.topics);
    for (const w of whole) {
      const inParts = parts.filter((s) => s.title.startsWith(`${w.title} – `)).flatMap((s) => s.terms.map((t) => t.id));
      expect(w.terms.map((t) => t.id)).toEqual(inParts);
    }
    expect(whole[0].terms.length).toBe(deck.notes.filter((n) => n.topic === deck.topics[0]).length);
  });

  it('shares progress between the whole-paper set and its question sets', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    await autoInstallStarter([deck]);
    const whole = all('set').find((s) => s.id.includes(':all:') && s.title === deck.topics[2])!;
    const term = whole.terms.find((t) => t.term.startsWith('How many Reichstag seats'))!;
    setKnown(whole.id, term.id, true);
    const part = all('set').find((s) => !s.id.includes(':all:') && s.terms.some((t) => t.id === term.id))!;
    expect(get('setprogress', `prog-${part.id}`)?.terms[term.id]?.level).toBeGreaterThan(0);
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

  it('updates an earlier install: question sets numbered in order, progress and cards kept', async () => {
    await clearAll();
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    // the earlier version: no numbers, no whole-paper sets
    const unnumber = (x: string) => x.replace(/^\d+ /, '');
    const v1: StarterDeck = { ...deck, combined: false, notes: deck.notes.map((n) => ({ ...n, sub: unnumber(n.sub), deckPath: n.deckPath.split('::').map(unnumber).join('::') })) };
    await autoInstallStarter([v1]);
    const oldSet = all('set').find((s) => s.title.includes('Why did Hitler become chancellor'))!;
    const term = oldSet.terms[0];
    setKnown(oldSet.id, term.id, true);
    const decksBefore = all('deck').length;

    await autoInstallStarter([deck]);
    const ids = all('set').filter((s) => s.id.startsWith('starter-set:historyessay:')).map((s) => s.id).sort();
    expect(ids).toEqual(buildSets(deck).map((s) => s.id).sort());
    const now = all('set').find((s) => s.title.includes('3 Why did Hitler become chancellor'))!;
    expect(get('setprogress', `prog-${now.id}`)?.terms[term.id]?.level).toBeGreaterThan(0);
    const paths = all('deck').map((d) => deckPath(d));
    expect(paths).toContain(`${NAME}::Medicine c1250–present::1 Medieval: why was there so little progress? (Church, ideas, government)`);
    expect(paths.some((p) => p.endsWith('::Medieval: why was there so little progress? (Church, ideas, government)'))).toBe(false);
    expect(all('deck').length).toBe(decksBefore);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:historyessay:'))).toHaveLength(deck.notes.length);
    expect(await autoInstallStarter([deck])).toBe(0);
  });
});
