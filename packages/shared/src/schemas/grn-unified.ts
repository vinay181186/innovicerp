// Unified GRN inward-type schema (UI-only aggregator).
//
// Canonical source: user-written Unified-Inward spec (option 3 — the legacy
// HTML v82.12.4 reference file is absent, so there are NO HTML line citations;
// every field below is sourced from an EXISTING backend contract, never invented).
//
// Scope decisions confirmed by the user:
//   1. Miscellaneous is DROPPED for now (store-transactions has no create
//      endpoint and the scope forbids new endpoints).
//   2. Job Work Return routes to POST /jw-dc/inward (createJwDcInwardInputSchema).
//   3. JWSO Inward (customer-supplied material) is NOT part of this unified screen —
//      it is entered on the dedicated Party Material GRN screen (POST /party-grn).
//
// Each member simply tags the existing per-backend create schema with an
// `inwardType` discriminator. The form picks a type, builds the matching
// payload, and api.ts strips `inwardType` before calling the real endpoint.
// This adds NO new fields to any backend and changes NO database schema.

import { z } from 'zod';
import { createGoodsReceiptNoteInputSchema } from './goods-receipt-note';
import { createJwDcInwardInputSchema } from './jw-dc';

/** The supported unified-inward types (Miscellaneous deferred; JWSO Inward lives
 *  on its own Party Material GRN screen). */
export const GRN_INWARD_TYPES = ['purchase', 'job_work_return'] as const;
export type GrnInwardType = (typeof GRN_INWARD_TYPES)[number];

/** Purchase → POST /goods-receipt-notes (goods_receipt_notes). */
export const grnUnifiedPurchaseSchema = createGoodsReceiptNoteInputSchema.extend({
  inwardType: z.literal('purchase'),
});

/** Job Work Return → POST /jw-dc/inward (jw_dc_inward). */
export const grnUnifiedJobWorkReturnSchema = createJwDcInwardInputSchema.extend({
  inwardType: z.literal('job_work_return'),
});

export const grnUnifiedSchema = z.discriminatedUnion('inwardType', [
  grnUnifiedPurchaseSchema,
  grnUnifiedJobWorkReturnSchema,
]);
export type GrnUnifiedInput = z.infer<typeof grnUnifiedSchema>;
