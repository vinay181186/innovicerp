import { StatStrip } from '@innovic/web';

export const DashboardCounts = () => (
  <StatStrip
    items={[
      { key: 'open', label: 'Open SOs', count: 42, color: 'var(--blue)' },
      { key: 'due', label: 'Due This Week', count: 9, color: 'var(--amber)', sub: 'next on 07-11-2026' },
      {
        key: 'late',
        label: 'Overdue',
        count: 3,
        color: 'var(--red)',
        sub: <span style={{ color: 'var(--red)' }}>oldest 30-10-2026</span>,
      },
      { key: 'done', label: 'Dispatched', count: 128, color: 'var(--green)' },
    ]}
  />
);

// On dashboards and reports only: a list shows its counts in the Status ▾ filter.
export const ReportFilterOn = () => (
  <StatStrip
    items={[
      { key: 'all', label: 'All Dispatches', count: 180, onClick: () => {} },
      { key: 'ontime', label: 'On Time', count: 142, color: 'var(--green)', active: true, onClick: () => {} },
      { key: 'late', label: 'Late', count: 28, color: 'var(--red)', onClick: () => {} },
      { key: 'short', label: 'Short Closed', count: 10, onClick: () => {} },
    ]}
  />
);

export const Links = () => (
  <StatStrip
    items={[
      { key: 'jc', label: 'Open Job Cards', count: 27, to: '/job-cards' },
      { key: 'qc', label: 'QC Pending', count: 6, color: 'var(--amber)', to: '/qc-call-register' },
      { key: 'value', label: 'Pending Order Value', count: '₹12,40,500.00', to: '/sales-orders' },
    ]}
  />
);
