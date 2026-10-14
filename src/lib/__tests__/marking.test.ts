import { describe, expect, it } from 'vitest';
import { QUESTION_TYPES, accuracy, markPrompt, median, pickAnchors } from '../marking';
import type { Exemplar } from '../types';

const ex = (id: string, qtype: string, mark: number, outOf = 30): Exemplar => ({ id, kind: 'exemplar', updatedAt: 0, qtype, subject: 'English Literature', question: 'q', answer: 'a', mark, outOf, comment: '', createdAt: 0 });

describe('marking', () => {
  it('takes the median of several markings', () => {
    expect(median([14, 17, 16])).toBe(16);
    expect(median([10, 12])).toBe(11);
  });
  it('anchors with a strong and a weak example of the same question type, never the answer itself', () => {
    const list = [ex('a', '4ET1-drama', 25), ex('b', '4ET1-drama', 12), ex('c', '4ET1-drama', 18), ex('d', '4ET1-heritage', 20)];
    expect(pickAnchors(list, '4ET1-drama', 'English Literature').map((e) => e.id)).toEqual(['a', 'b']);
    expect(pickAnchors(list, '4ET1-drama', 'English Literature', 'a').map((e) => e.id)).toEqual(['c', 'b']);
  });
  it('summarises accuracy and bias', () => {
    const a = accuracy([{ mark: 20, outOf: 30, ai: 22 }, { mark: 10, outOf: 30, ai: 14 }])!;
    expect(a.meanError).toBe(3);
    expect(a.bias).toBe(3);
    expect(a.within10).toBe(0.5);
  });
  it('builds a levels-based prompt with the assessed objectives and anchors', () => {
    const t = QUESTION_TYPES.find((x) => x.id === '4ET1-drama')!;
    const p = markPrompt({ subject: t.subject, board: t.board, question: 'How is Sheila presented?', marks: t.marks, scheme: t.scheme, answer: 'She changes.', anchors: [ex('a', '4ET1-drama', 25)] });
    expect(p).toContain('AO4');
    expect(p).toContain('BEST FIT');
    expect(p).toContain('awarded 25/30');
  });
});
