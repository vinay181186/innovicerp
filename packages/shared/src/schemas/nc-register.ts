// NC Register shared schemas (T-040a).
//
// Per ADR-017 storage layer; web module is read+create only in T-040a. The
// disposition workflow (rework/scrap/use-as-is/return-to-vendor/make-fresh)
// with its service-layer cascades on jc_ops.reworkQty / op_log / supplementary
// JC creation lands in T-040b — those write paths are deliberately NOT in this
// input schema. Update + softDelete are exposed but block once status leaves
// pending (the disposition path owns those transitions).
//
// Three shapes:
//   - read: NcRegister (table row); NcRegisterListItem joins jcCode +
//     jcOpSeq + jcOpOperation + itemCode + itemName for the list view.
//   - write: createNcRegisterInputSchema (manual NC entry — Report NC button
//     in legacy line 22551). Requires jc + item link (FKs are NOT NULL); op_seq
//     + jc_op are optional because legacy lets the form skip them.
//   - query: list filters (search, status, reason, jc, date range).

import { z } from 'zod';
import { queryBoolean } from '../lib/query-boolean';
import { positiveQtyCoerceSchema } from '../lib/qty-rule';
import { type NcDisposition, NC_DISPOSITIONS } from '../enums/nc-disposition';
import { NC_REASON_CATEGORIES } from '../enums/nc-reason-category';
import { type NcStatus, NC_STATUSES } from '../enums/nc-status';
import { sfRawParamSchema } from './list-query';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';

export const ncStatusSchema = z.enum(NC_STATUSES);
export const ncDispositionSchema = z.enum(NC_DISPOSITIONS);
export const ncReasonCategorySchema = z.enum(NC_REASON_CATEGORIES);

const codeRegex = /^[A-Za-z0-9._/-]+$/;

// ─── Read shapes ───────────────────────────────────────────────────────────

