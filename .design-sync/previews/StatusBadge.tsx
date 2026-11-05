import { StatusBadge } from '@innovic/web';

export const OrderStates = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <StatusBadge kind="doc" status="draft" />
    <StatusBadge kind="doc" status="pending" />
    <StatusBadge kind="doc" status="approved" />
    <StatusBadge kind="doc" status="completed" />
    <StatusBadge kind="doc" status="cancelled" />
  </div>
);
