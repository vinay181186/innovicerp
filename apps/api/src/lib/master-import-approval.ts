// Excel import "Update Existing" under Document Edit Approval (ADR-249 Step B2).
//
// While the company's edit-approval gate is on, an Update Existing row on a
// master (Item / Customer / Vendor / Operator) must not write the record
// directly — that was a side door around the approval the record's own screen
// enforces. Each changed row is instead STAGED as one edit request, through
// the same engine call the screen uses (requestDocumentEditInTx), inside the
// import's single transaction:
//
//   gate off                       → written directly, exactly as before
//   gate on, staged                → row action 'approval' (Sent for approval)
//   gate on, engine refused it     → row action 'skip' with the reason
//     (already waiting / nothing changed / changed during the import /
//      no longer exists — moved to Trash meanwhile; NEVER a direct write)
//
// The engine runs each request in a SAVEPOINT, so a refused row rolls back
// only its own request and the rest of the sheet carries on.
//
// The preview (dryRun) tells the same story: with the gate on, a changed row
// shows as 'approval', or 'skip' when the record already has a change waiting.
//
// ONE entry point, applyImportUpdates — the four master imports call it and
// nothing else from here (plus importCounts for the result).
//
// document-edits/service is imported DYNAMICALLY: it statically reaches every
// master's edit registry, which reaches that master's service, which imports
// this file — a static import here would close that cycle.

import { and, eq, isNull } from 'drizzle-orm';
import type { MasterImportRowResult } from '@innovic/shared';
import { documentEditRequests } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { AppError } from './errors';

export type ImportApprovalEntity = 'Item' | 'Client' | 'Vendor' | 'Operator';

/** The screen word for each master (NAMING.md — a Client is a "Customer"). */
const ENTITY_LABEL: Record<ImportApprovalEntity, string> = {
  Item: 'Item',
  Client: 'Customer',
  Vendor: 'Vendor',
  Operator: 'Operator',
};

/** One changed Update Existing row: the record, the PATCH-shaped payload the
 *  approval will replay (only the filled cells), and the row result to mark. */
export interface ImportUpdateCandidate {
  before: { id: string; code: string; updatedAt: Date | string };
  /** Same shape as the master's PATCH input (minus expectedUpdatedAt). */
  payload: Record<string, unknown>;
  row: MasterImportRowResult;
}

export function goneReason(entity: ImportApprovalEntity, code: string): string {
  return `${ENTITY_LABEL[entity]} ${code} no longer exists — it may have been moved to Trash`;
}

export function waitingReason(entity: ImportApprovalEntity, code: string): string {
  return `${ENTITY_LABEL[entity]} ${code} already has a change waiting for approval — approve or reject it first, then import this row again`;
}

/**
 * The user's words for an engine refusal of one staged row, or null when the
 * error is not a per-row refusal (then the whole import must fail, as before).
 */
export function importApprovalRefusal(
  err: unknown,
  entity: ImportApprovalEntity,
  code: string,
): string | null {
  if (!(err instanceof AppError) || err.statusCode !== 409) return null;
  if (err.message.includes('already has an edit waiting')) return waitingReason(entity, code);
  if (err.message.startsWith('Nothing changed to approve')) {
    return 'Nothing to change — the filled cells match what is saved';
  }
  if (err.code === 'edit_conflict') {
    return `${ENTITY_LABEL[entity]} ${code} was changed by someone else during the import — run the import again`;
  }
  return err.message;
}

function markSkip(row: MasterImportRowResult, reason: string): void {
  row.action = 'skip';
  row.reason = reason;
  delete row.changedFields;
}

/** A direct-write row whose record went to Trash before its UPDATE ran (the
 *  UPDATE's deleted_at filter matched nothing) — report it, do not count it. */
export function markGone(
  entity: ImportApprovalEntity,
  row: MasterImportRowResult,
  code: string,
): void {
  markSkip(row, goneReason(entity, code));
}

function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * The whole Update Existing routing for one import, inside its transaction.
 * Marks each candidate's row ('approval' / 'skip') and returns the candidates
 * the caller must still WRITE DIRECTLY:
 *   gate off            → all of them (preview: none — nothing is written);
 *   gate on, preview    → none; rows show 'approval', or 'skip' if waiting;
 *   gate on, real run   → none. Staged → 'approval'; refused → 'skip'. The
 *                          engine answering null with the gate known on means
 *                          the record left the live set (Trash) mid-import —
 *                          'skip', never a direct write around the approval.
 * The caller must have called primeAccess(user) before opening the transaction.
 */
export async function applyImportUpdates<C extends ImportUpdateCandidate>(
  tx: DbTransaction,
  entity: ImportApprovalEntity,
  companyId: string,
  candidates: readonly C[],
  opts: { dryRun: boolean; user: AuthContext },
): Promise<C[]> {
  if (candidates.length === 0) return [];
  const engine = await import('../modules/document-edits/service');
  if (!(await engine.isDocEditApprovalOn(tx, companyId))) {
    return opts.dryRun ? [] : [...candidates];
  }

  if (opts.dryRun) {
    // Same condition as the partial-unique index document_edit_pending_uq.
    const waiting = await tx
      .select({ entityId: documentEditRequests.entityId })
      .from(documentEditRequests)
      .where(
        and(
          eq(documentEditRequests.companyId, companyId),
          eq(documentEditRequests.entity, entity),
          eq(documentEditRequests.status, 'pending'),
          isNull(documentEditRequests.deletedAt),
        ),
      );
    const waitingIds = new Set(waiting.map((r) => r.entityId));
    for (const c of candidates) {
      if (waitingIds.has(c.before.id)) markSkip(c.row, waitingReason(entity, c.before.code));
      else c.row.action = 'approval';
    }
    return [];
  }

  for (const c of candidates) {
    try {
      // The id-only form: an import needs no read-back of each request row.
      const requestId = await engine.requestDocumentEditIdInTx(
        tx,
        entity,
        c.before.id,
        c.payload,
        isoOf(c.before.updatedAt),
        opts.user,
        undefined,
        // Read once above, in this same transaction.
        { gateKnownOn: true },
      );
      if (requestId !== null) c.row.action = 'approval';
      else markSkip(c.row, goneReason(entity, c.before.code));
    } catch (e) {
      const reason = importApprovalRefusal(e, entity, c.before.code);
      if (reason === null) throw e;
      markSkip(c.row, reason);
    }
  }
  return [];
}

/** The result counts, read off the row actions (one rule for all four). */
export function importCounts(rows: readonly MasterImportRowResult[]): {
  updated: number;
  sentForApproval: number;
} {
  let updated = 0;
  let sentForApproval = 0;
  for (const r of rows) {
    if (r.action === 'update') updated += 1;
    else if (r.action === 'approval') sentForApproval += 1;
  }
  return { updated, sentForApproval };
}
