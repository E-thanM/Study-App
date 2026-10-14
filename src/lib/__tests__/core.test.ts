import { describe, expect, it } from 'vitest';
import { schedule, parseStep } from '../scheduler';
import { DEFAULT_PRESET } from '../seed';
import { CardState, type Card } from '../types';
import { parseCsv, parseQuizlet, parseTimetable, parseAnkiText } from '../importers';
import { clozeOrds, typeCompare } from '../templates';
import { parseAiReply } from '../ai';
import { parseStarter } from '../starter';
import { answersMatch } from '../util';

const newCard = (): Card => ({
  id: 'c1', kind: 'card', updatedAt: 0, noteId: 'n1', deckId: 'd1', ord: 0, state: CardState.New, due: 0,
  stability: 0, difficulty: 0, ease: 0, scheduledDays: 0, learningStep: 0, reps: 0, lapses: 0, lastReview: null,
  queue: 'normal', flag: 0, position: 1, createdAt: 0,
});

describe('scheduler', () => {
  it('parses steps', () => {
    expect(parseStep('10m')).toBe(10);
    expect(parseStep('1h')).toBe(60);
    expect(parseStep('1d')).toBe(1440);
    expect(parseStep('30s')).toBe(0.5);
  });

  for (const algorithm of ['fsrs', 'sm2'] as const) {
    it(`${algorithm}: again on a new card uses the first learning step`, () => {
      const now = Date.UTC(2026, 9, 1, 12);
      const r = schedule(newCard(), { ...DEFAULT_PRESET, algorithm }, 1, now);
      expect(r.card.state).toBe(CardState.Learning);
      expect(Math.round(r.delayMs / 60000)).toBe(1);
    });
    it(`${algorithm}: intervals grow with Good answers`, () => {
      let c = newCard();
      let t = Date.UTC(2026, 9, 1, 12);
      const p = { ...DEFAULT_PRESET, algorithm };
      const gaps: number[] = [];
      for (let i = 0; i < 6; i++) {
        const r = schedule(c, p, 3, t);
        c = r.card;
        gaps.push(r.delayMs);
        t = c.due;
      }
      expect(c.state).toBe(CardState.Review);
      expect(gaps[5]).toBeGreaterThan(gaps[3]);
    });
    it(`${algorithm}: easy > good > hard > again`, () => {
      const p = { ...DEFAULT_PRESET, algorithm };
      const now = Date.UTC(2026, 9, 10, 12);
      const review: Card = { ...newCard(), state: CardState.Review, stability: 10, difficulty: 5, ease: 2.5, scheduledDays: 10, lastReview: now - 10 * 86400000, due: now, reps: 4 };
      const d = [1, 2, 3, 4].map((r) => schedule(review, p, r as 1 | 2 | 3 | 4, now).delayMs);
      expect(d[0]).toBeLessThan(d[1]);
      expect(d[1]).toBeLessThan(d[2]);
      expect(d[2]).toBeLessThan(d[3]);
    });
  }
});

describe('importers', () => {
  it('parses CSV with quotes', () => {
    expect(parseCsv('a,"b, c",d\n"x ""y""",2,3', ',')).toEqual([['a', 'b, c', 'd'], ['x "y"', '2', '3']]);
  });
  it('parses Quizlet text', () => {
    expect(parseQuizlet('dog\tchien\ncat\tchat', 'tab', 'newline')).toEqual([{ term: 'dog', definition: 'chien' }, { term: 'cat', definition: 'chat' }]);
    expect(parseQuizlet('term,definition\ndog,chien', 'comma', 'newline')).toEqual([{ term: 'dog', definition: 'chien' }]);
    expect(parseQuizlet('a - b;c - d', 'dash', 'semicolon')).toHaveLength(2);
  });
  it('reads Anki text headers', () => {
    const f = parseAnkiText('#separator:tab\n#html:true\n#tags column:3\nfront\tback\ttag1');
    expect(f.rows[0]).toEqual(['front', 'back', 'tag1']);
    expect(f.tagsColumn).toBe(2);
    expect(f.html).toBe(true);
  });
  it('parses a grid timetable', () => {
    const { sessions, layout } = parseTimetable([
      ['Time', 'Monday', 'Tuesday'],
      ['16:00-17:00', 'Biology - Cells', 'Free'],
      ['17:00', 'Physics', ''],
    ]);
    expect(layout).toContain('grid');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ weekday: 0, start: '16:00', end: '17:00', subject: 'Biology', topic: 'Cells' });
    expect(sessions[1]).toMatchObject({ start: '17:00', end: '18:00', subject: 'Physics' });
  });
  it('parses a list timetable with UK dates', () => {
    const { sessions, layout } = parseTimetable([
      ['Date', 'Start', 'End', 'Subject', 'Topic'],
      ['13/10/2026', '9:00', '10:30', 'History', 'Weimar'],
    ]);
    expect(layout).toBe('list');
    expect(sessions[0]).toMatchObject({ date: '2026-10-13', start: '09:00', end: '10:30', subject: 'History', topic: 'Weimar' });
  });
});

