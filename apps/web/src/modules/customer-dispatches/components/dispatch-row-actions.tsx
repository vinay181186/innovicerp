// Per-row actions for the Customer Dispatch FIT table (ADR-199). Reuses the
// three controls the old DispatchCard carried: Print DC (the lazy-loading
// PrintDcButton), Invoice (open the pre-filled Create Invoice form) and Cancel
// (reverse the dispatch, via the caller's CancelDispatchModal).
//
// The stateful PrintDcButton stays a button beside the ⋯; View, Invoice and
// Cancel live in the one ⋯ row menu (RowActions / RowMenu, owner spec
// 2026-10-01). A cancelled dispatch was reversed — it keeps only View.

import { Link } from '@tanstack/react-router';
import { RowActions } from '@/ui/layout';
import type { RowMenuItem } from '@/ui/data';
import type { CustomerDispatchRow } from '@innovic/shared';
import type { DispatchGroup } from './dispatch-group';
import { PrintDcButton } from './print-dc-button';

export function DispatchRowActions(props: {
  g: DispatchGroup;
  /** Undefined while the dispatch list loads — Invoice stays shown. */
  billedStatus?: CustomerDispatchRow['billedStatus'];
  canCancel: boolean;
  cancelPending: boolean;
  onInvoice: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { g } = props;
  const cancelled = g.status === 'cancelled';
  const viewTo = `/customer-dispatches/${g.dispatchId}`;

  // Cancelled dispatch: nothing to print, bill or reverse — just View.
  if (cancelled) {
    return <RowActions viewTo={viewTo} renderLink={(p) => <Link {...p} />} />;
  }

  const items: RowMenuItem[] = [];
  // Fully invoiced — nothing left to bill, so no Invoice entry (card's gate).
  if (props.billedStatus !== 'full') {
    items.push({ key: 'invoice', label: 'Invoice', onSelect: props.onInvoice });
  }
  if (props.canCancel) {
    items.push({
      key: 'cancel',
      label: 'Cancel Dispatch',
      icon: 'x',
      group: 'danger',
      disabledReason: props.cancelPending ? 'Working…' : undefined,
      onSelect: props.onCancel,
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--sp-1)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <PrintDcButton dispatchId={g.dispatchId} />
      <RowActions viewTo={viewTo} renderLink={(p) => <Link {...p} />} items={items} />
    </div>
  );
}
