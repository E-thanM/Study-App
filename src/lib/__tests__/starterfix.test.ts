import { describe, expect, it } from 'vitest';
import { applyFixes, applyRetired, changedCards, installStarter, parseStarter, pendingCards, pendingFixes, pendingRetired } from '../starter';
import { all, put } from '../store';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { CardState } from '../types';

describe('improved starter cards', () => {
  it('updates answers and renamed fronts in place, keeping progress', () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    const v1 = parseStarter('lit', '@deck Lit\n# Macbeth – key quotes\n"Fair is foul, and foul is fair: hover through the fog and filthy air" – analyse. :: long\nWho kills Duncan? :: Macbeth');
    installStarter(v1);
    const card = all('card').find((c) => all('note').find((n) => n.id === c.noteId)?.fields.Back === 'long')!;
    put({ ...card, state: CardState.Review, reps: 4 });
    const v2 = parseStarter('lit', '@deck Lit\n@renamed "Fair is foul, and foul is fair: hover through the fog and filthy air" – analyse. => "Fair is foul, and foul is fair" – analyse.\n# Macbeth – key quotes\n"Fair is foul, and foul is fair" – analyse. :: short\nWho kills Duncan? :: Macbeth, in Act 2');
    expect(pendingCards(v2)).toBe(0);
    expect(changedCards(v2)).toHaveLength(2);
    expect(pendingFixes(v2)).toBe(2);
    applyFixes(v2);
    expect(pendingFixes(v2)).toBe(0);
    const notes = all('note').filter((n) => n.guid?.startsWith('starter:lit:'));
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.fields.Back).sort()).toEqual(['Macbeth, in Act 2', 'short']);
    expect(all('card').find((c) => c.id === card.id)?.reps).toBe(4);
    // installing again adds nothing
    expect(installStarter(v2).notes).toBe(0);
  });

  it('retires over-detailed cards, keeps the rest, and tidies empty folders', () => {
    const full = parseStarter('micro', '@deck Micro\n# Bio\n## Yoghurt\nWhich bacterium makes yoghurt? :: Lactobacillus bulgaricus\n## Cells\nWhat is a cell? :: The basic unit of life\n');
    installStarter(full);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:micro:'))).toHaveLength(2);
    const trimmed = parseStarter('micro', '@deck Micro\n# Bio\n## Cells\nWhat is a cell? :: The basic unit of life\n');
    trimmed.retired = parseStarter('micro', '@deck Micro\nWhich bacterium makes yoghurt? :: Lactobacillus bulgaricus\n').notes;
    expect(pendingRetired(trimmed)).toEqual({ total: 1, studied: 0 });
    expect(applyRetired(trimmed)).toBe(1);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:micro:')).map((n) => n.fields.Front)).toEqual(['What is a cell?']);
    expect(all('deck').some((d) => d.name === 'Yoghurt')).toBe(false);
    expect(all('deck').some((d) => d.name === 'Cells')).toBe(true);
    expect(pendingRetired(trimmed).total).toBe(0);
  });

  it('retires the installed older version of a renamed card', () => {
    installStarter(parseStarter('lq', '@deck LQ\n# Q\n"A very long quotation that goes on and on" – analyse. :: x\nKeep me? :: yes'));
    const v2 = parseStarter('lq', '@deck LQ\n@renamed "A very long quotation that goes on and on" – analyse. => "A very long quotation" – analyse.\n# Q\nKeep me? :: yes');
    v2.retired = parseStarter('lq', '"A very long quotation" – analyse. :: x').notes;
    expect(pendingRetired(v2).total).toBe(1);
    applyRetired(v2);
    expect(all('note').filter((n) => n.guid?.startsWith('starter:lq:')).map((n) => n.fields.Front)).toEqual(['Keep me?']);
  });
});