describe('templates & answers', () => {
  it('finds cloze ordinals', () => {
    expect(clozeOrds('{{c1::a}} {{c3::b::hint}} {{c1::c}}')).toEqual([1, 3]);
  });
  it('compares typed answers', () => {
    expect(typeCompare('mitochondria', 'mitochondria')).toContain('ta-good');
    expect(typeCompare('mitocondria', 'mitochondria')).toContain('ta-missed');
  });
  it('matches answers leniently', () => {
    expect(answersMatch('Mitochondria.', 'mitochondria')).toBe(true);
    expect(answersMatch('mitocondria', 'mitochondria')).toBe(true);
    expect(answersMatch('nucleus', 'mitochondria')).toBe(false);
  });
});

describe('AI reply parsing', () => {
  it('reads fenced JSON', () => {
    const cards = parseAiReply('Here you go:\n```json\n[{"type":"cloze","front":"","back":"","text":"The {{c1::heart}} pumps blood"},{"type":"basic","front":"Q","back":"A"}]\n```');
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe('cloze');
  });
});

describe('starter decks', () => {
  it('parses the deck format', () => {
    const d = parseStarter('x', '@deck Bio\n@board Board\n# Topic\nQ? :: A ;; **B**\nC: The {{c1::cell}} membrane');
    expect(d.name).toBe('Bio');
    expect(d.notes).toHaveLength(2);
    expect(d.notes[0]).toMatchObject({ deckPath: 'Bio::Topic', back: 'A<br><b>B</b>' });
    expect(d.notes[1].type).toBe('cloze');
  });
});

describe('daily limits', async () => {
  const store = await import('../store');
  const { ensureDeckPath, addNote, buildQueue, answerCard, deckByPath } = await import('../collection');
  const { ensureSeed } = await import('../seed');
  it('counts subdeck reviews against the parent limit', () => {
    ensureSeed();
    store.put({ ...store.get('preset', 'preset-default')!, newPerDay: 3 });
    const a = ensureDeckPath('Sci::A');
    const b = ensureDeckPath('Sci::B');
    for (let i = 0; i < 5; i++) {
      addNote({ noteTypeId: 'nt-basic', deckId: a, fields: { Front: `a${i}`, Back: 'x' } });
      addNote({ noteTypeId: 'nt-basic', deckId: b, fields: { Front: `b${i}`, Back: 'x' } });
    }
    const parent = deckByPath('Sci')!.id;
    expect(buildQueue(parent).new).toHaveLength(3);
    const first = buildQueue(a).new[0];
    answerCard(first, 3, 1000);
    expect(buildQueue(a).new).toHaveLength(2);
    expect(buildQueue(parent).new).toHaveLength(2);
  });
});

