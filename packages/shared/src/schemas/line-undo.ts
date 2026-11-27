// ADR-324 — Undo list for one order line (P1: JWSO lines).
//
// A wrong JWSO line that other documents already use is cleared from ONE place:
// the JWSO edit screen lists every live step holding the line, newest first, and
// runs them one at a time. Each step still goes through that document's own
// service (its rights, its blockers, its ledger writes, its approval) — the list
// only adds (a) the Undo chain Special Right and (b) the order: a step runs only
// when it is the first open one. Nothing cascades.
//
// The list is computed fresh from live data on every read. A finished step is
// simply no longer in it. An empty list means the line can be removed (the
// existing JWSO edit Save removes it).

import { z } from 'zod';
import { activityReasonSchema } from '../enums/activity';
import { cancelDocTypeSchema } from './cancel-request';

/** What the server does for a step. */
export const LINE_UNDO_STEP_KINDS = [
  /** Stop a running operation on the Job Card (op-entry stopOp). */
  'stop_op',
  /** Reverse one Op Log entry (op-entry reverseOpLog). */
  'reverse_op_log',
  /** Return the un-returned pieces of a Customer Material Issue to store. */
  'return_party_issue',
  /** Standard Cancel through the ADR-235 registry (docType says which). Includes
   *  the ADR-324 types party_grn_line / party_grn_line_qc / nc_disposition. */
  'cancel',
] as const;
export type LineUndoStepKind = (typeof LINE_UNDO_STEP_KINDS)[number];

export const LINE_UNDO_STEP_STATES = [
  /** Can be run now from the list (when it is the first open step). */
  'todo',
  /** A cancel request is pending approval; nothing below it can run. */
  'waiting_approval',
  /** Not undoable from the list in P1 (e.g. an OSP DC, a final inspection):
   *  `manualReason` says why; the user opens the document instead. Blocks the
   *  steps below it like any open step. */
  'manual',
] as const;
export type LineUndoStepState = (typeof LINE_UNDO_STEP_STATES)[number];

export const lineUndoStepSchema = z.object({
  /** Stable id of the step, `<kind>:<docId>` (or `cancel:<docType>:<docId>`). */
  key: z.string(),
  kind: z.enum(LINE_UNDO_STEP_KINDS),
  /** Set when kind = 'cancel'. */
  docType: cancelDocTypeSchema.nullable(),
  docId: z.string().uuid(),
  /** Screen name of the document's type, e.g. "Op Log entry", "Party GRN line". */
  docLabel: z.string(),
  /** e.g. "LOG-2291 · Op 30", "PGRN-00058 Ln 4". */
  docCode: z.string(),
  /** One plain sentence, e.g. "Reverse the entry — 4 pcs". */
  whatHappens: z.string(),
  /** Button text, e.g. "Reverse", "Return to store", "Cancel", "Reverse QC". */
  actionLabel: z.string(),
  /** In-app link to the document; null when it has no page. */
  href: z.string().nullable(),
  /** True when running it sends a request for approval (the caller does not
   *  hold that page's Approve tick); false when it completes at once. */
  needsApproval: z.boolean(),
  state: z.enum(LINE_UNDO_STEP_STATES),
  /** Why a 'manual' step cannot run from the list; null otherwise. */
  manualReason: z.string().nullable(),
});
export type LineUndoStep = z.infer<typeof lineUndoStepSchema>;

export const jwLineUndoListSchema = z.object({
  jobWorkOrderId: z.string().uuid(),
  lineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  orderQty: z.number(),
  /** Caller holds the Undo chain Special Right (canUndoChain). Without it the
   *  list is read-only. */
  canUndo: z.boolean(),
  /** Names of active users who hold the right — "ask …" when canUndo is false. */
  undoHolders: z.array(z.string()),
  /** Ordered newest step first. Empty = nothing holds the line any more. */
  steps: z.array(lineUndoStepSchema),
});
export type JwLineUndoList = z.infer<typeof jwLineUndoListSchema>;

export const runLineUndoStepInputSchema = z.object({
  /** Must equal the key of the first open step, or the server answers 409
   *  with the fresh list's first step. */
  stepKey: z.string().min(1),
  /** One reason, used for every step of the run. */
  reason: activityReasonSchema,
});
export type RunLineUndoStepInput = z.infer<typeof runLineUndoStepInputSchema>;

export const runLineUndoStepResultSchema = z.object({
  /** 'done' — the step completed; 'requested' — sent for approval. */
  outcome: z.enum(['done', 'requested']),
  /** Toast text, e.g. "LOG-2291 reversed", "Sent for approval — PGRN-00058 Ln 4". */
  message: z.string(),
});
export type RunLineUndoStepResult = z.infer<typeof runLineUndoStepResultSchema>;
