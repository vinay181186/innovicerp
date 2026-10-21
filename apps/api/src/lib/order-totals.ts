// ADR-243 — tax type + money roll-up for the Sales Order and the Job Work
// Sales Order. ONE place for both modules:
//   decideOrderTax  — on every save: customer's State vs ours → SGST + CGST or
//                     IGST. Unknown State only warns on an order (owner
//                     decision), so forSave is false and it never refuses.
//   orderTotals     — the detail read: Subtotal (non-cancelled lines) →
//                     computeGstTotals (packages/shared lib/gst-totals.ts).
// The browser never sends the tax type.

import { and, eq } from 'drizzle-orm';
import {
  type ServicePoTaxType,
  type SoTotals,
  computeGstTotals,
  halfGstRate,
  placeOfSupplyFor,
  taxTypeForSupply,
} from '@innovic/shared';
import { vendors } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { decideSupply, loadClientForCopy, loadCompanyStateCode } from './party-copy';

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

/** The vendor fields a Place of Supply is read from. One vendor read; null
 *  when there is no vendor or no row in this company. */
async function loadVendorSupply(
  tx: DbTransaction,
  companyId: string,
  vendorId: string | null | undefined,
): Promise<{
  stateCode: string | null;
  gstNumber: string | null;
  gstCategory: string | null;
} | null> {
  if (!vendorId) return null;
  const rows = await tx
    .select({
      stateCode: vendors.stateCode,
      gstNumber: vendors.gstNumber,
      gstCategory: vendors.gstCategory,
    })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}

/** ADR-246 — the vendor's Place of Supply only, for DISPLAY on a PO's totals
 *  (one vendor read). Never used to decide a stored PO's tax type. */
export async function vendorPlaceOfSupply(
  tx: DbTransaction,
  companyId: string,
  vendorId: string | null | undefined,
): Promise<string | null> {
  const vendor = await loadVendorSupply(tx, companyId, vendorId);
  return vendor ? placeOfSupplyFor(vendor) : null;
}

/** ADR-246 — the vendor twin of decideOrderTax, for the Purchase Order: the
 *  vendor's Place of Supply (State Code → GSTIN → Overseas 96) vs our own
 *  State. One vendor read. Unknown (vendor or our State blank, or no vendor
 *  row) → taxType null: a PO only warns, it never refuses; the caller then
 *  works the figures out as CGST + SGST. */
export async function decideVendorTax(
  tx: DbTransaction,
  companyId: string,
  vendorId: string | null | undefined,
): Promise<OrderTax> {
  const vendor = await loadVendorSupply(tx, companyId, vendorId);
  if (!vendor) return { taxType: null, placeOfSupply: null };
  const placeOfSupply = placeOfSupplyFor(vendor);
  const companyStateCode = await loadCompanyStateCode(tx, companyId);
  const taxType = taxTypeForSupply({
    placeOfSupply,
    companyStateCode,
    gstCategory: vendor.gstCategory,
  });
  return { taxType, placeOfSupply };
}

/** ADR-246 — the three stored PO percentages for ONE GST %: IGST → all of it
 *  on IGST; CGST + SGST (or unknown, figured as CGST + SGST) → CGST = the half
 *  rounded to 2 dp (halfGstRate), SGST = the rest, so the three always add
 *  back to the GST % exactly (18 → 9 + 9; 0.25 → 0.13 + 0.12). */
export function splitGstPercent(
  gstPercent: number,
  taxType: ServicePoTaxType | null | undefined,
): { sgstPct: number; cgstPct: number; igstPct: number } {
  const gst = Math.round((Number.isFinite(gstPercent) ? gstPercent : 0) * 100) / 100;
  if (taxType === 'igst') return { sgstPct: 0, cgstPct: 0, igstPct: gst };
  const cgst = halfGstRate(gst);
  return { sgstPct: Math.round((gst - cgst) * 100) / 100, cgstPct: cgst, igstPct: 0 };
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
