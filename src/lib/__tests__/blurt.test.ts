import { describe, expect, it } from 'vitest';
import { checkBlurt, stems } from '../blurt';

const notes = [
  { type: 'basic' as const, front: 'What is the function of mitochondria?', back: 'Site of aerobic respiration, releasing energy' },
  { type: 'basic' as const, front: 'What do ribosomes do?', back: 'Protein synthesis' },
  { type: 'cloze' as const, front: 'The {{c1::nucleus}} contains genetic material', back: '' },
];

describe('blurting', () => {
  it('stems words and drops stop words', () => {
    expect(stems('The mitochondria are releasing energy')).toEqual(['mitocho', 'releas', 'energy']);
  });
  it('marks points covered from distinctive words', () => {
    const r = checkBlurt('Mitochondria do aerobic respiration. The nucleus holds DNA.', notes);
    expect(r.map((p) => p.covered)).toEqual([true, false, true]);
  });
});
