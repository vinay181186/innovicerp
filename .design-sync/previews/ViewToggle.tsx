import type { ReactNode } from 'react';
import { StatusPills, ViewToggle } from '@innovic/web';

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>{children}</div>
);

export const ListView = () => (
  <Row>
    <ViewToggle value="list" onChange={() => {}} />
  </Row>
);

export const CardWithExpandAll = () => (
  <Row>
    <ViewToggle value="card" onChange={() => {}} onExpandAll={() => {}} />
  </Row>
);

export const CollapseAll = () => (
  <Row>
    <ViewToggle value="card" expandAll onChange={() => {}} onExpandAll={() => {}} />
  </Row>
);

export const InsideStatusPills = () => (
  <StatusPills
    options={['open', 'closed']}
    onChange={() => {}}
    right={<ViewToggle value="card" onChange={() => {}} onExpandAll={() => {}} />}
  />
);
