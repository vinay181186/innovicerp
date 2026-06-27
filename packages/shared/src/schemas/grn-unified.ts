// Unified GRN inward-type schema (UI-only aggregator).
//
// Canonical source: user-written Unified-Inward spec (option 3 — the legacy
// HTML v82.12.4 reference file is absent, so there are NO HTML line citations;
// every field below is sourced from an EXISTING backend contract, never invented).
//
// Scope decisions confirmed by the user:
//   1. Miscellaneous is DROPPED for now (store-transactions has no create
//      endpoint and the scope forbids new endpoints) — 3 types only.
//   2. Job Work Return routes to POST /jw-dc/inward (createJwDcInwardInputSchema).
//   3. JWSO Inward uses the EXISTING party-grn contract (jobWorkOrderId required,
//      lines keyed by partyMaterialId uuid) — no backend change.
//
// Each member simply tags the existing per-backend create schema with an
// `inwardType` discriminator. The form picks a type, builds the matching
// payload, and api.ts strips `inwardType` before calling the real endpoint.
// This adds NO new fields to any backend and changes NO database schema.

import { z } from 'zod';
import { createGoodsReceiptNoteInputSchema } from './goods-receipt-note';
import { createJwDcInwardInputSchema } from './jw-dc';
import { createPartyGrnInputSchema } from './party-grn';

/** The three supported inward types (Miscellaneous deferred — no endpoint). */
export const GRN_INWARD_TYPES = ['purchase', 'job_work_return', 'jwso_inward'] as const;
export type GrnInwardType = (typeof GRN_INWARD_TYPES)[number];

/** Purchase → POST /goods-receipt-notes (goods_receipt_notes). */
export const grnUnifiedPurchaseSchema = createGoodsReceiptNoteInputSchema.extend({
  inwardType: z.literal('purchase'),
});

/** Job Work Return → POST /jw-dc/inward (jw_dc_inward). */
export const grnUnifiedJobWorkReturnSchema = createJwDcInwardInputSchema.extend({
  inwardType: z.literal('job_work_return'),
});

/** JWSO Inward (customer-supplied) → POST /party-grn (party_grn + party_materials.stock_qty). */
export const grnUnifiedJwsoInwardSchema = createPartyGrnInputSchema.extend({
  inwardType: z.literal('jwso_inward'),
});

export const grnUnifiedSchema = z.discriminatedUnion('inwardType', [
  grnUnifiedPurchaseSchema,
  grnUnifiedJobWorkReturnSchema,
  grnUnifiedJwsoInwardSchema,
]);
export type GrnUnifiedInput = z.infer<typeof grnUnifiedSchema>;
