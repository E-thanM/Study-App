import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkQuote, cueParts, cueText, extractQuotes, nextStage, pickSession, quoteId, quoteWords, workFromTopic, type Candidate } from '../quotes';
import { parseStarter } from '../starter';

const lit = parseStarter('englishlit', readFileSync(resolve(__dirname, '../../content/englishlit.txt'), 'utf8'));

describe('quote extraction', () => {
  const quotes = extractQuotes(lit.notes);

  it('finds quotes for all three works', () => {
    const works = new Set(quotes.map((q) => q.work));
    expect([...works]).toEqual(['Macbeth', 'An Inspector Calls', 'Of Mice and Men']);
    expect(quotes.length).toBeGreaterThan(50);
  });

  it('reads the text and bracketed source', () => {
    const q = quotes.find((x) => x.text.startsWith('Fair is foul'))!;
    expect(q).toMatchObject({ work: 'Macbeth', text: 'Fair is foul, and foul is fair', source: 'Witches, Act 1 Scene 1' });
    expect(quotes.find((x) => x.text.startsWith("'Cause I'm black"))?.source).toBe('Crooks, Chapter 4');
  });

  it('deduplicates quotes that appear on several cards (even when cut differently)', () => {
    expect(quotes.filter((x) => x.text.startsWith('Fair is foul')).length).toBe(1);
    expect(quotes.filter((x) => x.text.startsWith("Life's but a walking shadow")).length).toBe(1);
    expect(new Set(quotes.map((q) => q.id)).size).toBe(quotes.length);
  });

  it('adds quotes only found on the key-quote cards, without the "(soliloquy)" note', () => {
    expect(quotes.find((x) => x.text.startsWith("Le's do it now"))).toMatchObject({ work: 'Of Mice and Men', source: 'Lennie, Chapter 6' });
    expect(quotes.every((q) => !/soliloquy|"/.test(q.source + q.text))).toBe(true);
  });

  it('skips cards that glue two quotes together', () => {
    expect(quotes.some((x) => x.text.includes('The Germans'))).toBe(false);
  });

  it('gets the work from the topic', () => {
    expect(workFromTopic('An Inspector Calls – points, quotes and analysis')).toBe('An Inspector Calls');
  });

  it('has stable ids that ignore punctuation and case', () => {
    expect(quoteId('Macbeth', 'Fair is foul, and foul is fair')).toBe(quoteId('Macbeth', 'fair is FOUL and foul is fair!'));
    expect(quoteId('Macbeth', 'Fair is foul')).not.toBe(quoteId('Othello', 'Fair is foul'));
  });
});

describe('cues', () => {
  const text = 'Stars, hide your fires; / Let not light see my black and deep desires';

  it('stage 0 shows everything', () => {
    expect(cueText(cueParts(text, 0))).toBe(text);
  });

  it('stage 1 shows first letters and keeps punctuation', () => {
    expect(cueText(cueParts(text, 1))).toBe('S, h y f; / L n l s m b a d d');
    expect(cueText(cueParts("Look like th' innocent flower", 1))).toBe("L l t' i f");
  });

  it('stage 2 hides about half the words, the same way each time for a seed', () => {
    const parts = cueParts(text, 2, 42);
    const words = parts.filter((p) => p.word);
    expect(words.filter((p) => p.show === 'blank').length).toBe(Math.ceil(words.length / 2));
    expect(cueText(cueParts(text, 2, 42))).toBe(cueText(parts));
    expect(parts.find((p) => p.pre === '/')?.show).toBe('full');
  });

  it('stage 3 hides every word', () => {
    expect(cueParts(text, 3).filter((p) => p.word).every((p) => p.show === 'blank')).toBe(true);
  });
});

describe('answer checking', () => {
  const q = "Is this a dagger which I see before me, / The handle toward my hand?";

  it('forgives case, punctuation, curly quotes and spaces', () => {
    expect(checkQuote('is this a dagger which i see before me the handle toward my hand', q).ok).toBe(true);
    expect(checkQuote('  Is this a dagger which I see before me,   The handle toward my hand  ', q).ok).toBe(true);
    expect(checkQuote('Look like th’ innocent flower', "Look like th' innocent flower").ok).toBe(true);
    expect(checkQuote('“Fair is foul and foul is fair”', '"Fair is foul, and foul is fair"').ok).toBe(true);
    expect(checkQuote('this dead butcher and his fiend like queen', 'this dead butcher and his fiend-like queen').ok).toBe(true);
  });

  it('requires every word', () => {
    expect(checkQuote('Is this a dagger I see before me, the handle toward my hand', q).ok).toBe(false);
    expect(checkQuote('', q).ok).toBe(false);
  });

  it('diffs missed, wrong and extra words', () => {
    const r = checkQuote('Fair is bad and foul is very fair', 'Fair is foul, and foul is fair');
    expect(r.ok).toBe(false);
    expect(r.diff).toEqual([
      { kind: 'ok', word: 'Fair' },
      { kind: 'ok', word: 'is' },
      { kind: 'wrong', word: 'foul,', typed: 'bad' },
      { kind: 'ok', word: 'and' },
      { kind: 'ok', word: 'foul' },
      { kind: 'ok', word: 'is' },
      { kind: 'extra', word: 'very' },
      { kind: 'ok', word: 'fair' },
    ]);
    expect(r.mistakes).toBe(2);
    const missed = checkQuote('Out spot! Out, I say!', 'Out, damned spot! Out, I say!');
    expect(missed.diff[1]).toEqual({ kind: 'missed', word: 'damned' });
  });

  it('ignores dashes and ellipses when counting words', () => {
    expect(quoteWords('Girls of that class –')).toEqual(['girls', 'of', 'that', 'class']);
    expect(checkQuote('A guy needs somebody to be near him', 'A guy needs somebody – to be near him …').ok).toBe(true);
  });
});

describe('stages and sessions', () => {
  it('moves up on a right answer and down on a mistake', () => {
    expect(nextStage(0, true)).toBe(1);
    expect(nextStage(4, true)).toBe(4);
    expect(nextStage(2, false)).toBe(1);
    expect(nextStage(0, false)).toBe(0);
  });

  const now = 1_000 * 86_400_000;
  const mk = (id: string, stage: number, isNew: boolean, daysAgo = 1): Candidate => ({ id, stage, isNew, last: isNew ? undefined : now - daysAgo * 86_400_000 });

  it('mixes new and weaker quotes, up to the session size', () => {
    const cands = [...Array.from({ length: 10 }, (_, i) => mk(`n${i}`, 0, true)), mk('l1', 1, false), mk('l2', 3, false), mk('m1', 4, false, 1), mk('m2', 4, false, 30)];
    const ids = pickSession(cands, 10, now);
    expect(ids.length).toBe(10);
    expect(ids).toContain('l1');
    expect(ids).toContain('l2');
    expect(ids).toContain('m2'); // due a review
    expect(ids).not.toContain('m1'); // mastered yesterday – not due yet
    expect(new Set(ids).size).toBe(10);
  });

  it('takes fewer new quotes when lots are half-learnt', () => {
    const cands = [...Array.from({ length: 5 }, (_, i) => mk(`n${i}`, 0, true)), ...Array.from({ length: 12 }, (_, i) => mk(`l${i}`, 1, false))];
    expect(pickSession(cands, 10, now).filter((id) => id.startsWith('n')).length).toBe(2);
  });

  it('still returns something when everything is mastered', () => {
    expect(pickSession([mk('a', 4, false, 1), mk('b', 4, false, 2)], 10, now)).toEqual(['b', 'a']);
  });
});
