import { PageTabs } from '@innovic/web';

const tabs = [
  { key: '/home', label: 'Home', icon: '🏠', to: '#/home' },
  { key: '/sales-orders', label: 'SO Master', icon: '📋', to: '#/sales-orders' },
  { key: '/job-cards', label: 'Job Cards', icon: '🏭', to: '#/job-cards' },
  { key: '/grn', label: 'GRN', icon: '📦', to: '#/grn' },
];

export const OpenPages = () => <PageTabs tabs={tabs} activeKey="/sales-orders" onSelect={() => {}} onClose={() => {}} />;

export const NotLinked = () => (
  <PageTabs
    tabs={[
      { key: 'planning', label: 'SO Planning', icon: '🗓️' },
      { key: 'qc', label: 'QC Call Register', icon: '🔬' },
    ]}
    activeKey="qc"
    onSelect={() => {}}
    onClose={() => {}}
  />
);

export const FullStrip = () => (
  <PageTabs
    tabs={[
      ...tabs,
      { key: '/po', label: 'PO Master', icon: '🧾', to: '#/po' },
      { key: '/dc', label: 'Delivery Challan', icon: '🚚', to: '#/dc' },
    ]}
    activeKey="/grn"
  />
);
