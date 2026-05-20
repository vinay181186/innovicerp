// Store txn type → legacy .badge .b-* class (UI-002).
// in=green (stock added) → out=amber (stock removed) → adjust=grey (manual).

import type { StoreTxnType } from '@innovic/shared';

const CLASSES: Record<StoreTxnType, string> = {
  in: 'b-green',
  out: 'b-amber',
  adjust: 'b-grey',
};

export function TxnTypeBadge(props: { type: StoreTxnType }) {
  return <span className={`badge ${CLASSES[props.type]}`}>{props.type}</span>;
}
