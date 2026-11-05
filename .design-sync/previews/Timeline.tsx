import { Timeline } from '@innovic/web';

export const SoTimeline = () => (
  <div style={{ width: 520 }}>
    <Timeline
      title="📅 SO Timeline — IN-SO-00123"
      events={[
        {
          date: '2026-11-03',
          label: 'SO Created',
          code: 'IN-SO-00123',
          icon: '📋',
          color: 'var(--blue)',
          detail: 'Sample Engineering Pvt Ltd · 100 pieces of BRKT-101/A',
        },
        {
          date: '2026-11-03 14:35',
          label: 'Job Card Raised',
          code: 'IN-JC-00456',
          icon: '▭',
          color: 'var(--amber)',
          detail: 'Op10 Laser Cutting · Op20 VMC Milling · Op30 Final Inspection',
        },
        {
          date: '2026-11-05',
          label: 'Dispatched',
          code: 'IN-DC-00089',
          icon: '🚚',
          color: 'var(--green)',
          detail: '60 pieces on Vehicle GJ-01-AB-1234',
        },
      ]}
    />
  </div>
);

export const Compact = () => (
  <div style={{ width: 520 }}>
    <Timeline
      density="compact"
      title="Document Timeline"
      events={[
        { date: '2026-11-03', label: 'SO Created', code: 'IN-SO-00123', color: 'var(--blue)' },
        {
          date: '2026-11-04',
          label: 'PO Raised',
          code: 'IN-PO-00217',
          color: 'var(--amber)',
          detail: 'for RM MS Plate 10 mm',
        },
        { date: '2026-11-05', label: 'Dispatched', code: 'IN-DC-00089', color: 'var(--green)' },
      ]}
    />
  </div>
);

export const Cancelled = () => (
  <div style={{ width: 520 }}>
    <Timeline
      events={[
        { date: '2026-10-28', label: 'PO Approved', code: 'IN-PO-00198', icon: '✓', color: 'var(--blue)' },
        {
          date: '2026-10-30',
          label: 'PO Cancelled',
          code: 'IN-PO-00198',
          icon: '✕',
          color: 'var(--red)',
          detail: 'Vendor could not supply within the lead time',
        },
      ]}
    />
  </div>
);

export const NoEvents = () => (
  <div style={{ width: 520 }}>
    <Timeline title="📅 SO Timeline — IN-SO-00124" events={[]} />
  </div>
);
