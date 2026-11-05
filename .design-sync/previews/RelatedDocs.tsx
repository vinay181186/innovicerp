import { RelatedDocs, StatusBadge, Timeline } from '@innovic/web';

const sections = [
  {
    key: 'jc',
    title: 'Job Cards',
    icon: '▭',
    mode: 'documents' as const,
    codeHeading: 'JC No.',
    items: [
      {
        id: 'jc1',
        code: 'IN-JC-00456',
        status: <StatusBadge kind="jc" status="open" />,
        date: '2026-11-03',
        items: [{ pol: '10', code: 'BRKT-101/A', name: 'Mounting Bracket, MS Plate 10 mm' }],
      },
      {
        id: 'jc2',
        code: 'IN-JC-00461',
        status: <StatusBadge kind="jc" status="complete" />,
        date: '2026-11-04',
        items: [{ pol: '20', code: 'SHFT-204/C', name: 'Drive Shaft, EN8 Dia 40' }],
      },
    ],
  },
  {
    key: 'dc',
    title: 'Delivery Challans',
    icon: '🚚',
    mode: 'none' as const,
    codeHeading: 'DC No.',
    labelHeading: 'Vehicle No.',
    items: [
      {
        id: 'dc1',
        code: 'IN-DC-00089',
        label: 'GJ-01-AB-1234',
        status: <StatusBadge kind="dc" status="received" />,
        date: '2026-11-05',
      },
    ],
  },
];

export const JobCards = () => <RelatedDocs sections={sections} />;

export const DeliveryChallans = () => <RelatedDocs sections={sections} activeKey="dc" />;

export const WithTimeline = () => (
  <RelatedDocs sections={sections}>
    <Timeline
      density="compact"
      title="Document Timeline"
      events={[
        { date: '2026-11-03', label: 'SO created', code: 'IN-SO-00123', color: 'var(--blue)' },
        { date: '2026-11-03', label: 'Job Card raised', code: 'IN-JC-00456', color: 'var(--amber)' },
        { date: '2026-11-05', label: 'Dispatched', code: 'IN-DC-00089', color: 'var(--green)' },
      ]}
    />
  </RelatedDocs>
);

export const Nothing = () => <RelatedDocs sections={[]} />;
