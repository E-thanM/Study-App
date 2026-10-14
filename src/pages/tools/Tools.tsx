import { Link } from 'react-router-dom';
import { Icon, TopBar } from '../../components/ui';
import { getPlan, phaseOn } from '../../lib/plan';
import { studyToday } from '../../lib/goals';
import { useAll, useRec } from '../../lib/store';

/** Hub for the revision techniques that go beyond flashcards. */
export function ToolsPage() {
  const papers = useAll('paper');
  const blurts = useAll('blurt');
  const quotes = useAll('quote');
  const mistakes = papers.reduce((n, p) => n + p.mistakes.length, 0);
  const mastered = quotes.filter((q) => q.stage >= 4).length;
  useRec('plan', 'plan');
  const phase = phaseOn(getPlan().dates, studyToday());
  const tools = [
    { to: '/tools/plan', icon: 'target', title: 'Study plan', text: 'What to revise today, which resources to use for each subject and topic, and the November tests sprint.', meta: `Phase ${phase.n}: ${phase.name}` },
    { to: '/tools/strengths', icon: 'stats', title: 'Strengths & weaknesses', text: 'Every topic in every subject rated 1–5 from your flashcard results – see exactly what to revise next.', meta: 'Live from your reviews' },
    { to: '/tools/blurt', icon: 'write', title: 'Blurting', text: 'Write everything you remember about a topic, then see exactly what you missed from the spec.', meta: blurts.length ? `${blurts.length} blurt${blurts.length === 1 ? '' : 's'}` : 'Best way to find gaps' },
    { to: '/tools/quotes', icon: 'note', title: 'Quote learner', text: 'Learn English Lit quotes word-perfect: full quote → first letters → from memory.', meta: quotes.length ? `${mastered} mastered` : 'Macbeth · Inspector Calls · Of Mice and Men' },
    { to: '/tools/papers', icon: 'stats', title: 'Past papers', text: 'Log scores, track your predicted grade and keep a mistakes spreadsheet that turns into flashcards.', meta: papers.length ? `${papers.length} paper${papers.length === 1 ? '' : 's'} · ${mistakes} mistakes logged` : 'Track grades over time' },
    { to: '/tools/mark', icon: 'check', title: 'Mark my answer', text: 'Get a long answer (6-markers, essay paragraphs) marked against the mark scheme with AI.', meta: 'Free with Claude.ai, Qwen or OpenRouter' },
  ];
  return (
    <>
      <TopBar crumbs={[{ label: 'Revision tools' }]} />
      <div className="page-head">
        <div>
          <h1>Revision tools</h1>
          <div className="sub">Active recall beyond flashcards – the techniques that pick up the most extra marks.</div>
        </div>
      </div>
      <nav className="tiles">
        {tools.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <Icon name="arrow" className="tile-arrow" />
            <div className="tile-icon"><Icon name={t.icon} /></div>
            <div>
              <h2>{t.title}</h2>
              <p>{t.text}</p>
            </div>
            <div className="tile-meta"><span>{t.meta}</span></div>
          </Link>
        ))}
      </nav>
    </>
  );
}
