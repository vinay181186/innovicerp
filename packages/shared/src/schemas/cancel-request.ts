// ADR-235 — ONE standard Cancel for every document (owner rules 2026-10-16 and
// 2026-10-23): a live document is never deleted, only Cancelled. The user writes
// a reason and sends a Cancel Request; a holder of the Approve tick on that
// document's page approves it (the requester may approve their own when they
// hold the tick); approval runs the document's own cancel worker in ONE
// transaction — blockers re-checked, stock reversed with opposite ledger
// entries, upstream balances reopened. The document stays visible as
// Cancelled, read-only, its reason on the row.
//
// Never cascade: a document with live downstream documents is refused, and the
// preview names each one ("cancel these first, in this order").

import { z } from 'zod';
import { activityReasonSchema } from '../enums/activity';

/** Document types enrolled in the standard Cancel. Grows phase by phase. */
export const CANCEL_DOC_TYPES = [
  // Phase A
  'invoice',
  'jw_invoice',
  'customer_dispatch',
  // Phase B
  'jw_return',
  'customer_material_return',
  'party_grn',
  'party_material_issue',
  'delivery_challan',
  'store_issue',
  'stock_count',
  'tool_issue',
  'purchase_request',
  'purchase_order',
  // Phase C (part 1)
  'jw_dc_outward',
  'plan',
  'job_work_order',
  'sales_order',
  'grn',
  // Phase C (part 2)
  'job_card',
  'production_order',
  'dc_receipt',
  'jw_dc_inward',
] as const;
export type CancelDocType = (typeof CANCEL_DOC_TYPES)[number];
export const cancelDocTypeSchema = z.enum(CANCEL_DOC_TYPES);

/** Screen name of each enrolled type (docs/NAMING.md names). */
export const CANCEL_DOC_LABELS: Record<CancelDocType, string> = {
  invoice: 'Invoice',
  jw_invoice: 'JW Invoice',
  customer_dispatch: 'Customer Dispatch',
  jw_return: 'JW Return',
  customer_material_return: 'Customer Material Return',
  party_grn: 'Party GRN',
  party_material_issue: 'Party Material Issue',
  delivery_challan: 'Delivery Challan',
  store_issue: 'Item Issue',
  stock_count: 'Stock Count',
  tool_issue: 'Tool Issue',
  purchase_request: 'Purchase Request',
  purchase_order: 'Purchase Order',
  jw_dc_outward: 'JW DC',
  plan: 'Plan',
  job_work_order: 'JWSO',
  sales_order: 'Sales Order',
  grn: 'GRN',
  job_card: 'Job Card',
  production_order: 'Production Order',
  dc_receipt: 'DC Receipt',
  jw_dc_inward: 'JW DC Receipt',
};

/** The page whose ticks decide the cancel: Edit = may request, Approve = may
 *  approve (ADR-232 — ticks alone decide). */
export const CANCEL_DOC_FORM_KEY: Record<CancelDocType, string> = {
  invoice: 'invoice_create',
  jw_invoice: 'invoice_create',
  customer_dispatch: 'dispatch_create',
  jw_return: 'jw_create',
  customer_material_return: 'party_create',
  party_grn: 'party_create',
  party_material_issue: 'party_create',
  delivery_challan: 'ospdc_create',
  store_issue: 'issue_create',
  stock_count: 'stockcount_create',
  tool_issue: 'toolissue_create',
  purchase_request: 'pr_create',
  purchase_order: 'po_create',
  jw_dc_outward: 'ospdc_create',
  plan: 'plan_create',
  job_work_order: 'jw_create',
  sales_order: 'so_create',
  grn: 'grn_create',
  job_card: 'jc_create',
  production_order: 'prodorder_create',
  dc_receipt: 'ospdc_create',
  jw_dc_inward: 'ospdc_create',
};

export const CANCEL_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CancelRequestStatus = (typeof CANCEL_REQUEST_STATUSES)[number];

/** A live downstream document that must be cancelled first. */
export const cancelBlockerSchema = z.object({
  /** Screen name of the blocking document's type, e.g. "Invoice". */
  docLabel: z.string(),
  docNo: z.string(),
  /** In-app link to open it; null when there is none. The web shows plain text
   *  when the caller may not open that page. */
  href: z.string().nullable(),
  /** Why it blocks, e.g. "Ln 2 is invoiced (40 pcs)". */
  reason: z.string(),
});
export type CancelBlocker = z.infer<typeof cancelBlockerSchema>;

/** One thing the cancel will do — shown before the user commits. */
export const cancelEffectSchema = z.object({
  kind: z.enum(['stock', 'reopen', 'release', 'note']),
  /** Plain sentence, e.g. "BRG-6205 comes back into stock". */
  text: z.string(),
  /** Signed qty for stock / reopen lines (+ in / reopened, − out). */
  qty: z.number().nullable().default(null),
});
export type CancelEffect = z.infer<typeof cancelEffectSchema>;

export const cancelRequestRowSchema = z.object({
  id: z.string().uuid(),
  docType: cancelDocTypeSchema,
  docId: z.string().uuid(),
  docCode: z.string(),
  reason: z.string(),
  status: z.enum(CANCEL_REQUEST_STATUSES),
  requestedBy: z.string().uuid(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  decidedBy: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export type CancelRequestRow = z.infer<typeof cancelRequestRowSchema>;

/** GET /cancel/:docType/:docId/preview — what Cancel would do, right now. */
export const cancelPreviewSchema = z.object({
  docType: cancelDocTypeSchema,
  docId: z.string().uuid(),
  docCode: z.string(),
  /** Already cancelled — nothing to do. */
  alreadyCancelled: z.boolean(),
  /** Caller holds Edit on the page (may request). */
  canRequest: z.boolean(),
  /** Caller holds Approve on the page (may approve — incl. their own). */
  canApprove: z.boolean(),
  /** The open request on this document, if any. */
  pending: cancelRequestRowSchema.nullable(),
  /** Empty = nothing blocks. */
  blockers: z.array(cancelBlockerSchema),
  effects: z.array(cancelEffectSchema),
});
export type CancelPreview = z.infer<typeof cancelPreviewSchema>;

/** POST /cancel/:docType/:docId — send a Cancel Request. `approveNow` = the
 *  requester holds the Approve tick and cancels at once (self-approval, ADR-198
 *  style); refused without the tick. */
export const requestCancelInputSchema = z.object({
  reason: activityReasonSchema,
  approveNow: z.boolean().optional().default(false),
});
export type RequestCancelInput = z.input<typeof requestCancelInputSchema>;

/** POST /cancel-requests/:id/decide */
export const decideCancelInputSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'approve' || (v.note ?? '').length > 0, {
    message: 'Give a reason for rejecting the cancel request.',
    path: ['note'],
  });
export type DecideCancelInput = z.input<typeof decideCancelInputSchema>;

/** GET /cancel-requests — the Approvals inbox tab. */
export const listCancelRequestsQuerySchema = z.object({
  status: z.enum(CANCEL_REQUEST_STATUSES).optional(),
  /** true = only requests the caller may decide. */
  toDecide: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListCancelRequestsQuery = z.input<typeof listCancelRequestsQuerySchema>;

export interface ListCancelRequestsResponse {
  items: CancelRequestRow[];
  total: number;
}

/** Result of a request / decision: the request row as it now stands. */
export interface CancelRequestResult {
  request: CancelRequestRow;
  /** True when the document is now Cancelled (approved, incl. approveNow). */
  cancelled: boolean;
}
