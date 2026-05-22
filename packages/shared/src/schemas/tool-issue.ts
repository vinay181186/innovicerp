// Tool Issue shared schemas (PL-TI-1).
//
// Returnable counterpart to Item Issue. Mirrors legacy renderToolIssue
// (HTML L23965) + addToolIssue (L24038) + _toolReturn (L24080).
// Numbering: TIS-NNNNN.
//
// Status enum (issued | partial | returned) stored as text. Status is
// derived server-side from cumulative return qtys vs issued qty.

import { z } from 'zod';
import { STORE_ISSUE_REF_TYPES } from './store-issue';

export const TOOL_RETURN_STATUSES = ['issued', 'partial', 'returned'] as const;
export type ToolReturnStatus = (typeof TOOL_RETURN_STATUSES)[number];
export const toolReturnStatusSchema = z.enum(TOOL_RETURN_STATUSES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const toolIssueSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  issueDate: z.string(),
  expectedReturnDate: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemName: z.string(),
  qty: z.number().int().positive(),
  issuedTo: z.string(),
  refType: z.string().nullable(),
  refNo: z.string().nullable(),
  purpose: z.string().nullable(),
  remarks: z.string().nullable(),
  returnStatus: toolReturnStatusSchema,
  returnGoodQty: z.number().int().nonnegative(),
  returnDamagedQty: z.number().int().nonnegative(),
  returnConsumedQty: z.number().int().nonnegative(),
  storeTransactionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type ToolIssue = z.infer<typeof toolIssueSchema>;

export const toolIssueReturnRowSchema = z.object({
  id: z.string().uuid(),
  toolIssueId: z.string().uuid(),
  returnDate: z.string(),
  returnedBy: z.string().nullable(),
  goodQty: z.number().int().nonnegative(),
  damagedQty: z.number().int().nonnegative(),
  consumedQty: z.number().int().nonnegative(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
});
export type ToolIssueReturnRow = z.infer<typeof toolIssueReturnRowSchema>;

export const toolIssueListItemSchema = toolIssueSchema.extend({
  itemCode: z.string().nullable(),
  issuedByName: z.string().nullable(),
  /** True when not fully returned AND expectedReturnDate < today. Computed
   *  server-side so the list view can render the Overdue badge directly. */
  isOverdue: z.boolean(),
});
export type ToolIssueListItem = z.infer<typeof toolIssueListItemSchema>;

// ─── Write inputs ─────────────────────────────────────────────────────────

export const createToolIssueInputSchema = z.object({
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemId: z.string().uuid(),
  qty: z.number().int().positive(),
  issuedTo: z.string().trim().min(1).max(255),
  refType: z.enum(STORE_ISSUE_REF_TYPES).optional(),
  refNo: z.string().trim().max(64).optional(),
  purpose: z.string().trim().max(255).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateToolIssueInput = z.infer<typeof createToolIssueInputSchema>;

export const recordToolReturnInputSchema = z
  .object({
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    returnedBy: z.string().trim().max(255).optional(),
    goodQty: z.number().int().nonnegative().default(0),
    damagedQty: z.number().int().nonnegative().default(0),
    consumedQty: z.number().int().nonnegative().default(0),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.goodQty + v.damagedQty + v.consumedQty > 0, {
    message: 'At least one of good / damaged / consumed must be > 0',
  });
export type RecordToolReturnInput = z.infer<typeof recordToolReturnInputSchema>;

// ─── Query filters ────────────────────────────────────────────────────────

export const listToolIssuesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | out (issued+partial) | overdue | returned */
  filter: z.enum(['all', 'out', 'overdue', 'returned']).default('all'),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListToolIssuesQuery = z.infer<typeof listToolIssuesQuerySchema>;

export const toolIssueSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
});
export type ToolIssueSummary = z.infer<typeof toolIssueSummarySchema>;

export interface ListToolIssuesResponse {
  items: ToolIssueListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: ToolIssueSummary;
}
