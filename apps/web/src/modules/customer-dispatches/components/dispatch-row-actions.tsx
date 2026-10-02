// Per-row ⋯ menu for the Customer Dispatch FIT table (ADR-199). Carries the
// controls the old DispatchCard had: Print DC (usePrintDc — lazily reads the
// dispatch + client, prints once; the ⋯ stays busy until it has fired),
// Invoice (open the pre-filled Create Invoice form) and Cancel (reverse the
// dispatch, via the caller's CancelDispatchModal). All in the one ⋯ row menu
// (RowActions / RowMenu, owner spec 2026-10-01). A cancelled dispatch was
// reversed — it keeps only View.

import { Link } from '@tanstack/react-router';
import { RowActions } from '@/ui/layout';
import type { RowMenuItem } from '@/ui/data';
import type { CustomerDispatchRow } from '@innovic/shared';
import type { DispatchGroup } from './dispatch-group';
import { usePrintDc } from './use-print-dc';

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
  // Called before the early return so the hook order never changes; it reads
  // nothing until Print DC is picked.
  const printDc = usePrintDc(g.dispatchId);

  // Cancelled dispatch: nothing to print, bill or reverse — just View.
  if (cancelled) {
    return <RowActions viewTo={viewTo} renderLink={(p) => <Link {...p} />} />;
  }

  const items: RowMenuItem[] = [
    { key: 'print', label: 'Print DC', icon: 'printer', onSelect: printDc.start },
  ];
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

  return <RowActions viewTo={viewTo} renderLink={(p) => <Link {...p} />} items={items} />;
}
