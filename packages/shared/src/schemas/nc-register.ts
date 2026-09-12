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
import { type NcDisposition, NC_DISPOSITIONS } from '../enums/nc-disposition';
import { NC_REASON_CATEGORIES } from '../enums/nc-reason-category';
import { type NcStatus, NC_STATUSES } from '../enums/nc-status';

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
  jobCardId: z.string().uuid(),
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
  itemName: z.string().nullable(),
  soCodeText: z.string().nullable(),
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
  /** Sibling link: set on the remainder row when a disposition covered less
   *  than the full rejected qty. */
  splitFromNcId: z.string().uuid().nullable().default(null),
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
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen'),
  ncDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ncDate must be YYYY-MM-DD'),
  jobCardId: z.string().uuid(),
  jcOpId: z.string().uuid().optional(),
  opSeq: z.number().int().optional(),
  operationText: z.string().max(255).optional(),
  qcOperationText: z.string().max(255).optional(),
  itemId: z.string().uuid(),
  itemNameText: z.string().max(255).optional(),
  soCodeText: z.string().max(64).optional(),
  machineCodeText: z.string().max(64).optional(),
  operatorText: z.string().max(255).optional(),
  rejectedQty: z.coerce.number().positive(),
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
   *  into a sibling NC that stays pending. Never more than the open qty. */
  qty: z.coerce.number().int().positive().optional(),
  remarks: z.string().max(2000).optional(),
  /** Legacy in-route rework only; a new `rework` disposition raises a child
   *  job card and ignores this. Kept so old clients do not break. */
  reworkOpSeq: z.number().int().positive().optional(),
  scrapCost: z.coerce.number().nonnegative().optional(),
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
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
  rework_done: 'Rework Complete',
  closed: 'Closed',
};

/** Disposition labels in the document's vocabulary (§3). */
export const NC_DISPOSITION_LABELS: Record<NcDisposition, string> = {
  rework: 'Rework',
  repair: 'Repair',
  return_to_vendor: 'Return to Vendor',
  scrap: 'Reject / Scrap',
  use_as_is: 'Use As Is',
  make_fresh: 'Make Fresh',
};
