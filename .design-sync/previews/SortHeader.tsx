import { SortHeader } from '@innovic/web';
import { useState } from 'react';

const head = {
  display: 'flex',
  gap: 24,
  padding: '8px 12px',
  background: 'var(--bg4)',
  color: 'var(--blue2)',
  fontWeight: 800,
  fontSize: 11,
  textTransform: 'uppercase',
} as const;

export const Idle = () => (
  <div style={head}>
    <SortHeader label="SO No." />
    <SortHeader label="SO Date" />
    <SortHeader label="Order Qty" />
  </div>
);

export const Ascending = () => (
  <div style={head}>
    <SortHeader label="SO No." active dir="asc" />
    <SortHeader label="SO Date" />
    <SortHeader label="Order Qty" />
  </div>
);

export const Descending = () => (
  <div style={head}>
    <SortHeader label="SO No." />
    <SortHeader label="SO Date" active dir="desc" />
    <SortHeader label="Order Qty" />
  </div>
);

export const ClickToSort = () => {
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  return (
    <div style={head}>
      <SortHeader
        label="Order Qty"
        active
        dir={dir}
        onSort={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
      />
    </div>
  );
};