export const ncRegisterSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  ncDate: z.string(), // ISO date
  /** ADR-189 — null for a bought-material reject raised by Incoming QC on a
   *  GRN line that no job card stands behind (grnLineId is set instead). */
  jobCardId: z.string().uuid().nullable(),
  jcOpId: z.string().uuid().nullable(),
  opSeq: z.number().int().nullable(),
  operationText: z.string().nullable(),
  qcOperationText: z.string().nullable(),
  itemId: z.string().uuid(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  // Live item master values resolved via LEFT JOIN on items (null if the item
  // was deleted). Prefer these over the *Text snapshot columns for display.
  itemCode: z.string().nullable(),
  /** The customer's drawing revision the rejected part was made to, read off
   *  the SO line behind this NC's job card (job_cards.source_so_line_id →
   *  sales_order_lines.revision). It is a display-only join, exactly like
   *  itemCode above: it is never written to the NC and never appended to
   *  itemCodeText, which is the durable snapshot of what the reporter typed.
   *  Null when the card has no SO line behind it (JW-sourced or standalone, or
   *  an SO line since deleted), and null renders as the bare item code. Never
   *  items.revision, a different column about the item master — a wrong
   *  revision on a rejection record is worse than no revision at all. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a stock-replenishment purchase, a vendor
   *  return, a line whose SO line was deleted). Read-only: the Sales Order is
   *  the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  /** The Sales Order this NC belongs to (0184 — was linked by code text only).
   *  Read `soId ?? soCodeText`: soCodeText stays as the snapshot. */
  soId: z.string().uuid().nullable().default(null),
  soCodeText: z.string().nullable(),
  /** ADR-207: the SO's Internal SO No., read live off sales_orders (soId). */
  soInternalNo: z.string().nullable().default(null),
  machineCodeText: z.string().nullable(),
  operatorText: z.string().nullable(),
  rejectedQty: z.string(), // numeric stored as string
  reasonCategory: ncReasonCategorySchema,
  reason: z.string().nullable(),
  disposition: ncDispositionSchema.nullable(),
  dispositionDate: z.string().nullable(),
  dispositionByText: z.string().nullable(),
  dispositionRemarks: z.string().nullable(),
  reworkJcCodeText: z.string().nullable(),
  reworkOpSeq: z.number().int().nullable(),
  reworkDoneQty: z.string().nullable(),
  // ── QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §3) ──────────────────
  /** The op_log inspection row that raised this NC; null on hand-entered NCs
   *  and on rows older than the column. */
  qcLogId: z.string().uuid().nullable().default(null),
  /** The GRN line for an Incoming-QC-raised NC. */
  grnLineId: z.string().uuid().nullable().default(null),
  /** SOURCE of the rejected material, derived on read (Tier A) so the NC and its
   *  return-to-vendor challan show — and default to — the ACTUAL supplier, not a
   *  free-typed one. Resolved from grnLineId → GRN vendor, or the origin op's
   *  outsource PO line vendor. Null for a pure in-house reject (no vendor). */
  sourceVendorId: z.string().uuid().nullable().default(null),
  sourceVendorCode: z.string().nullable().default(null),
  sourceVendorName: z.string().nullable().default(null),
  sourcePoCode: z.string().nullable().default(null),
  sourceGrnCode: z.string().nullable().default(null),
  /** ADR-217 — the outward challan the rejected pieces went out on, so a
   *  return can be found by the number the STORE holds rather than the NC
   *  number QC holds.
   *
   *  Stored (`nc_register.source_delivery_challan_id`), not derived. There is no
   *  piece, lot or batch tracking in this system, so for an NC raised at the
   *  machine no query can say which of an order's challans carried the piece —
   *  only the person who packed it can. Null is a correct answer: nothing went
   *  out, or nobody could say. */
  sourceDeliveryChallanId: z.string().uuid().nullable().default(null),
  sourceDeliveryChallanCode: z.string().nullable().default(null),
  /** The job-work order the deviated pieces were made under — the SAME order
   *  the return challan goes back against. Same names as RtvCandidate carries,
   *  so the two agree. Needed because choosing a deviation on +New DC must fill
   *  its order in by itself: the NC already knows it, so asking again is asking
   *  twice. Null on a deviation with no purchase order behind it (an in-house
   *  op, or bought material with no PO line). NOT the replacement order — that
   *  is `replacementPoCode` (ADR-217), a different document. */
  purchaseOrderId: z.string().uuid().nullable().default(null),
  poCode: z.string().nullable().default(null),
  /** ADR-217 — the zero-value job-work order this return raised, created with
   *  the disposition. Null on every NC disposed before ADR-217, and on every
   *  disposition that is not a return to vendor. */
  replacementPoId: z.string().uuid().nullable().default(null),
  replacementPoCode: z.string().nullable().default(null),
  /** Sibling link: set on the remainder row when a disposition covered less
   *  than the full rejected qty. */
  splitFromNcId: z.string().uuid().nullable().default(null),
  /** The NC whose return-to-vendor REPLACEMENT this NC was raised on (ADR-167,
   *  migration 0129). Incoming QC rejects a replacement piece → the new NC
   *  carries that piece and points here, so a chain NC-A → NC-B → NC-C is
   *  readable from the register instead of only through GRN headers. Null on
   *  a first-cycle NC. */
  parentNcId: z.string().uuid().nullable().default(null),
  parentNcCode: z.string().nullable().default(null),
  /** The rework / repair child job card, once raised. */
  childJobCardId: z.string().uuid().nullable().default(null),
  childJobCardCode: z.string().nullable().default(null),
  /** The return-to-vendor delivery challan, once issued. */
  deliveryChallanId: z.string().uuid().nullable().default(null),
  deliveryChallanCode: z.string().nullable().default(null),
  /** Qty on the RTV challan (must equal the DC line — interlock 4). */
  rtvSentQty: z.string().default('0'),
  /** Qty received back from the vendor so far. */
  rtvReceivedQty: z.string().default('0'),
  /** Qty QC-ACCEPTED after recovery (child JC terminal QC, or Incoming QC on
   *  the replacement). Re-injected into the parent route. */
  clearedQty: z.string().default('0'),
  /** Qty QC-REJECTED after recovery; a follow-on NC exists for it. */
  failedQty: z.string().default('0'),
  closedAt: z.string().nullable().default(null),
  closedBy: z.string().uuid().nullable().default(null),
  /** Server-computed: rejected − cleared − failed. The number every gate uses. */
  openQty: z.string().default('0'),
  /** Server-computed: why the NC cannot close right now, or null when it can.
   *  Shown verbatim next to the Close button so the operator knows what is
   *  still outstanding rather than being refused with a generic message. */
  closeBlockedReason: z.string().nullable().default(null),
  scrapCost: z.string().nullable(), // NULL when the viewer's access hides prices
  status: ncStatusSchema,
  reportedByText: z.string().nullable(),
  timeLogged: z.string().nullable(),
  // Cross-reference: code of the CAPA whose ncRefs contains this NC's code
  // (legacy `_capaForNC`, HTML L22758). null = no CAPA links this NC yet.
  linkedCapaCode: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type NcRegister = z.infer<typeof ncRegisterSchema>;

export const ncRegisterListItemSchema = ncRegisterSchema.extend({
  jcCode: z.string().nullable(),
  jcOpSeqResolved: z.number().int().nullable(),
  jcOpOperation: z.string().nullable(),
  // itemCode / itemName now live on the base ncRegisterSchema (LEFT JOIN items).
});
export type NcRegisterListItem = z.infer<typeof ncRegisterListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createNcRegisterInputSchema = z.object({
  // NC No. is optional: blank (or omitted) means the server assigns the next
  // number from the company's NC series (NC-#####), like an ERPNext naming
  // series. A code that IS sent is kept, subject to the duplicate check.
  code: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen')
      .optional(),
  ),
  ncDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ncDate must be YYYY-MM-DD'),
  jobCardId: z.string().uuid(),
  jcOpId: z.string().uuid().optional(),
  opSeq: z.number().int().optional(),
  operationText: z.string().max(255).optional(),
  qcOperationText: z.string().max(255).optional(),
  itemId: z.string().uuid(),
  itemNameText: z.string().max(255).optional(),
  /** The SO picked on the form (0184). When given, the server stores its code
   *  as soCodeText; when only soCodeText comes, the server links it if the code
   *  names exactly one live SO. */
  soId: z.string().uuid().optional(),
  soCodeText: z.string().max(64).optional(),
  machineCodeText: z.string().max(64).optional(),
  operatorText: z.string().max(255).optional(),
  /** Up to 3 decimals, like the GRN / QC qty it comes from (numeric(14,3),
   *  0184 — S9). A whole-number unit is refused a fraction by the API. */
  rejectedQty: positiveQtyCoerceSchema,
  reasonCategory: ncReasonCategorySchema.default('other'),
  // Defect/problem description is REQUIRED for manual NC entry (legacy
  // `_addManualNC` validates this — HTML L22591). Auto-NCs from QC keep it
  // optional at the DB level, but the Report-NC form enforces it here.
  reason: z.string().min(1, 'Defect/problem description is required').max(2000),
  reportedByText: z.string().max(255).optional(),
});
export type CreateNcRegisterInput = z.infer<typeof createNcRegisterInputSchema>;

