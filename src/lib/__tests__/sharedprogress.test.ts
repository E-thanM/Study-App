import { describe, expect, it } from 'vitest';
import { linkedSets, mergeLinkedProgress, shareTermProgress } from '../quicksync';
import { all, get, put } from '../store';
import type { StudySet } from '../types';

const set = (id: string, termIds: string[]): StudySet => ({ id, kind: 'set', updatedAt: 0, title: id, description: '', folder: 'Biology', createdAt: 0, terms: termIds.map((t) => ({ id: t, term: t, definition: t })) });
const prog = (setId: string) => get('setprogress', `prog-${setId}`)?.terms || {};

describe('progress shared between sets with the same card', () => {
  put([
    set('starter-set:biology:main2e', ['t-a', 't-b', 't-c']),
    set('y910-set:2e', ['t-a', 't-b']),
    set('starter-set:chemistry:x', ['t-a']), // another subject: never linked
    set('my-own-set', ['t-a']), // the student's own set: never linked
  ]);

  it('finds the other sets with the card in the same subject only', () => {
    expect(linkedSets('y910-set:2e', 't-a')).toEqual(['starter-set:biology:main2e']);
    expect(linkedSets('my-own-set', 't-a')).toEqual([]);
  });

  it('copies an answer in the Year 9–10 set to the main topic set', () => {
    put({ id: 'prog-y910-set:2e', kind: 'setprogress', setId: 'y910-set:2e', terms: { 't-a': { level: 2, correct: 1, wrong: 0, known: true } } });
    expect(shareTermProgress('y910-set:2e', 't-a')).toBe(1);
    expect(prog('starter-set:biology:main2e')['t-a']).toEqual({ level: 2, correct: 1, wrong: 0, known: true });
    expect(prog('starter-set:chemistry:x')['t-a']).toBeUndefined();
    expect(prog('my-own-set')['t-a']).toBeUndefined();
    // already the same: nothing to write
    expect(shareTermProgress('y910-set:2e', 't-a')).toBe(0);
  });

  it('merges older progress, keeping the fuller record of each card, and keeps saved places', () => {
    put({ id: 'prog-starter-set:biology:main2e', kind: 'setprogress', setId: 'starter-set:biology:main2e',
      terms: { 't-a': { level: 2, correct: 1, wrong: 0, known: true }, 't-b': { level: 3, correct: 4, wrong: 1 } },
      flash: { idx: 2, order: null, round: null, known: [], learning: [], starredOnly: false, front: 'term', track: true, at: 1 } });
    put({ id: 'prog-y910-set:2e', kind: 'setprogress', setId: 'y910-set:2e', terms: { 't-a': { level: 3, correct: 3, wrong: 1 }, 't-b': { level: 1, correct: 0, wrong: 1 } } });
    expect(mergeLinkedProgress()).toBe(2);
    for (const id of ['starter-set:biology:main2e', 'y910-set:2e']) {
      expect(prog(id)['t-a']).toEqual({ level: 3, correct: 3, wrong: 1 });
      expect(prog(id)['t-b']).toEqual({ level: 3, correct: 4, wrong: 1 });
    }
    expect(get('setprogress', 'prog-starter-set:biology:main2e')!.flash?.idx).toBe(2);
    expect(mergeLinkedProgress()).toBe(0);
    expect(all('setprogress').some((p) => p.setId === 'starter-set:chemistry:x')).toBe(false);
  });
});
