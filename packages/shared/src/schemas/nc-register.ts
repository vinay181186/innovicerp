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
import { NC_DISPOSITIONS } from '../enums/nc-disposition';
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
  scrapCost: z.string(),
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
  remarks: z.string().max(2000).optional(),
  reworkOpSeq: z.number().int().positive().optional(),
  scrapCost: z.coerce.number().nonnegative().optional(),
});
export type DisposeNcInput = z.infer<typeof disposeNcInputSchema>;

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
  pending: 'Pending',
  disposed: 'Disposed',
  rework_done: 'Rework Complete',
  closed: 'Closed',
};
