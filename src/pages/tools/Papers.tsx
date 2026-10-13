import { TopBar } from '../../components/ui';

export function PapersPage() {
  return <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'Papers' }]} />;
}
