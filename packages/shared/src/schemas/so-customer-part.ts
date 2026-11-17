// Customer-supplied BOM child on an Equipment SO (ADR-307).
//
// A BOM line with bomType 'party_supplied' names a Party Supplied Material
// item (`<code>-RM`). The customer sends it; we never plan, buy or value it.
// It is received on a Party GRN against the Equipment SO, QC'd, kept in the
// zero-value party store, issued to the SO's assembly and fitted at Complete.
//
// ONE server function (apps/api/src/lib/party-so-parts.ts) computes these
// figures; the SO parts panel, SO Status, BOM Planning, Assembly Tracker and
// Party GRN create screen all read them from it — never recompute in a screen.

import { z } from 'zod';

/** Done / Part Done / Not Done — the same words as the JWSO Party GRN Status
 *  (ADR-279), from accepted vs need. */
export const customerPartGrnStatusSchema = z.enum(['done', 'part_done', 'not_done']);
export type CustomerPartGrnStatus = z.infer<typeof customerPartGrnStatusSchema>;

export const CUSTOMER_PART_GRN_STATUS_LABEL: Record<CustomerPartGrnStatus, string> = {
  done: 'Done',
  part_done: 'Part Done',
  not_done: 'Not Done',
};

/** Per SO × customer-part figures. All whole pieces. */
export const soCustomerPartFiguresSchema = z.object({
  /** Qty/Set × SO order qty. */
  needQty: z.number().int().nonnegative(),
  /** Σ received on live Party GRN lines of this SO (accepted + deviated + waiting QC). */
  receivedQty: z.number().int().nonnegative(),
  /** Received, not yet inspected. */
  waitingQcQty: z.number().int().nonnegative(),
  /** Accepted at Incoming QC (incl. NC Use As Is). */
  acceptedQty: z.number().int().nonnegative(),
  /** Deviated pieces still held (deviated − returned to customer − used as is). */
  deviatedHeldQty: z.number().int().nonnegative(),
  /** Net issued to this SO's assembly (issued − put back to the customer store). */
  issuedQty: z.number().int().nonnegative(),
  /** Fitted into completed assembly units. */
  fittedQty: z.number().int().nonnegative(),
  /** Good pieces sent back to the customer on a Customer Material Return. */
  returnedQty: z.number().int().nonnegative(),
  /** In the customer store for this SO = accepted − issued − returned. */
  inStoreQty: z.number().int().nonnegative(),
  /** Still to receive: max(0, need − accepted − waitingQc). The Party GRN cap. */
  pendingQty: z.number().int().nonnegative(),
  /** max(0, need − accepted). What the SO is short of. */
  shortQty: z.number().int().nonnegative(),
  partyGrnStatus: customerPartGrnStatusSchema,
});
export type SoCustomerPartFigures = z.infer<typeof soCustomerPartFiguresSchema>;

/** A customer part a Party GRN can receive against one Equipment SO
 *  (GET /party-grn/so-receivable?salesOrderId=). */
export const soReceivablePartSchema = z.object({
  /** The Party Supplied Material item on the BOM line (`<code>-RM`). */
  rmItemId: z.string().uuid(),
  rmItemCode: z.string(),
  rmItemName: z.string(),
  qtyPerSet: z.number().nonnegative(),
  figures: soCustomerPartFiguresSchema,
});
export type SoReceivablePart = z.infer<typeof soReceivablePartSchema>;

/** An open Equipment SO whose BOM has at least one party-supplied child
 *  (the "Against Equipment SO" picker on Party GRN / Customer Material Return). */
export const soWithCustomerPartsSchema = z.object({
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  clientId: z.string().uuid().nullable(),
  clientName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  /** Σ pendingQty across its customer parts — 0 = nothing left to receive. */
  pendingQty: z.number().int().nonnegative(),
});
export type SoWithCustomerParts = z.infer<typeof soWithCustomerPartsSchema>;
