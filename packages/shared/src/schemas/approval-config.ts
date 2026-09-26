// Approval Configuration zod schemas + types.
//
// Mirror of legacy db.approvalConfig (renderApprovalConfig L21608).
// Single row per company; admin-only writes.

import { z } from 'zod';

export const approvalConfigSchema = z.object({
  poApproval: z.boolean(),
  poManagerLimit: z.number().nonnegative(),
  prApproval: z.boolean(),
  invoiceApproval: z.boolean(),
  /** ADR-130. On: an operator's op-entry date/time correction waits for a
   *  manager. Off: it applies on save (ADR-127 behaviour). Unlike prApproval
   *  and invoiceApproval, this flag is actually consumed — see
   *  op-entry/service.ts updateOpLogTiming. */
  opEntryEditApproval: z.boolean(),
  poApprovers: z.array(z.string().uuid()),
});
export type ApprovalConfig = z.infer<typeof approvalConfigSchema>;

export const saveApprovalConfigInputSchema = approvalConfigSchema;
export type SaveApprovalConfigInput = z.infer<typeof saveApprovalConfigInputSchema>;

export const APPROVAL_CONFIG_DEFAULTS: ApprovalConfig = {
  poApproval: true,
  poManagerLimit: 100000,
  prApproval: true,
  invoiceApproval: false,
  opEntryEditApproval: true,
  poApprovers: [],
};

// Recent approval-history row (filter on activity_log entries with
// action APPROVE / REJECT / PAYMENT). Mirrors legacy `_approvalHistoryHtml`.
export const approvalHistoryItemSchema = z.object({
  id: z.string().uuid(),
  ts: z.string(),
  action: z.string(),
  entity: z.string(),
  detail: z.string(),
  refId: z.string().nullable(),
  userId: z.string().uuid().nullable(),
  userName: z.string().nullable(),
});
export type ApprovalHistoryItem = z.infer<typeof approvalHistoryItemSchema>;

export const approvalHistoryResponseSchema = z.object({
  items: z.array(approvalHistoryItemSchema),
});
export type ApprovalHistoryResponse = z.infer<typeof approvalHistoryResponseSchema>;

// ─── Approvals inbox (ADR-190) ──────────────────────────────────────────────
// GET /approvals/inbox — what is waiting for the CALLER to sign off, one list
// per kind. Each list applies the same eligibility rules as the matching
// approve endpoint (PR: Approve on Purchase Requests, not self-raised; PO:
// Approve on Purchase Orders, on the approvers list, not self-raised, PO value
// within the caller's limit; log entry: manager/admin), so everything listed
// is something the caller can actually approve.

export const approvalInboxRowSchema = z.object({
  id: z.string().uuid(),
  /** The waiting document's number: PR No. (PR), PO No. (PO), or
   *  `JC No. · Op` for a log-entry change. */
  docCode: z.string(),
  vendorName: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  /** The waiting document's qty: PR Qty (PR), Σ PO line qty (PO), the log
   *  entry's own qty (log entry — shown, not part of the ask). */
  docQty: z.number().nullable(),
  /** The waiting document's ₹ before GST: PR Qty × Est. Rate (PR), or the PO
   *  value the approval limit is checked against (PO). Null for a log entry,
   *  and when the caller's access hides prices. */
  docAmount: z.number().nullable(),
  createdByName: z.string().nullable(),
  /** When it was raised — ISO timestamp. */
  createdAt: z.string(),
  /** The page that opens it, e.g. `/purchase-orders/<id>`. */
  navPage: z.string(),
});
export type ApprovalInboxRow = z.infer<typeof approvalInboxRowSchema>;

export const approvalInboxResponseSchema = z.object({
  counts: z.object({
    pr: z.number().int().nonnegative(),
    po: z.number().int().nonnegative(),
    logEntry: z.number().int().nonnegative(),
  }),
  pr: z.array(approvalInboxRowSchema),
  po: z.array(approvalInboxRowSchema),
  logEntry: z.array(approvalInboxRowSchema),
});
export type ApprovalInboxResponse = z.infer<typeof approvalInboxResponseSchema>;
