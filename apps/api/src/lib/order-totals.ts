// ADR-243 — tax type + money roll-up for the Sales Order and the Job Work
// Sales Order. ONE place for both modules:
//   decideOrderTax  — on every save: customer's State vs ours → SGST + CGST or
//                     IGST. Unknown State only warns on an order (owner
//                     decision), so forSave is false and it never refuses.
//   orderTotals     — the detail read: Subtotal (non-cancelled lines) →
//                     computeGstTotals (packages/shared lib/gst-totals.ts).
// The browser never sends the tax type.

import { type ServicePoTaxType, type SoTotals, computeGstTotals } from '@innovic/shared';
import type { DbTransaction } from '../db/with-user-context';
import { decideSupply, loadClientForCopy } from './party-copy';

/** History text for a tax type, as the screens name it. */
export function taxTypeText(v: unknown): string | null {
  if (v === 'igst') return 'IGST';
  if (v === 'sgst_cgst') return 'CGST + SGST';
  return null;
}

export interface OrderTax {
  /** Null = the customer's (or our own) State is unknown. */
  taxType: ServicePoTaxType | null;
  placeOfSupply: string | null;
}

/** Tax type + Place of Supply for an order's customer (one client read). */
export async function decideOrderTax(
  tx: DbTransaction,
  companyId: string,
  clientId: string | null | undefined,
): Promise<OrderTax> {
  const client = await loadClientForCopy(tx, clientId, companyId);
  const decision = await decideSupply(tx, companyId, client, { forSave: false });
  return {
    taxType: decision.unknown ? null : decision.taxType,
    placeOfSupply: decision.placeOfSupply,
  };
}

/** The order's totals. Uses the saved tax type; when that is null (order not
 *  saved since 0212, or State unknown) it is worked out live, unknown → null
 *  (figures then come out as SGST + CGST and the screen warns). */
export async function orderTotals(
  tx: DbTransaction,
  companyId: string,
  args: {
    lines: ReadonlyArray<{ orderQty: number | string; rate: string | null; status: string }>;
    gstPercent: string | null;
    taxType: string | null;
    placeOfSupply: string | null;
    clientId: string | null;
  },
): Promise<SoTotals> {
  const sub = args.lines
    .filter((l) => l.status !== 'cancelled')
    .reduce((sum, l) => sum + Number(l.orderQty) * Number(l.rate ?? 0), 0);
  let tax: OrderTax = {
    taxType: args.taxType === 'igst' || args.taxType === 'sgst_cgst' ? args.taxType : null,
    placeOfSupply: args.placeOfSupply,
  };
  if (!tax.taxType && args.clientId) tax = await decideOrderTax(tx, companyId, args.clientId);
  const t = computeGstTotals({
    subtotal: Math.round(sub * 100) / 100,
    gstPercent: Number(args.gstPercent ?? 0),
    taxType: tax.taxType,
  });
  return {
    subtotal: t.subtotal,
    gstPercent: t.gstPercent,
    gstAmount: t.gstTotal,
    taxType: tax.taxType,
    placeOfSupply: tax.placeOfSupply,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    roundOff: t.roundOff,
    grandTotal: t.grandTotal,
  };
}
