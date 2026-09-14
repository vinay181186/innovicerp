// Unified GRN inward-type schema (UI-only aggregator).
//
// Canonical source: user-written Unified-Inward spec (option 3 — the legacy
// HTML v82.12.4 reference file is absent, so there are NO HTML line citations;
// every field below is sourced from an EXISTING backend contract, never invented).
//
// Scope decisions confirmed by the user:
//   1. Miscellaneous is DROPPED for now (store-transactions has no create
//      endpoint and the scope forbids new endpoints).
//   2. Job Work Return and NC Return both route to POST /delivery-challans/:id/receive
//      (createDeliveryChallanReceiptInputSchema) — ADR-162 / ADR-163. (Was jw-dc inward.)
//   3. JWSO Inward (customer-supplied material) is NOT part of this unified screen —
//      it is entered on the dedicated Party Material GRN screen (POST /party-grn).
//
// Each member simply tags the existing per-backend create schema with an
// `inwardType` discriminator. The form picks a type, builds the matching
// payload, and api.ts strips `inwardType` before calling the real endpoint.
// This adds NO new fields to any backend and changes NO database schema.

import { z } from 'zod';
import { createDeliveryChallanReceiptInputSchema } from './delivery-challan';
import { createGoodsReceiptNoteInputSchema } from './goods-receipt-note';

/** The GRN Type dropdown on the "+ New GRN" screen (ADR-162 / ADR-163).
 *  - purchase        → Against PO: a buying PO's pending lines.
 *  - job_work_return → Against JWPO / DC: a job-work PO's issued challan.
 *  - nc_return       → Against NC: an NC's return-to-vendor challan.
 *  The last two are the SAME server call (DC receive); they differ only in how
 *  the challan is found. Miscellaneous is deferred; JWSO Inward lives on its own
 *  Party Material GRN screen. */
export const GRN_INWARD_TYPES = ['purchase', 'job_work_return', 'nc_return'] as const;
export type GrnInwardType = (typeof GRN_INWARD_TYPES)[number];

/** Purchase → POST /goods-receipt-notes (goods_receipt_notes). */
export const grnUnifiedPurchaseSchema = createGoodsReceiptNoteInputSchema.extend({
  inwardType: z.literal('purchase'),
});

/** Challan-sourced branches → POST /delivery-challans/:id/receive. The DC id
 *  travels in the URL on the wire; it is carried here so the union is
 *  self-describing. Before ADR-162 the job-work branch pointed at the JW
 *  gate-pass return (jw_dc_inward), which never raised a GRN. */
const _challanReceiveBase = createDeliveryChallanReceiptInputSchema.extend({
  deliveryChallanId: z.string().uuid(),
});
export const grnUnifiedJobWorkReturnSchema = _challanReceiveBase.extend({
  inwardType: z.literal('job_work_return'),
});
export const grnUnifiedNcReturnSchema = _challanReceiveBase.extend({
  inwardType: z.literal('nc_return'),
});

export const grnUnifiedSchema = z.discriminatedUnion('inwardType', [
  grnUnifiedPurchaseSchema,
  grnUnifiedJobWorkReturnSchema,
  grnUnifiedNcReturnSchema,
]);
export type GrnUnifiedInput = z.infer<typeof grnUnifiedSchema>;
