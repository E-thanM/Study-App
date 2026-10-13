import { TopBar } from '../../components/ui';

export function PaperViewPage() {
  return <TopBar crumbs={[{ to: '/tools', label: 'Revision tools' }, { label: 'PaperView' }]} />;
}
