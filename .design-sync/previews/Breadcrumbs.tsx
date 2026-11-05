import type { ReactNode } from 'react';
import { Breadcrumbs } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const SoDetail = () => (
  <Breadcrumbs
    renderLink={hashLink}
    crumbs={[
      { label: 'Home', to: '/' },
      { label: 'Sales & CRM', to: '/sales' },
      { label: 'SO Master', to: '/sales-orders' },
      { label: 'IN-SO-00123' },
    ]}
  />
);

export const TwoLevels = () => (
  <Breadcrumbs renderLink={hashLink} crumbs={[{ label: 'Home', to: '/' }, { label: 'Op Entry' }]} />
);

export const SectionWithoutLink = () => (
  <Breadcrumbs
    renderLink={hashLink}
    crumbs={[{ label: 'Home', to: '/' }, { label: 'Store' }, { label: 'GRN', to: '/grn' }, { label: 'Create GRN' }]}
  />
);
