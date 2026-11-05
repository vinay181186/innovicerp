import type { ReactNode } from 'react';
import { WorkList } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const MyWork = () => (
  <WorkList
    renderLink={hashLink}
    items={[
      { key: 'nc', severity: 'critical', icon: '⚠️', title: 'NC-0214 awaiting disposition', detail: 'IN-JC-00917 · Pinion Shaft · 4 pcs', age: 5, action: 'Dispose', actionTo: '/nc-register/214' },
      { key: 'po', severity: 'warn', icon: '📄', title: 'IN-PO-00418 waiting for approval', detail: 'Sample Heat Treat Works · 12,400.00', age: 1, action: 'Approve', actionTo: '/purchase-orders/418' },
      { key: 'qc', severity: 'info', icon: '🔬', title: 'IN-GRN-00142 ready for QC', detail: 'BRKT-101/A · Mounting Bracket · 60 pcs', age: 0, action: 'Inspect', actionTo: '/grn/142' },
    ]}
    more={{ label: '3 more items · Show all →' }}
  />
);

export const QueueNoCritical = () => (
  <WorkList
    title="🔬 QC Queue"
    items={[
      { key: 'a', severity: 'info', icon: '🔬', title: 'IN-JC-00917 Final Inspection', detail: 'IN-SO-00123 · BRKT-101/A · 40 pcs', age: 2, action: 'Inspect', onAction: () => {} },
    ]}
  />
);

export const AllCaughtUp = () => <WorkList items={[]} />;
