import { QtyStrip } from '@innovic/web';

export const DocumentCard = () => (
  <QtyStrip
    items={[
      { label: 'TOTAL QTY', value: 100 },
      { label: 'JC QTY', value: 80, color: 'var(--amber)' },
      { label: 'LINES', value: 3 },
    ]}
  />
);

export const Dispatch = () => (
  <QtyStrip
    items={[
      { label: 'ORDER', value: 100 },
      { label: 'DISPATCHED', value: 60, color: 'var(--green)', title: 'Sent on Delivery Challan' },
      { label: 'PENDING', value: 40, color: 'var(--red)' },
    ]}
  />
);

export const MissingFigure = () => (
  <QtyStrip
    items={[
      { label: 'ACCEPTED', value: 12.5 },
      { label: 'REJECTED', value: 0, color: 'var(--red)' },
      { label: 'REWORK', value: null },
    ]}
  />
);