describe('bundled content', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(__dirname, '../../..');

  it('parses the built-in revision timetable', () => {
    const text = fs.readFileSync(path.join(root, 'public/revision-timetable.csv'), 'utf8');
    const { sessions, layout } = parseTimetable(parseCsv(text, ','));
    expect(layout).toBe('list');
    expect(sessions).toHaveLength(24);
    const count = (s: string) => sessions.filter((x) => x.subject === s).length;
    expect([count('English Literature'), count('Biology'), count('History')]).toEqual([4, 4, 4]);
    expect([count('Physics'), count('Chemistry'), count('Computer Science'), count('German')]).toEqual([2, 2, 2, 3]);
    expect([count('English Language'), count('Maths'), count('Design & Technology')]).toEqual([1, 1, 1]);
    expect(sessions.some((x) => x.weekday === 4)).toBe(false); // Friday off
    const mins = (d: number) => sessions.filter((x) => x.weekday === d).reduce((m, x) => m + (Number(x.end.slice(0, 2)) * 60 + Number(x.end.slice(3)) - Number(x.start.slice(0, 2)) * 60 - Number(x.start.slice(3))), 0);
    expect([0, 1, 2, 3].map(mins)).toEqual([120, 120, 120, 120]);
    expect([5, 6].map(mins)).toEqual([240, 240]);
  });

  it('every starter deck line parses and fronts are unique', () => {
    const dir = path.join(root, 'src/content');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const deck = parseStarter(f, text);
      const contentLines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('@') && !l.startsWith('#'));
      expect(deck.notes.length, f).toBe(contentLines.length);
      const fronts = deck.notes.map((n) => n.front);
      expect(new Set(fronts).size, `${f} duplicate fronts`).toBe(fronts.length);
      for (const n of deck.notes) if (n.type === 'cloze') expect(n.front, f).toMatch(/\{\{c\d+::/);
    }
  });
});

