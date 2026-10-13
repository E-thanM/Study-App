import { TopBar } from '../../components/ui';

export function QuotesPage() {
  return <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Quotes' }]} />;
}
