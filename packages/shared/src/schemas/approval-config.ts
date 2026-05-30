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
