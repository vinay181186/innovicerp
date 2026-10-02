// One dispatch document plus the line-grain register rows that belong to it.
// The register endpoint is one row per dispatched item line; the list shows one
// row per dispatch, so the rows are grouped here (was in routes/list.tsx and
// dispatch-card.tsx before the ADR-199 FIT-table conversion).

import type { CustomerDispatchRegisterRow } from '@innovic/shared';

/** One dispatch document plus the register rows that belong to it. */
export type DispatchGroup = {
  dispatchId: string;
  code: string;
  date: string;
  soNo: string | null;
  customer: string | null;
  dispatchedBy: string | null;
  remarks: string | null;
  status: CustomerDispatchRegisterRow['status'];
  lines: CustomerDispatchRegisterRow[];
  totalQty: number;
};

/** Collapse the line-grain register into one group per dispatch, preserving the
 *  order in which the dispatches first appear. */
export function groupByDispatch(rows: CustomerDispatchRegisterRow[]): DispatchGroup[] {
  const groups: DispatchGroup[] = [];
  const byId = new Map<string, DispatchGroup>();
  for (const r of rows) {
    let g = byId.get(r.dispatchId);
    if (!g) {
      g = {
        dispatchId: r.dispatchId,
        code: r.dispatchCode,
        date: r.date,
        soNo: r.soNo,
        customer: r.customer,
        dispatchedBy: r.dispatchedBy,
        remarks: r.remarks,
        status: r.status,
        lines: [],
        totalQty: 0,
      };
      byId.set(r.dispatchId, g);
      groups.push(g);
    }
    g.lines.push(r);
    g.totalQty += r.qty;
  }
  return groups;
}
