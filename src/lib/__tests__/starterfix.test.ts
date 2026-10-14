import { describe, expect, it } from 'vitest';
import { applyFixes, changedCards, installStarter, parseStarter, pendingCards, pendingFixes } from '../starter';
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
});
