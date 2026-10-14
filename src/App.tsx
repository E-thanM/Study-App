import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav, ScrollToTop, Toasts, isFocusRoute } from './components/ui';
import { Home } from './pages/Home';
import { TimetablePage } from './pages/Timetable';
import { CalendarPage } from './pages/Calendar';
import { SettingsPage } from './pages/Settings';
import { DeckList } from './pages/cards/DeckList';
import { DeckOverview } from './pages/cards/DeckOverview';
import { Review } from './pages/cards/Review';
import { AddNotePage } from './pages/cards/AddNote';
import { Browse } from './pages/cards/Browse';
import { StatsPage } from './pages/cards/Stats';
import { ImportPage } from './pages/cards/Import';
import { NoteTypesPage } from './pages/cards/NoteTypes';
import { SetList } from './pages/quick/SetList';
import { SetView } from './pages/quick/SetView';
import { SetEditor } from './pages/quick/SetEditor';
import { FlashcardsMode } from './pages/quick/Flashcards';
import { LearnMode } from './pages/quick/Learn';
import { TestMode } from './pages/quick/Test';
import { MatchMode } from './pages/quick/Match';
import { SpellMode } from './pages/quick/Spell';
import { ConvertPage } from './pages/quick/Convert';
import { ToolsPage } from './pages/tools/Tools';
import { BlurtPage } from './pages/tools/Blurt';
import { MarkPage } from './pages/tools/Mark';
import { QuotesPage } from './pages/tools/Quotes';
import { PapersPage } from './pages/tools/Papers';
import { PaperViewPage } from './pages/tools/PaperView';
import { StrengthsPage } from './pages/tools/Strengths';

export function App() {
  return (
    <HashRouter>
      <ScrollToTop />
      <Shell />
      <BottomNav />
      <Toasts />
    </HashRouter>
  );
}

function Shell() {
  const { pathname } = useLocation();
  return (
      <div className={`app ${isFocusRoute(pathname) ? 'focus' : 'has-bottomnav'}`}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="/cards" element={<DeckList />} />
          <Route path="/cards/deck/:id" element={<DeckOverview />} />
          <Route path="/cards/review/:id" element={<Review />} />
          <Route path="/cards/add" element={<AddNotePage />} />
          <Route path="/cards/browse" element={<Browse />} />
          <Route path="/cards/stats" element={<StatsPage />} />
          <Route path="/cards/import" element={<ImportPage />} />
          <Route path="/cards/notetypes" element={<NoteTypesPage />} />

          <Route path="/quick" element={<SetList />} />
          <Route path="/quick/new" element={<SetEditor />} />
          <Route path="/quick/:id" element={<SetView />} />
          <Route path="/quick/:id/edit" element={<SetEditor />} />
          <Route path="/quick/:id/flashcards" element={<FlashcardsMode />} />
          <Route path="/quick/:id/learn" element={<LearnMode />} />
          <Route path="/quick/:id/test" element={<TestMode />} />
          <Route path="/quick/:id/match" element={<MatchMode />} />
          <Route path="/quick/:id/spell" element={<SpellMode />} />
          <Route path="/quick/:id/convert" element={<ConvertPage />} />

          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/blurt" element={<BlurtPage />} />
          <Route path="/tools/strengths" element={<StrengthsPage />} />
          <Route path="/tools/mark" element={<MarkPage />} />
          <Route path="/tools/quotes" element={<QuotesPage />} />
          <Route path="/tools/papers" element={<PapersPage />} />
          <Route path="/tools/papers/:id" element={<PaperViewPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>
  );
}
