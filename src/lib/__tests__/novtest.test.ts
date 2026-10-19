import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKLIST, NOV_TAG, Y910_FOLDER, Y910_ID, onNovemberTest, syncNovemberSection, testTopics, topicDeckId, topicSetId } from '../novtest';
import { syncQuickAnswer } from '../quicksync';
import { DEFAULT_DATES, novemberSchedule, priority } from '../plan';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { installStarter, parseStarter } from '../starter';
import { all, get, put, remove } from '../store';
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

  it('puts the test cards in Biology › Year 9–10 test › topic, and in Quick Learn', async () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    const mini = parseStarter('biology', '@deck Biology\n# 2h Transport\nWhat is plasma? :: The liquid part of blood\nWhat do platelets do? :: Help blood clot\n# 2i Excretion\nWhat is urea? :: Waste made from excess amino acids\n# 3b Inheritance\nWhat is a gene? :: A section of DNA\n');
    installStarter(mini);
    // the first version's top-level deck is replaced
    put({ id: 'd-test-november', kind: 'deck', name: 'November test – Biology', parentId: null, presetId: 'default', createdAt: 0, filtered: { search: 'tag:x', limit: 1, order: 'added', reschedule: true } });
    expect(await syncNovemberSection('2026-10-20', '2026-11-03', [mini])).toBe(3);
    expect(get('deck', 'd-test-november')).toBeUndefined();
    const bioRoot = all('deck').find((d) => d.name === 'Biology' && !d.parentId)!;
    expect(get('deck', Y910_ID)!.parentId).toBe(bioRoot.id);
    const transport = get('deck', topicDeckId('2h Transport'))!;
    expect(transport.parentId).toBe(Y910_ID);
    expect(all('card').filter((c) => c.deckId === transport.id)).toHaveLength(2);
    expect(all('card').filter((c) => c.deckId === topicDeckId('2i Excretion'))).toHaveLength(1);
    const gene = all('card').find((c) => get('note', c.noteId)!.fields.Front === 'What is a gene?')!;
    expect(gene.odid).toBeUndefined();
    expect(get('note', gene.noteId)!.tags).not.toContain(NOV_TAG);
    // Quick Learn: one set per topic in the Year 9–10 folder
    const set = get('set', topicSetId('2h Transport'))!;
    expect(set.folder).toBe(Y910_FOLDER);
    expect(set.terms.map((t) => t.term)).toEqual(['What is plasma?', 'What do platelets do?']);
    // nothing changes the second time
    const before = all('card').map((c) => c.updatedAt).join();
    await syncNovemberSection('2026-10-20', '2026-11-03', [mini]);
    expect(all('card').map((c) => c.updatedAt).join()).toBe(before);
    // a reviewed card that went home is pulled back in
    const c0 = all('card').find((c) => c.deckId === transport.id)!;
    put({ ...c0, deckId: c0.odid!, odid: undefined, state: CardState.Review });
    await syncNovemberSection('2026-10-21', '2026-11-03', [mini]);
    expect(get('card', c0.id)!.deckId).toBe(transport.id);
    // after the test: cards back in their topics, folder gone, Quick Learn sets kept
    await syncNovemberSection('2026-11-04', '2026-11-03', [mini]);
    expect(all('card').some((c) => c.odid)).toBe(false);
    expect(get('deck', Y910_ID)).toBeUndefined();
    expect(get('set', topicSetId('2h Transport'))).toBeTruthy();
  });

  it('leaves deleted topic decks and sets deleted', async () => {
    const mini = parseStarter('biology', '@deck Biology\n# 2h Transport\nWhat is plasma? :: The liquid part of blood\nWhat do platelets do? :: Help blood clot\n# 2i Excretion\nWhat is urea? :: Waste made from excess amino acids\n');
    remove('deck', Y910_ID);
    put({ id: Y910_ID, kind: 'deck', name: 'Year 9–10 test', parentId: null, presetId: 'default', createdAt: 0 });
    await syncNovemberSection('2026-10-22', '2026-11-03', [mini]);
    remove('deck', topicDeckId('2i Excretion'));
    remove('set', topicSetId('2i Excretion'));
    await syncNovemberSection('2026-10-22', '2026-11-03', [mini]);
    expect(get('deck', topicDeckId('2i Excretion'))).toBeUndefined();
    expect(get('set', topicSetId('2i Excretion'))).toBeUndefined();
    expect(get('deck', topicDeckId('2h Transport'))).toBeTruthy();
  });

  it('counts Quick Learn answers as long-term reviews, once a day', () => {
    const set = get('set', topicSetId('2h Transport'))!;
    const term = set.terms.find((t) => t.term === 'What do platelets do?')!;
    const card = () => all('card').find((c) => get('note', c.noteId)!.fields.Front === term.term)!;
    const logs = () => all('revlog').filter((l) => l.cardId === card().id);
    const t0 = new Date(2026, 9, 20, 17, 0).getTime();
    expect(card().state).toBe(CardState.New);
    expect(syncQuickAnswer(set.id, term.id, true, t0)).toBe(1);
    expect(card().state).not.toBe(CardState.New);
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ quick: true, rating: 3, timeMs: 0 });
    // the same answer again the same day changes nothing
    expect(syncQuickAnswer(set.id, term.id, true, t0 + 5 * 60_000)).toBe(0);
    // getting it wrong later replaces today's review with "Again"
    expect(syncQuickAnswer(set.id, term.id, false, t0 + 10 * 60_000)).toBe(1);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rating).toBe(1);
    // ...and a miss stays a miss, unless corrected straight away
    expect(syncQuickAnswer(set.id, term.id, true, t0 + 20 * 60_000)).toBe(0);
    // the next day counts again
    expect(syncQuickAnswer(set.id, term.id, true, t0 + 24 * 3600_000)).toBe(1);
    expect(logs()).toHaveLength(2);
    // the student's own sets aren't linked
    expect(syncQuickAnswer('my-set', term.id, true, t0)).toBe(0);
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
