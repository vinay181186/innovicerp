// The two tabs under the Purchase Requests header — Purchase Requests and the
// folded-in Outsource Jobs view (UI-only merge).

import { TabStrip } from '@/ui/navigation';

export type PrListTab = 'pr' | 'osp';

export function PrListTabs({
  tab,
  onChange,
}: {
  tab: PrListTab;
  onChange: (t: PrListTab) => void;
}): React.JSX.Element {
  return (
    <TabStrip
      label="Purchase Requests views"
      tabs={[
        { key: 'pr', label: 'Purchase Requests' },
        { key: 'osp', label: 'Outsource Jobs' },
      ]}
      activeKey={tab}
      onChange={(k) => onChange(k === 'osp' ? 'osp' : 'pr')}
    />
  );
}
