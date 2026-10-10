// Edit-approval (ADR-202) — the ONE data contract shared across DB, API and
// web for "every edit to a live document is staged and goes for approval".
//
// Design decisions it encodes:
//  1A  per-change approve/reject (each change ticked individually).
//  2   on everywhere, kept safe by a central engine guard at apply time.
//  4   always stage; who approved is shown in the document's History tab.
//
// The request's own `status` is the only status this feature owns; the
// document's business status keeps its existing single writer (CLAUDE.md §20.1).

import { z } from 'zod';
import { activityChangeSchema } from './activity-log';
import {
  DOCUMENT_EDIT_STATUSES,
  DOCUMENT_EDIT_CHANGE_OUTCOMES,
} from '../enums/document-edit-status';
import { DOCUMENT_EDIT_ENTITIES } from '../enums/document-edit-entity';

/** One proposed change — the ADR-197 before→after shape plus a stable id the
 *  approver ticks (1A). `before` is the value captured when the edit was
 *  requested; the engine refuses the change at apply time if the document's
 *  current value no longer equals it. */
export const documentEditChangeSchema = activityChangeSchema.extend({
  id: z.string().min(1).max(64),
});
export type DocumentEditChange = z.infer<typeof documentEditChangeSchema>;

/** The outcome recorded for one change once the approver decides. */
export const documentEditDecisionSchema = z.object({
  changeId: z.string().min(1).max(64),
  outcome: z.enum(DOCUMENT_EDIT_CHANGE_OUTCOMES),
  reason: z.string().max(500).nullable(),
});
export type DocumentEditDecision = z.infer<typeof documentEditDecisionSchema>;

/** One staged edit request — feeds the Edit Approvals inbox, the per-document
 *  inline chip, and the request detail. */
export const documentEditRowSchema = z.object({
  id: z.string().uuid(),
  entity: z.enum(DOCUMENT_EDIT_ENTITIES),
  entityId: z.string().uuid(),
  /** Snapshot of the document code (e.g. IN-MPO-00042) for the inbox. */
  docCode: z.string(),
  status: z.enum(DOCUMENT_EDIT_STATUSES),
  changes: z.array(documentEditChangeSchema),
  decisions: z.array(documentEditDecisionSchema),
  requestedById: z.string().uuid().nullable(),
  requestedByName: z.string(),
  requestedAt: z.string(),
  decidedById: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** Overall note on the decision; per-change reasons live in `decisions`. */
  decisionReason: z.string().nullable(),
  /** True when a still-pending change's current value already differs from its
   *  captured `before` — approving it now would be refused as superseded. */
  isStale: z.boolean(),
});
export type DocumentEditRow = z.infer<typeof documentEditRowSchema>;

/** POST /document-edits/:id/decide — per-change approve/reject (1A). The
 *  decisions must cover every still-pending change; a reject needs a reason. */
export const decideDocumentEditInputSchema = z
  .object({
    id: z.string().uuid(),
    decisions: z
      .array(
        z.object({
          changeId: z.string().min(1).max(64),
          decision: z.enum(['approve', 'reject']),
          reason: z.string().trim().max(500).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((val, ctx) => {
    val.decisions.forEach((d, i) => {
      if (d.decision === 'reject' && !d.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A reason is required to reject a change.',
          path: ['decisions', i, 'reason'],
        });
      }
    });
  });
export type DecideDocumentEditInput = z.infer<typeof decideDocumentEditInputSchema>;

/** POST /document-edits/:id/withdraw — the requester pulls an edit back. */
export const withdrawDocumentEditInputSchema = z.object({ id: z.string().uuid() });
export type WithdrawDocumentEditInput = z.infer<typeof withdrawDocumentEditInputSchema>;

/** GET /document-edits — the inbox list and the per-document pending lookup
 *  (the inline chip asks with entity + entityId + status=pending). */
export const listDocumentEditsQuerySchema = z.object({
  entity: z.enum(DOCUMENT_EDIT_ENTITIES).optional(),
  entityId: z.string().uuid().optional(),
  status: z.enum(DOCUMENT_EDIT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListDocumentEditsQuery = z.input<typeof listDocumentEditsQuerySchema>;

export const listDocumentEditsResponseSchema = z.object({
  rows: z.array(documentEditRowSchema),
  total: z.number().int().nonnegative(),
});
export type ListDocumentEditsResponse = z.infer<typeof listDocumentEditsResponseSchema>;

/** GET /document-edits/counts — pending edit-request count per document type.
 *  Drives the Approvals page's dynamic tab row (one tab per document that has
 *  something pending) and each tab's badge. Only entities with pending > 0 are
 *  returned, so the tab row shows exactly the documents that need attention. */
export const documentEditCountSchema = z.object({
  entity: z.enum(DOCUMENT_EDIT_ENTITIES),
  pending: z.number().int().nonnegative(),
});
export type DocumentEditCount = z.infer<typeof documentEditCountSchema>;

export const documentEditCountsResponseSchema = z.object({
  counts: z.array(documentEditCountSchema),
});
export type DocumentEditCountsResponse = z.infer<typeof documentEditCountsResponseSchema>;

/** When the gate is on and a LIVE document's edit is held for approval instead
 *  of applied, the document's edit route returns this in place of the
 *  document, so the UI shows "Sent for approval" rather than a saved record. */
export const documentEditStagedResultSchema = z.object({
  staged: z.literal(true),
  request: documentEditRowSchema,
});
export type DocumentEditStagedResult = z.infer<typeof documentEditStagedResultSchema>;
