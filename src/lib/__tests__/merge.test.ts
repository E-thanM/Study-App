import { describe, expect, it } from 'vitest';
import { addNote, ensureDeckPath, mergeDuplicates } from '../collection';
import { all, put } from '../store';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET } from '../seed';
import { CardState, type Card, type Deck } from '../types';

describe('mergeDuplicates', () => {
  it('merges same-named decks, moves everything and keeps the studied copy of a duplicated note', () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET], { keepUpdatedAt: true });
    // two "Bio" decks, each with a "Cells" subdeck, as if added on two devices
    const a = ensureDeckPath('Bio::Cells');
    const bRoot: Deck = { id: 'dup-root', kind: 'deck', updatedAt: 0, name: 'Bio', parentId: null, presetId: 'preset-default', createdAt: 5 };
    const bCells: Deck = { id: 'dup-cells', kind: 'deck', updatedAt: 0, name: 'cells', parentId: 'dup-root', presetId: 'preset-default', createdAt: 5 };
    put([bRoot, bCells]);
    const n1 = addNote({ noteTypeId: 'nt-basic', deckId: a, fields: { Front: 'q', Back: 'a' }, guid: 'starter:bio:1' })!;
    const n2 = addNote({ noteTypeId: 'nt-basic', deckId: 'dup-cells', fields: { Front: 'q', Back: 'a' }, guid: 'starter:bio:1' })!;
    const only = addNote({ noteTypeId: 'nt-basic', deckId: 'dup-cells', fields: { Front: 'x', Back: 'y' }, guid: 'starter:bio:2' })!;
    // the second copy of note 1 has been studied
    put({ ...(n2.cards[0] as Card), state: CardState.Review, reps: 3 });
    const r = mergeDuplicates();
    expect(r.decks).toBe(2);
    expect(r.notes).toBe(1);
    expect(all('deck').filter((d) => d.name.toLowerCase() === 'bio')).toHaveLength(1);
    expect(all('deck').filter((d) => d.name.toLowerCase() === 'cells')).toHaveLength(1);
    const notes = all('note').filter((n) => n.guid?.startsWith('starter:bio:'));
    expect(notes.map((n) => n.id).sort()).toEqual([n2.note.id, only.note.id].sort());
    const cellsId = all('deck').find((d) => d.name.toLowerCase() === 'cells')!.id;
    expect(all('card').filter((c) => c.deckId === cellsId)).toHaveLength(2);
    expect(mergeDuplicates()).toEqual({ decks: 0, notes: 0 });
    void n1;
  });
});
