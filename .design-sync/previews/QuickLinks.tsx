import type { ReactNode } from 'react';
import { QuickLinks } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const QuickAccess = () => (
  <QuickLinks
    renderLink={hashLink}
    links={[
      { icon: '📋', label: 'SO Master', color: 'var(--dept-sales)', to: '/sales-orders' },
      { icon: '🗓️', label: 'Planning', color: 'var(--dept-planning)', to: '/planning' },
      { icon: '🏭', label: 'Op Entry', color: 'var(--dept-production)', to: '/op-entry' },
      { icon: '🔬', label: 'QC Call Register', color: 'var(--dept-qc)', to: '/qc' },
      { icon: '📦', label: 'GRN', color: 'var(--dept-store)', to: '/grn' },
      { icon: '🧾', label: 'PO Master', color: 'var(--dept-purchase)', to: '/purchase-orders' },
    ]}
  />
);

export const StoreOnly = () => (
  <QuickLinks
    title="🏬 Store"
    links={[
      { icon: '📦', label: 'GRN', color: 'var(--dept-store)', onClick: () => {} },
      { icon: '📤', label: 'Item Issue', color: 'var(--dept-store)', onClick: () => {} },
    ]}
  />
);
