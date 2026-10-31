// ADR-265 — ONE list of everything waiting for the CALLER's approval, and the
// history of past decisions. The ONE data contract the server read, the home
// Approvals view, the Settings → Approvals page and the top-menu badge share
// (owner 31-Oct: "only types with something pending, decided in place").
//
// It owns no approval rules. Each kind is read with the SAME eligibility check
// as its existing decide endpoint, so a row here is always one the caller's
// ✓ / ✗ would be accepted on. Deciding still goes to those endpoints:
//
//   po       POST /purchase-orders/:id/approve | /reject
//   rc       POST /route-cards/:id/approve | /reject      (expectedUpdatedAt = version)
//   logEntry POST /op-entry/time-changes/:id/decide
//   edit     POST /document-edits/:id/decide             (per change, `changes[]`)
//   cancel   POST /cancel-requests/:id/decide
//   dayLog   POST /day-logs/entries/:id/approve | /reject (requestedAt = version)
//
// PRs have no approval (owner rule 2026-10-31) and are never listed.

import { z } from 'zod';
import { documentEditChangeSchema } from './document-edit';

export const APPROVAL_KINDS = ['po', 'rc', 'logEntry', 'edit', 'cancel', 'dayLog'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** `direct` = ✓ / ✗ on the row (and tickable for "✓ Approve N").
 *  `review` = "Review (n)" opens the side panel with ✓ / ✗ per field. */
export const APPROVAL_MODES = ['direct', 'review'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** One thing waiting for the caller. */
export const waitingApprovalRowSchema = z.object({
  kind: z.enum(APPROVAL_KINDS),
  /** The id the decide endpoint takes: PO / Route Card / time-change request /
   *  edit request / cancel request id, or the Day Log ENTRY id. */
  id: z.string().uuid(),
  /** Groups rows for the Approval Type filter: `po`, `rc`, `logEntry`,
   *  `cancel`, `dayLog`, or `edit:<entity>` (one type per document type). */
  typeKey: z.string().min(1).max(64),
  /** Approval Type as shown (docs/NAMING.md): "Purchase Order", "Route Card (New)",
   *  "Op Entry time change", "Item change", "Cancel Request", "Day Log edit"… */
  typeLabel: z.string(),
  /** The document's number (JC No. · Op #n for a time change; the person's
   *  name · date for a Day Log edit). */
  docCode: z.string(),
  /** The document's own page; null when there is none to open. */
  docHref: z.string().nullable(),
  /** One line saying what is asked, e.g. "Release PO · ₹ 1,20,000",
   *  "3 fields changed", "Cancel: wrong vendor", "Stop 17:30 → 18:15". */
  request: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  raisedByName: z.string().nullable(),
  /** ISO timestamp the request was raised. */
  raisedAt: z.string(),
  mode: z.enum(APPROVAL_MODES),
  /** Edit requests only: the still-pending changes (empty otherwise). */
  changes: z.array(documentEditChangeSchema),
  /** Edit requests only: a pending change's current value already differs from
   *  its captured `before` (approving it would be refused). */
  isStale: z.boolean(),
  /** The version stamp the decide endpoint checks (§20.2): Route Card
   *  `updatedAt`, Day Log `requestedAt`; null for the other kinds. */
  version: z.string().nullable(),
});
export type WaitingApprovalRow = z.infer<typeof waitingApprovalRowSchema>;

export const approvalTypeCountSchema = z.object({
  typeKey: z.string(),
  typeLabel: z.string(),
  n: z.number().int().nonnegative(),
});
export type ApprovalTypeCount = z.infer<typeof approvalTypeCountSchema>;

/** The most rows one read returns; `total` still counts every waiting row. */
export const WAITING_APPROVALS_LIMIT = 500;

/** GET /approvals/waiting — no params. Rows oldest first. */
export const waitingApprovalsResponseSchema = z.object({
  rows: z.array(waitingApprovalRowSchema),
  /** Only types with at least one waiting row, in menu order. */
  counts: z.array(approvalTypeCountSchema),
  /** Every waiting row (may exceed rows.length when over the limit). */
  total: z.number().int().nonnegative(),
  /** The caller holds an Approve (or cancel-decider / Day Log head) right on
   *  at least one approval type — decides whether "Approvals" is offered. */
  canApprove: z.boolean(),
});
export type WaitingApprovalsResponse = z.infer<typeof waitingApprovalsResponseSchema>;

// ─── History ────────────────────────────────────────────────────────────────

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** GET /approvals/history — past decisions on the types the caller may approve. */
export const approvalHistoryListQuerySchema = z.object({
  decision: z.enum(APPROVAL_DECISIONS),
  /** One Approval Type (`typeKey`); absent = all. */
  type: z.string().max(64).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ApprovalHistoryListQuery = z.input<typeof approvalHistoryListQuerySchema>;

export const approvalHistoryRowSchema = z.object({
  kind: z.enum(APPROVAL_KINDS),
  /** Unique per row (an activity / request id). */
  id: z.string(),
  typeKey: z.string(),
  typeLabel: z.string(),
  docCode: z.string(),
  docHref: z.string().nullable(),
  request: z.string(),
  decision: z.enum(APPROVAL_DECISIONS),
  decidedByName: z.string().nullable(),
  decidedAt: z.string(),
  /** Reject reason / approve remark, when given. */
  reason: z.string().nullable(),
});
export type ApprovalHistoryRow = z.infer<typeof approvalHistoryRowSchema>;

export const approvalHistoryListResponseSchema = z.object({
  rows: z.array(approvalHistoryRowSchema),
  /** Types with at least one decision of this kind, for the Approval Type filter. */
  counts: z.array(approvalTypeCountSchema),
  total: z.number().int().nonnegative(),
});
export type ApprovalHistoryListResponse = z.infer<typeof approvalHistoryListResponseSchema>;
