// OSP Delivery Challan edit-diff field definitions (ADR-202, Phase 3).
//
// Shared by BOTH the service (the direct-apply EDIT activity log) and the
// edit-approval registry (the staged diff + drift check), so the two cannot
// drift apart on keys or labels. Kept in its own file — the registry imports
// updateDeliveryChallanTx from service.ts, so the service must not import the
// registry (import cycle); both import these pure field defs instead. Mirrors
// customer-dispatches/edit-fields.ts.

import type { DiffField } from '../../lib/audit-trail';

// Header fields that may be edited on an issued OSP DC — the travel details the
// create form also carries (DC Date · Transport · Vehicle No.). The vendor, PO,
// SO link and item set are fixed from the PO selection and are NOT editable.
export const DC_HEADER_EDIT_FIELDS: readonly DiffField[] = [
  { key: 'dcDate', label: 'DC Date' },
  { key: 'transport', label: 'Transport' },
  { key: 'vehicleNo', label: 'Vehicle No.' },
];

/** The staged-edit change key for one DC line's challan qty — `line:<id>:qty`,
 *  the same shape the PO / dispatch line diffs use. Qty is the cascade driver
 *  (jc_ops.outsource_sent_qty), so it is always diffed. */
export const dcLineQtyKey = (lineId: string): string => `line:${lineId}:qty`;
/** The change key for one DC line's material description. */
export const dcLineMaterialKey = (lineId: string): string => `line:${lineId}:material`;
/** The change key for one DC line's DC remarks. */
export const dcLineRemarksKey = (lineId: string): string => `line:${lineId}:remarks`;

/** The per-line diff fields for a DC's CURRENT lines (Challan Qty + Material +
 *  DC Remarks per line), in line order. */
export function dcLineDiffFields(
  lines: ReadonlyArray<{ id: string; lineNo: number }>,
): DiffField[] {
  const out: DiffField[] = [];
  for (const l of lines) {
    out.push({ key: dcLineQtyKey(l.id), label: `Line ${l.lineNo} · Challan Qty` });
    out.push({ key: dcLineMaterialKey(l.id), label: `Line ${l.lineNo} · Material` });
    out.push({ key: dcLineRemarksKey(l.id), label: `Line ${l.lineNo} · DC Remarks` });
  }
  return out;
}