// UPDATE — narrow set. Disposition + cascade fields are NOT here per ADR-017
// #7; T-040b owns that path via disposeNcInputSchema. `code` is immutable.
export const updateNcRegisterInputSchema = z.object({
  /** §20.4 — the version this form loaded; a save over someone else's newer
   *  edit is refused 409 `edit_conflict` (ADR-225). */
  expectedUpdatedAt: expectedUpdatedAtSchema,
  ncDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'ncDate must be YYYY-MM-DD')
    .optional(),
  reasonCategory: ncReasonCategorySchema.optional(),
  reason: z.string().max(2000).optional(),
  reportedByText: z.string().max(255).optional(),
  operatorText: z.string().max(255).optional(),
});
export type UpdateNcRegisterInput = z.infer<typeof updateNcRegisterInputSchema>;

// DISPOSE (T-040b) — service-layer action with cascades. Mirrors the legacy
// `_disposeNC` modal options (line 22633). Per-action constraints enforced
// by the service: `rework` needs reworkOpSeq present (or NC.opSeq set),
// `scrap` accepts scrapCost, others ignore the optional fields.
export const disposeNcInputSchema = z.object({
  action: ncDispositionSchema,
  /** How many of the NC's rejected pieces this disposition covers (design §3,
   *  interlock 2). Omitted = all of them. Less than all splits the remainder
   *  into a sibling NC that stays pending. Never more than the open qty.
   *  Up to 3 decimals (S9); whole pieces for a NOS / SET item and for a
   *  rework / repair (it raises a job card in pieces) — checked by the API. */
  qty: positiveQtyCoerceSchema.optional(),
  remarks: z.string().max(2000).optional(),
  /** Legacy in-route rework only; a new `rework` disposition raises a child
   *  job card and ignores this. Kept so old clients do not break. */
  reworkOpSeq: z.number().int().positive().optional(),
  scrapCost: z.coerce.number().nonnegative().optional(),
  /** ADR-217 — which OUTWARD challan the rejected pieces went out on, for a
   *  `return_to_vendor` disposition. Stored on `nc_register`, never derived:
   *  this system has no piece, lot or batch tracking, so when the order has more
   *  than one challan NO query can say which one carried these pieces — only
   *  the person who packed them. The screen asks when there is a choice, fills
   *  itself when there is exactly one candidate, and omits this when there is
   *  none. Ignored by every other disposition. */
  sourceDeliveryChallanId: z.string().uuid().optional(),
});
export type DisposeNcInput = z.infer<typeof disposeNcInputSchema>;