describe('sync connection helpers', async () => {
  const { normaliseUrl, keyProblem, friendlyAuthError, friendlySyncError } = await import('../sync');
  it('normalises pasted project URLs', () => {
    expect(normaliseUrl('abcd.supabase.co')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl(' https://abcd.supabase.co/ ')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl('https://abcd.supabase.co/rest/v1/')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl('https://abcd.supabase.co/auth/v1/settings')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl('"https://abcd.supabase.co/rest/v1/"')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl('https://abcd.supabase.co/dashboard/anything?x=1#y')).toBe('https://abcd.supabase.co');
    expect(normaliseUrl('https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api')).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(normaliseUrl('http://localhost:54321/rest/v1/')).toBe('http://localhost:54321');
  });
  it('spots wrong keys', () => {
    expect(keyProblem('sb_publishable_abc')).toBeNull();
    expect(keyProblem('sb_secret_abc')).toMatch(/secret key/);
    const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
    expect(keyProblem('eyJ' + jwt('anon').slice(1))).toBeNull();
    expect(keyProblem('eyJ' + jwt('service_role').slice(1))).toMatch(/service_role/);
    expect(keyProblem('hello')).toMatch(/doesn't look like/);
  });
  it('explains common errors', () => {
    expect(friendlyAuthError(new Error('Invalid login credentials'))).toMatch(/Wrong email or password/);
    expect(friendlyAuthError(new Error('Email not confirmed'))).toMatch(/Confirm email/);
    expect(friendlyAuthError(new TypeError('Failed to fetch'))).toMatch(/Couldn't reach Supabase/);
    expect(friendlySyncError('Could not find the function public.push_records(rows) PGRST202')).toMatch(/schema\.sql/);
    expect(friendlyAuthError(new Error('Invalid path specified in request URL'))).toMatch(/extra text on the end/);
  });
});

describe('Quick Learn topic sets', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { buildSets, clozeToTerm, htmlToText, installSets } = await import('../starter');
  const store = await import('../store');
  const dir = path.resolve(__dirname, '../../content');
  const decks = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => parseStarter(f.replace('.txt', ''), fs.readFileSync(path.join(dir, f), 'utf8')));

  it('converts html and cloze text', () => {
    expect(htmlToText('A &amp; B<br><b>C</b> &quot;x&quot;')).toBe('A & B\nC "x"');
    expect(clozeToTerm('The {{c1::heart}} pumps')).toEqual({ term: 'The […] pumps', definition: 'heart' });
    expect(clozeToTerm('{{c1::a}} and {{c2::b::hint}}')).toEqual({ term: '[…] and [hint]', definition: '1. a\n2. b' });
  });

  it('builds sensible sets for every subject', () => {
    let total = 0;
    for (const d of decks.filter((x) => x.notes.length)) {
      const sets = buildSets(d);
      total += sets.length;
      expect(new Set(sets.map((s) => s.id)).size, d.key).toBe(sets.length);
      expect(new Set(sets.map((s) => s.title)).size, `${d.key} titles`).toBe(sets.length);
      for (const s of sets) {
        expect(s.terms.length, `${d.key}: ${s.title}`).toBeGreaterThanOrEqual(6);
        for (const t of s.terms) {
          expect(t.term, s.title).not.toMatch(/\{\{|<\/?b>|<br>|&quot;|&amp;/);
          expect(t.definition, s.title).not.toMatch(/\{\{|<\/?b>|<br>|&quot;|&amp;/);
          expect(t.term.length).toBeGreaterThan(0);
          expect(t.definition.length).toBeGreaterThan(0);
        }
      }
      // nothing is lost: every note ends up in exactly one set
      expect(sets.reduce((n, s) => n + s.terms.length, 0), d.key).toBeLessThanOrEqual(d.notes.length);
      expect(sets.reduce((n, s) => n + s.terms.length, 0), d.key).toBeGreaterThan(d.notes.length * 0.97);
    }
    expect(total).toBeGreaterThan(80);
  });

  it('installs once and keeps user progress when added again', () => {
    const bio = decks.find((d) => d.key === 'biology')!;
    const first = installSets(bio);
    expect(first.sets).toBe(buildSets(bio).length);
    const id = buildSets(bio)[0].id;
    const set = store.get('set', id)!;
    expect(set.folder).toBe('Biology');
    store.put({ ...set, title: 'My renamed set' });
    const again = installSets(bio);
    expect(again).toEqual({ sets: 0, terms: 0, updated: 0 });
    expect(store.get('set', id)!.title).toBe('My renamed set');
    // a term added later in the content is merged into the existing set
    store.put({ ...store.get('set', id)!, terms: store.get('set', id)!.terms.slice(1) });
    expect(installSets(bio)).toMatchObject({ sets: 0, terms: 1, updated: 1 });
  });
});

describe('starter content updates', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { installStarter, pendingCards, markSeen, installSets, pendingSets } = await import('../starter');
  const store = await import('../store');
  const { ensureSeed } = await import('../seed');
  const { deckByPath } = await import('../collection');
  const text = fs.readFileSync(path.resolve(__dirname, '../../content/chemistry.txt'), 'utf8');
  const full = parseStarter('chemistry', text);
  const subset = { ...full, notes: full.notes.slice(0, 40) };

  it('offers only the missing cards after an update, once', () => {
    ensureSeed();
    expect(pendingCards(full)).toBe(0); // never installed -> no banner
    installStarter(subset);
    const top = deckByPath('Chemistry')!;
    expect(top.collapsed).toBe(true);
    // the user expands the deck and picks their own preset
    store.patch('deck', top.id, { collapsed: false, presetId: 'preset-default' });
    // app update: the content has grown, the user hasn't seen the new cards
    store.put({ ...store.get('settings', 'settings')!, starterSig: {} });
    expect(pendingCards(full)).toBe(full.notes.length - 40);
    installStarter(full);
    expect(pendingCards(full)).toBe(0);
    // updates must not undo the user's own choices
    const after = deckByPath('Chemistry')!;
    expect(after.collapsed).toBe(false);
    expect(after.presetId).toBe('preset-default');
  });

  it('does not nag again if cards are deleted, until the content changes', () => {
    const top = deckByPath('Chemistry')!;
    const victims = store.all('note').filter((n) => n.guid?.startsWith('starter:chemistry:')).slice(0, 5);
    store.remove('note', victims.map((n) => n.id));
    expect(pendingCards(full)).toBe(0); // signature matches -> deleted cards stay deleted
    const grown = { ...full, notes: [...full.notes, { ...full.notes[0], front: 'A brand new chemistry question?', back: 'Yes' }] };
    expect(pendingCards(grown)).toBe(6); // 5 deleted + 1 new, offered again because the content changed
    markSeen('cards', grown);
    expect(pendingCards(grown)).toBe(0);
    expect(top).toBeTruthy();
  });

  it('offers new topic-set terms for subjects whose sets were added', () => {
    expect(pendingSets(full)).toBe(0);
    installSets(subset);
    store.put({ ...store.get('settings', 'settings')!, starterSig: {} });
    expect(pendingSets(full)).toBeGreaterThan(0);
    installSets(full);
    expect(pendingSets(full)).toBe(0);
  });
});
