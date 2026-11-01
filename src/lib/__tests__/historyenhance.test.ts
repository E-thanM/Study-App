import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS } from '../seed';
import { autoInstallStarter, buildSets, installSets, installStarter, parseStarter, type StarterDeck } from '../starter';
import { all, get, put } from '../store';

const history = parseStarter('history', fs.readFileSync('src/content/history.txt', 'utf8'));

/** Cards that explain significance or give a judgement – the ones added from the student's own notes. */
const LABELS = ['Significance:', 'Judgement:', 'Tip:', 'A strong argument:', 'To judge a turning point:'];
const isNew = (n: { back: string }) => LABELS.some((l) => n.back.includes(`<b>${l}</b>`));

describe('History cards from the student\'s notes', () => {
  it('has no repeated fronts, and every card is a question with an answer', () => {
    const fronts = history.notes.map((n) => n.front);
    expect(new Set(fronts).size).toBe(fronts.length);
    for (const n of history.notes) {
      if (n.type !== 'cloze') expect(n.back.length, n.front).toBeGreaterThan(0);
      expect(n.type === 'basic' || n.type === 'reversed' || n.type === 'cloze').toBe(true);
    }
  });

  it('adds significance cards to Medicine, the Western Front, Elizabethan England and Weimar and Nazi Germany', () => {
    const fresh = history.notes.filter(isNew);
    expect(fresh.length).toBeGreaterThanOrEqual(150);
    const count = (topic: RegExp) => fresh.filter((n) => topic.test(n.topic)).length;
    expect(count(/Medicine in Britain/)).toBeGreaterThanOrEqual(40);
    expect(count(/Western Front/)).toBeGreaterThanOrEqual(20);
    expect(count(/Elizabethan/)).toBeGreaterThanOrEqual(30);
    expect(count(/Weimar and Nazi/)).toBeGreaterThanOrEqual(50);
    // the Cold War has not been done yet, so it is left alone
    expect(count(/Cold War/)).toBe(0);
  });

  it('covers each section of the notes', () => {
    const text = history.notes.map((n) => `${n.front} ${n.back}`).join('\n').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    for (const term of [
      // Weimar and Nazi Germany
      'Kiel', 'Scheidemann', 'Article 48', 'Kapp Putsch', 'Rentenmark', 'Locarno', 'Bauhaus', 'Hofbräuhaus', 'Twenty-Five Point', 'Mein Kampf', 'Bamberg', 'Reichstag Fire',
      'Enabling Act', 'Night of the Long Knives', "People's Court", 'Concordat', 'Niemöller', 'Edelweiss', 'Kinder, Küche, Kirche', 'Mother\'s Cross', 'Strength Through Joy', 'Nuremberg Laws', 'Kristallnacht',
      // Medicine and the Western Front
      'Avicenna', 'Melcombe', 'Culpeper', 'Hooke', 'Vesalius', 'Harvey', 'Sydenham', 'Great Stink', 'Jenner', 'Snow', 'Hounsfield', 'Salvarsan', 'Beveridge', 'Clean Air Act',
      'Hill 60', 'Thomas splint', 'Carrel', 'Cambrai', 'anti-tetanus', 'Wipers Times', 'Testament of Youth',
      // Elizabethan England
      'Cecil', 'excommunication', 'Casket Letters', 'Walsingham', 'Babington', 'Davison', 'Nonsuch', 'Cadiz', 'fireships', 'Gravelines', 'Burbage', 'Poor Law', 'Hawkins', 'Golden Hind', 'Roanoke',
    ]) expect(text, term).toContain(term);
  });

  it('gives the Kristallnacht figures consistently', () => {
    const k = history.notes.filter((n) => /Kristallnacht/.test(n.front + n.back)).map((n) => n.back).join('\n');
    expect(k).not.toContain('20 000+');
    expect(k).toContain('30 000');
  });
});

describe('updating an installed History deck', () => {
  it('adds the new cards and Quick Learn terms automatically, but never brings back deleted ones', async () => {
    put([...BUILTIN_NOTETYPES, DEFAULT_PRESET, DEFAULT_SETTINGS], { keepUpdatedAt: true });
    const fresh = history.notes.filter(isNew);
    // the deck as it was before: everything except the new cards
    const v1: StarterDeck = { ...history, notes: history.notes.filter((n) => !isNew(n)) };
    installStarter(v1);
    installSets(v1);
    const histNotes = () => all('note').filter((n) => n.guid?.startsWith('starter:history:'));
    expect(histNotes()).toHaveLength(v1.notes.length);
    const setTerms = () => all('set').filter((s) => s.id.startsWith('starter-set:history:')).reduce((a, s) => a + s.terms.length, 0);
    const before = setTerms();

    // a new card the student installed and then deleted must stay deleted
    const gone = fresh[0];
    installStarter({ ...history, notes: [gone] });
    const goneNote = histNotes().find((n) => n.fields.Front === gone.front)!;
    put({ id: goneNote.id, kind: 'note', deleted: true } as never);
    for (const c of all('card').filter((c) => c.noteId === goneNote.id)) put({ id: c.id, kind: 'card', deleted: true } as never);

    await autoInstallStarter([history]);
    expect(histNotes().length).toBe(history.notes.length - 1);
    expect(histNotes().some((n) => n.fields.Front === gone.front)).toBe(false);
    expect(histNotes().some((n) => n.fields.Front === fresh[1].front)).toBe(true);
    expect(setTerms()).toBeGreaterThan(before + fresh.length - 5);
    // existing cards and their ids are untouched, and a second run does nothing
    expect(get('note', histNotes()[0].id)).toBeTruthy();
    expect(await autoInstallStarter([history])).toBe(0);
  });

  it('keeps Quick Learn sets within the History topics', () => {
    const sets = buildSets(history);
    expect(sets.length).toBeGreaterThan(20);
    for (const s of sets) expect(s.terms.length, s.title).toBeGreaterThan(0);
  });
});
