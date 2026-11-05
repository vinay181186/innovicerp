import type { ReactNode } from 'react';
import { Panel, StatRow } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const TodayPanel = () => (
  <Panel title="Today">
    <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
      <StatRow icon="📦" label="GRNs received" value={7} to="/grn" renderLink={hashLink} />
      <StatRow icon="⚙️" label="Ops running" value={12} to="/job-cards" renderLink={hashLink} />
      <StatRow icon="🚚" label="Dispatches" value={3} to="/dispatch" renderLink={hashLink} />
    </div>
  </Panel>
);

export const Single = () => <StatRow icon="🔬" label="QC calls waiting" value={5} onClick={() => {}} />;
