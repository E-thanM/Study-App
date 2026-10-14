import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKLIST, NOV_DECK_ID, NOV_TAG, onNovemberTest, syncNovemberSection, testTopics } from '../novtest';
import { DEFAULT_DATES, novemberSchedule, priority } from '../plan';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { installStarter, parseStarter } from '../starter';
import { all, get, put } from '../store';
import { CardState } from '../types';

const bio = parseStarter('biology', fs.readFileSync('src/content/biology.txt', 'utf8'));

describe('November Biology test', () => {
  it('has every checklist statement, each in a real deck topic', () => {
    expect(CHECKLIST).toHaveLength(127);
    for (const [, topic] of CHECKLIST) expect(bio.topics, topic).toContain(topic);
    expect(testTopics()).not.toContain('3b Inheritance');
  });

  it('picks exactly the cards on the checklist', () => {
    const on = bio.notes.filter(onNovemberTest);
    const fronts = on.map((n) => n.front).join('\n');
    expect(on.length).toBeGreaterThan(650);
    expect(on.some((n) => n.topic === '3b Inheritance')).toBe(false);
    expect(fronts).not.toMatch(/stem cell|reflex arc|ciliary|auxin|Dolly|restriction enzyme|selective breeding/i);
    // the partly tested topics keep what is on the checklist
    expect(fronts).toMatch(/Source and effect of ADH/);
    expect(fronts).toMatch(/vasodilation/);
    expect(fronts).toMatch(/fermenter/);
    expect(fronts).toMatch(/yoghurt/);
    // every topic on the test has cards
    for (const t of testTopics()) expect(on.some((n) => n.topic === t), t).toBe(true);
  });

  it('gathers the cards into their own deck and sends them home after the test', async () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    const mini = parseStarter('biology', '@deck Biology\n# 2h Transport\nWhat is plasma? :: The liquid part of blood\n# 3b Inheritance\nWhat is a gene? :: A section of DNA\n');
    installStarter(mini);
    expect(await syncNovemberSection('2026-10-20', '2026-11-03', [mini])).toBe(1);
    const inDeck = all('card').filter((c) => c.deckId === NOV_DECK_ID);
    expect(inDeck).toHaveLength(1);
    expect(get('note', inDeck[0].noteId)!.tags).toContain(NOV_TAG);
    // nothing changes the second time
    const before = inDeck[0].updatedAt;
    await syncNovemberSection('2026-10-20', '2026-11-03', [mini]);
    expect(get('card', inDeck[0].id)!.updatedAt).toBe(before);
    // a reviewed card that went home is pulled back in
    put({ ...get('card', inDeck[0].id)!, deckId: inDeck[0].odid!, odid: undefined, state: CardState.Review });
    await syncNovemberSection('2026-10-21', '2026-11-03', [mini]);
    expect(get('card', inDeck[0].id)!.deckId).toBe(NOV_DECK_ID);
    // after the test: back to Biology, deck gone
    await syncNovemberSection('2026-11-04', '2026-11-03', [mini]);
    expect(all('card').some((c) => c.deckId === NOV_DECK_ID)).toBe(false);
    expect(get('deck', NOV_DECK_ID)).toBeUndefined();
  });

  it('plans topics in priority order, with questions on the day before\'s topic', () => {
    const s = novemberSchedule(DEFAULT_DATES, ['2h Transport', '2c Biological molecules', '3a Reproduction'], '2026-10-14');
    const wed = s.get('2026-10-14')!.main.map((t) => t.text).join('\n');
    expect(wed).toMatch(/2h Transport: blurt/);
    const thu = s.get('2026-10-15')!.main.map((t) => t.text).join('\n');
    expect(thu).toMatch(/2c Biological molecules: blurt/);
    expect(thu).toMatch(/2h Transport: timed topic questions/);
    expect(priority(true, 5, [1, 1])).toBeLessThan(priority(true, 5, [3, 3]));
    expect(priority(false, 1, [3])).toBe(0);
  });
});