/** Result of a disposition: the NC as it now stands, plus what was raised. */
export const disposeNcResultSchema = z.object({
  nc: ncRegisterSchema,
  /** The sibling that holds the undispositioned remainder, when qty < open. */
  remainderNc: ncRegisterSchema.nullable(),
  /** The rework / repair child job card, when one was raised. */
  childJobCardId: z.string().uuid().nullable(),
  childJobCardCode: z.string().nullable(),
});
export type DisposeNcResult = z.infer<typeof disposeNcResultSchema>;

// CREATE DC — the return-to-vendor challan, raised from the NC itself (design
// §5). No purchase order is involved: the NC is the reference.
export const createNcDcInputSchema = z.object({
  dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendorId: z.string().uuid().nullable().optional(),
  vendorCodeText: z.string().trim().min(1),
  transport: z.string().trim().max(200).nullable().optional(),
  vehicleNo: z.string().trim().max(50).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type CreateNcDcInput = z.infer<typeof createNcDcInputSchema>;

export const createNcDcResultSchema = z.object({
  nc: ncRegisterSchema,
  deliveryChallanId: z.string().uuid(),
  deliveryChallanCode: z.string(),
});
export type CreateNcDcResult = z.infer<typeof createNcDcResultSchema>;

// CLOSE-REWORK (T-040b) — flips `disposed`+rework → `closed` after rework
// is complete. Optionally captures rework_done_qty for the audit record.
export const closeNcReworkInputSchema = z.object({
  reworkDoneQty: z.coerce.number().nonnegative().optional(),
});
export type CloseNcReworkInput = z.infer<typeof closeNcReworkInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listNcRegisterQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / reason / item_name_text
  status: ncStatusSchema.optional(),
  reasonCategory: ncReasonCategorySchema.optional(),
  jobCardId: z.string().uuid().optional(),
  /** ELIGIBLE-FOR-RTV-CHALLAN filter. When true, the list returns only NCs that
   *  are ready for a return-to-vendor delivery challan and do not have one yet:
   *  disposition = 'return_to_vendor' AND status = 'disposed' AND
   *  delivery_challan_id IS NULL — the exact predicate createNcDc's guards
   *  enforce (nc-register/service.ts). It powers the "Against NC" source on the
   *  +New DC screen; the NC detail page raises the same challan and both go
   *  through createNcDc, so the one-challan-per-NC lock keeps a qty from being
   *  returned twice however it is reached. */
  pendingRtvChallan: queryBoolean().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListNcRegisterQuery = z.infer<typeof listNcRegisterQuerySchema>;

export interface ListNcRegisterResponse {
  items: NcRegisterListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Summary (company-wide stat cards) ───────────────────────────────────────
// Mirrors the 5 cards in legacy `renderNCRegister` (HTML L22508-22519):
//   Total (count), Pending (count), Total Qty (Σ rejected_qty),
//   Rework qty (Σ rejected_qty where disposition='rework'),
//   Scrap qty (Σ rejected_qty where disposition='scrap').
// Company-wide aggregates — NOT affected by the list's filters/pagination.
export const ncRegisterSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  reworkQty: z.number().nonnegative(),
  scrapQty: z.number().nonnegative(),
});
export type NcRegisterSummary = z.infer<typeof ncRegisterSummarySchema>;

// NC status display labels — legacy filter dropdown text (HTML L22555).
// `rework_done` reads "Rework Complete" in the legacy UI.
export const NC_STATUS_LABELS: Record<NcStatus, string> = {
  pending: 'NC Raised',
  disposed: 'Disposed',
  under_rework: 'Under Rework',
  under_repair: 'Under Repair',
  sent_to_vendor: 'Sent to Vendor',
  received_qc_pending: 'Received – QC Pending',
  rework_done: 'Rework Completed',
  closed: 'Closed',
};

/** Disposition labels in the document's vocabulary (§3). */
export const NC_DISPOSITION_LABELS: Record<NcDisposition, string> = {
  rework: 'Rework',
  repair: 'Repair',
  return_to_vendor: 'Return to Vendor',
  scrap: 'Scrap',
  use_as_is: 'Use As Is',
  make_fresh: 'Make Fresh',
};
