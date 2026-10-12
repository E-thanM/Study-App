# Study

An all-in-one GCSE revision web app that works on Mac, Windows and iPhone, works offline, and syncs between devices through your own free Supabase project.

| | |
|---|---|
| **Revision Timetable** | Import an Excel/CSV timetable (grid or list layout), view it week by week, tick off sessions, add notes, edit, add, or delete sessions. |
| **Long-term Flashcards** | Anki-style spaced repetition: FSRS (Anki's modern scheduler) or SM-2, decks and subject/topic subdecks, note types with editable templates and styling, cloze, type-in-the-answer, reversed cards, images, maths (LaTeX), audio, tags, flags, bury/suspend, leeches, undo, filtered decks and custom study, a card browser with Anki search syntax, stats, and import of Anki `.apkg` files, CSV, text, or Quizlet exports. |
| **GCSE exam decks** | About 1,160 ready-made notes: Edexcel IGCSE Biology, Chemistry, Physics and Computer Science; Edexcel GCSE History; OCR GCSE DT; and Edexcel IGCSE English Literature (quotes with analysis and context for *Macbeth*, *An Inspector Calls* and *Of Mice and Men*). |
| **Quick Learn** | Quizlet-style sets with Flashcards, Learn, Test, Match and Spell. **GCSE topic sets** adds one set per exam-board topic (about 95 sets) for last-minute cramming. Paste from Quizlet. **Make long-term** turns a set into spaced-repetition cards, free through Claude.ai or with one click through the Claude API. |
| **Revision Calendar** | A whole-year view where you set targets, exams and events, tick targets off, and see which you met or missed. |
| **Home** | Streak, hours studied this week against your goal, cards due, and today's sessions. |

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

## Set up sync (Supabase, free)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.
4. In the app, open **Settings → Sync → Show Supabase connection**, paste both values, and save. Then create an account (or sign in) with your email.
5. Do the same on each device and sign in with the same account. Changes sync within a few seconds, and live when more than one device is open.

If you deploy the app yourself, you can bake the URL and key into the build (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, see `.env.example`) so you don't have to paste them on each device. The anon key is safe to expose because row-level security limits each account to its own data.

Under **Authentication → URL Configuration** in Supabase, set the **Site URL** to wherever you host the app so that email confirmation links go back to it.

## Host it for free

Any static host works because the app is plain HTML/JS:

- **GitHub Pages** (public repos): in the repo, go to **Settings → Pages → Source: GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) builds and deploys every push to `main`. You can add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository secrets.
- **Vercel / Netlify / Cloudflare Pages** (these also work with private repos): import the repo, set the build command to `npm run build` and the output directory to `dist`.

Then install it like an app:
- **iPhone:** in Safari, tap Share → **Add to Home Screen**.
- **Mac:** in Safari, choose File → **Add to Dock**.
- **Windows:** in Edge or Chrome, use the install icon in the address bar.

## AI card optimiser (free with Claude Pro)

A Claude Pro subscription doesn't include API access. The app therefore gives you three ways to turn notes or Quick Learn sets into well-formed long-term cards:

1. **Claude.ai (free with Pro):** the app writes the prompt. You paste it into claude.ai and paste the reply back.
2. **Claude API:** for one click, add an API key from console.anthropic.com in Settings. This is pay-as-you-go: a 50-term set costs well under 1p on Haiku and roughly 5–15p on Opus. The key stays on your device.
3. **No AI:** rule-based conversion.

## Keyboard shortcuts (reviewing)

| Key | Action |
|---|---|
| Space / Enter | Show answer, then Good |
| 1 2 3 4 | Again, Hard, Good, Easy |
| E | Edit note |
| I | Card info: review count, next review, stability and more |
| Z or Ctrl+Z | Undo |
| - / = | Bury card / note |
| @ / ! | Suspend card / note |
| Ctrl+1…7 | Flag |
| R | Replay audio |

## How the data is stored

Each item (deck, card, review, set, session, target and so on) is a JSON record. Records live in IndexedDB on each device and are mirrored to a single `records` table in Supabase. Conflicts resolve by last edit wins. Settings → Backup exports everything to one JSON file.

## Project layout

```
src/lib/        data store, sync, schedulers (FSRS/SM-2), Anki templates, search, importers, AI
src/pages/      Home, Timetable, Calendar, Settings, cards/* (Anki), quick/* (Quizlet)
src/content/    GCSE starter decks (plain-text format, see src/lib/starter.ts)
supabase/       database schema
```
