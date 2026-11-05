import type { ReactNode } from 'react';
import { AttentionList, Panel } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const NeedsAttention = () => (
  <Panel title="Needs Attention" bodyPadding="none">
    <AttentionList
      renderLink={hashLink}
      items={[
        { key: 'so', icon: '📋', label: '2 SOs overdue', severity: 'critical', to: '/sales-orders' },
        { key: 'nc', icon: '⚠️', label: '4 NCs not disposed', severity: 'warn', to: '/nc-register' },
        { key: 'grn', icon: '📦', label: '3 GRNs waiting for QC', severity: 'info', to: '/grn' },
      ]}
    />
  </Panel>
);

export const AllClear = () => (
  <Panel title="Needs Attention" bodyPadding="none">
    <AttentionList items={[]} />
  </Panel>
);
