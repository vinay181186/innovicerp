// Customer Dispatch edit-diff field definitions (ADR-202, Phase 3).
//
// Shared by BOTH the service (the direct-apply EDIT activity log) and the
// edit-approval registry (the staged diff + drift check), so the two cannot
// drift apart on keys or labels. Kept in its own file — the registry imports
// updateCustomerDispatchTx from service.ts, so the service must not import the
// registry (import cycle); both import these pure field defs instead. Mirrors
// sales-orders/edit-log.ts.

import type { DiffField } from '../../lib/audit-trail';

// Header fields that may be edited. Labels per docs/NAMING.md and the dispatch
// create / edit forms (Dispatch Date · Transporter · Vehicle No. · Remarks).
export const DISPATCH_HEADER_EDIT_FIELDS: readonly DiffField[] = [
  { key: 'dispatchDate', label: 'Dispatch Date' },
  { key: 'transport', label: 'Transporter' },
  { key: 'vehicleNo', label: 'Vehicle No.' },
  { key: 'remarks', label: 'Remarks' },
];

/** The staged-edit change key for one dispatch line's qty — `line:<id>:qty`,
 *  the same shape the PO line diff uses. */
export const dispatchLineQtyKey = (lineId: string): string => `line:${lineId}:qty`;

/** The per-line diff fields for a dispatch's CURRENT lines (one Dispatch Qty
 *  field each), in line order. */
export function dispatchLineDiffFields(
  lines: ReadonlyArray<{ id: string; lineNo: number }>,
): DiffField[] {
  return lines.map((l) => ({
    key: dispatchLineQtyKey(l.id),
    label: `Line ${l.lineNo} · Dispatch Qty`,
  }));
}
