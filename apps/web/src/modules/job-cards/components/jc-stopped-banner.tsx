// ADR-182 — "this Job Card's Production Order was short closed" banner.
//
// A short-closed order is dead: the server refuses every write that touches
// its card — production log, QC log, Incoming QC, GRN, outward DC, customer
// dispatch, NC, rework / recovery child, JC edit and delete. The card itself
// still looks perfectly ordinary, so without this banner the only way to learn
// the work has been stopped is to try something and be refused.
//
// Shaped like the rework / repair banner beside it (jc-recovery-banner.tsx) so
// the two read as one family; red rather than amber because this one is a full
// stop, not a note. Null on every card whose order is live — nothing moves on
// an ordinary Job Card.

import type { ProductionOrderListItem } from '@innovic/shared';
import { isProductionOrderStopped } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

export function JcStoppedBanner({
  order,
}: {
  /** The Production Order that built this card, or null when none did. */
  order: ProductionOrderListItem | null;
}): React.JSX.Element | null {
  if (!order || !isProductionOrderStopped(order.status)) return null;
  const on = order.shortClosedAt ? order.shortClosedAt.slice(0, 10) : null;
  return (
    <div
      style={{
        background: 'var(--red3)',
        border: '1px solid var(--red)',
        borderLeft: '4px solid var(--red)',
        borderRadius: 8,
        padding: '8px 12px',
        marginBottom: 12,
      }}
    >
      <div
        className="fw-700"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          fontSize: 13,
          color: 'var(--red2)',
        }}
      >
        <span>⛔ Production Order</span>
        <Link to="/production-orders/$id" params={{ id: order.id }} className="td-code">
          {order.code}
        </Link>
        <span>was short closed{on ? ` on ${on}` : ''} — no further work</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
        Production entry, QC, NC, outsourcing, dispatch and edits are all refused on this Job Card.
        {order.shortClosedByName ? ` Stopped by ${order.shortClosedByName}.` : ''}
        {order.shortCloseReason ? ` Reason: ${order.shortCloseReason}` : ''}
      </div>
    </div>
  );
}
