// Edit-approval engine (ADR-202, Phase 1) — the writers. Entity-agnostic: every
// document type is driven through DOC_EDIT_REGISTRY (./registry.ts). Phase 1
// enrols only PurchaseOrder. The reads live in ./list.ts, shared projection in
// ./helpers.ts.
//
// The lifecycle this owns is the REQUEST's own status; the document's business
// status keeps its single writer (§20.1). While a request is 'pending' the live
// document is untouched. Approving replays ONLY the approved + still-fresh
// changes through the document's own edit writer; rejecting applies nothing.
//
// §20 guards used here:
//  - FOR UPDATE on the request row before deciding (lock-then-check),
//  - a guarded UPDATE … WHERE status = 'pending' with rollback on 0 rows (§20.2),
//  - assertUnchangedSinceOpened on the target at request time (§20.4),
//  - the partial-unique index 'document_edit_pending_uq' → one open edit per doc.

import { and, eq, isNull } from 'drizzle-orm';
import {
  ActivityAction,
  type DecideDocumentEditInput,
  type DocumentEditChange,
  type DocumentEditDecision,
  type DocumentEditRow,
  type DocumentEditStatus,
} from '@innovic/shared';
import { approvalConfig, documentEditRequests } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { diffFields, valuesEqual } from '../../lib/audit-trail';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { getEntry, requireCompany, selectDocumentEditRows } from './helpers';

/** Is the document-edit approval gate on for this company? Default false — unlike
 *  op-entry, a live document edit applies on save unless this is switched on. */
export async function isDocEditApprovalOn(tx: DbTransaction, companyId: string): Promise<boolean> {
  const rows = await tx
    .select({ flag: approvalConfig.docEditApproval })
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
    .limit(1);
  return rows[0]?.flag ?? false;
}

// ─── Request (stage an edit) ─────────────────────────────────────────────────

export async function requestDocumentEdit(
  entity: string,
  entityId: string,
  input: unknown,
  expectedUpdatedAt: string | null | undefined,
  user: AuthContext,
): Promise<DocumentEditRow> {
  const entry = getEntry(entity);
  await requireFormAccess(user, entry.formKey, 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const target = await entry.loadForDiff(tx, companyId, entityId);
    if (!target) throw new NotFoundError('Document not found. It may have been moved to Trash.');
    // R5 / §20.4 — refuse if the document moved after this form opened it.
    assertUnchangedSinceOpened(target.updatedAt, expectedUpdatedAt);

    const before = entry.beforeSnapshot(target);
    const after = await entry.afterSnapshot(tx, companyId, input, user);
    // Stable change id = the field key; one open edit per document means a field
    // key is unique within a request.
    const changes = diffFields(before, after, entry.diffFields).map((c) => ({ ...c, id: c.field }));
    if (changes.length === 0) throw new ConflictError('Nothing changed to approve.');

    const expectedDate = expectedUpdatedAt
      ? new Date(expectedUpdatedAt)
      : new Date(target.updatedAt as string | number | Date);

    let requestId: string;
    try {
      const inserted = await tx
        .insert(documentEditRequests)
        .values({
          companyId,
          entity,
          entityId,
          docCode: target.docCode,
          expectedUpdatedAt: expectedDate,
          proposedPayload: input,
          changes,
          decisions: [],
          status: 'pending',
          requestedBy: user.id,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: documentEditRequests.id });
      requestId = inserted[0]!.id;
    } catch (e) {
      // Partial unique index document_edit_pending_uq.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictError('This document already has an edit waiting for approval.');
      }
      throw e;
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Request,
        entity,
        entityId,
        refId: target.docCode,
        changes,
        detail: `${target.docCode} — edit requested (${changes.length} change(s) waiting for approval)`,
      },
      companyId,
      user,
    );

    const [row] = await selectDocumentEditRows(tx, companyId, { id: requestId });
    return row!;
  });
}

// ─── Decide (per-change approve / reject) ────────────────────────────────────

export async function decideDocumentEdit(
  input: DecideDocumentEditInput,
  user: AuthContext,
): Promise<DocumentEditRow> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Lock-then-check: a second approver deciding the same request waits here,
    // then re-reads the decided row and is refused by the status check below.
    const reqRows = await tx
      .select()
      .from(documentEditRequests)
      .where(
        and(
          eq(documentEditRequests.id, input.id),
          eq(documentEditRequests.companyId, companyId),
          isNull(documentEditRequests.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const req = reqRows[0];
    if (!req) throw new NotFoundError('Edit request not found.');

    const entry = getEntry(req.entity);
    await requireFormAccess(user, entry.formKey, 'approve');

    if (req.status !== 'pending') {
      throw new ConflictError(
        `This edit was already ${req.status} by someone else — reload the page.`,
      );
    }

    const storedChanges = (req.changes as DocumentEditChange[] | null) ?? [];
    const decisionByChange = new Map(input.decisions.map((d) => [d.changeId, d]));
    for (const c of storedChanges) {
      if (!decisionByChange.has(c.id)) {
        throw new ValidationError(`Decide every change — "${c.label}" has no decision.`);
      }
    }

    // Reload + lock the target; recompute what WOULD change now, so a field the
    // document drifted on since the request is caught and marked superseded.
    const target = await entry.loadForDiff(tx, companyId, req.entityId);
    if (!target) throw new NotFoundError('The document no longer exists.');
    const before = entry.beforeSnapshot(target);
    const after = await entry.afterSnapshot(tx, companyId, req.proposedPayload, user);
    const freshByField = new Map(
      diffFields(before, after, entry.diffFields).map((c) => [c.field, c]),
    );

    const outcomes: DocumentEditDecision[] = [];
    const approvedFields = new Set<string>();
    for (const c of storedChanges) {
      const d = decisionByChange.get(c.id)!;
      if (d.decision === 'reject') {
        outcomes.push({ changeId: c.id, outcome: 'rejected', reason: d.reason?.trim() || null });
        continue;
      }
      const fresh = freshByField.get(c.field);
      // Fresh = the document's current value still equals the value captured when
      // the edit was requested (same comparison diffFields uses).
      if (fresh && valuesEqual(fresh.before, c.before)) {
        outcomes.push({ changeId: c.id, outcome: 'approved', reason: null });
        approvedFields.add(c.field);
      } else {
        outcomes.push({ changeId: c.id, outcome: 'superseded', reason: null });
      }
    }

    const currentToken = target.updatedAt ? new Date(target.updatedAt).toISOString() : null;
    if (approvedFields.size > 0) {
      const filtered = entry.buildFilteredInput(req.proposedPayload, approvedFields);
      if (filtered) await entry.applyEdit(tx, companyId, req.entityId, filtered, currentToken, user);
    }

    const anyApproved = outcomes.some((o) => o.outcome === 'approved');
    const allRejected = outcomes.every((o) => o.outcome === 'rejected');
    const status: DocumentEditStatus = anyApproved
      ? 'approved'
      : allRejected
        ? 'rejected'
        : 'superseded';

    // Guarded write: only a still-pending request moves. 0 rows = someone else
    // decided first; throwing rolls back the applyEdit above (same tx).
    const decided = await tx
      .update(documentEditRequests)
      .set({
        decisions: outcomes,
        status,
        decidedBy: user.id,
        decidedAt: new Date(),
        updatedBy: user.id,
      })
      .where(and(eq(documentEditRequests.id, req.id), eq(documentEditRequests.status, 'pending')))
      .returning({ id: documentEditRequests.id });
    if (decided.length === 0) {
      throw new ConflictError('This edit was already decided by someone else — reload the page.');
    }

    // ADR-197 — APPROVE / REJECT on the document itself, so both show on its
    // History tab. The applied EDIT rows are emitted by the document's own writer.
    const outcomeOf = (id: string): DocumentEditDecision['outcome'] | undefined =>
      outcomes.find((o) => o.changeId === id)?.outcome;
    const appliedChanges = storedChanges.filter((c) => outcomeOf(c.id) === 'approved');
    const rejectedChanges = storedChanges.filter((c) => outcomeOf(c.id) === 'rejected');
    if (appliedChanges.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Approve,
          entity: req.entity,
          entityId: req.entityId,
          refId: req.docCode,
          changes: appliedChanges,
          detail: `${req.docCode} — ${appliedChanges.length} edit(s) approved and applied`,
        },
        companyId,
        user,
      );
    }
    if (rejectedChanges.length > 0) {
      const reason =
        input.decisions
          .filter((d) => d.decision === 'reject' && d.reason?.trim())
          .map((d) => d.reason!.trim())
          .join('; ') || 'Rejected';
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Reject,
          entity: req.entity,
          entityId: req.entityId,
          refId: req.docCode,
          changes: rejectedChanges,
          reason,
          detail: `${req.docCode} — ${rejectedChanges.length} edit(s) rejected`,
        },
        companyId,
        user,
      );
    }

    const [row] = await selectDocumentEditRows(tx, companyId, { id: req.id });
    return row!;
  });
}

// ─── Withdraw (requester pulls it back) ──────────────────────────────────────

export async function withdrawDocumentEdit(
  id: string,
  user: AuthContext,
): Promise<DocumentEditRow> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const reqRows = await tx
      .select()
      .from(documentEditRequests)
      .where(
        and(
          eq(documentEditRequests.id, id),
          eq(documentEditRequests.companyId, companyId),
          isNull(documentEditRequests.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const req = reqRows[0];
    if (!req) throw new NotFoundError('Edit request not found.');
    if (req.requestedBy !== user.id && user.role !== 'admin') {
      throw new AuthorizationError(
        'Only the person who requested this edit, or an admin, can withdraw it.',
      );
    }
    if (req.status !== 'pending') {
      throw new ConflictError(`This edit was already ${req.status} — nothing to withdraw.`);
    }

    const updated = await tx
      .update(documentEditRequests)
      .set({ status: 'withdrawn', updatedBy: user.id })
      .where(and(eq(documentEditRequests.id, req.id), eq(documentEditRequests.status, 'pending')))
      .returning({ id: documentEditRequests.id });
    if (updated.length === 0) {
      throw new ConflictError('This edit was already decided by someone else — reload the page.');
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Withdraw,
        entity: req.entity,
        entityId: req.entityId,
        refId: req.docCode,
        changes: (req.changes as DocumentEditChange[] | null) ?? [],
        detail: `${req.docCode} — edit request withdrawn before approval`,
      },
      companyId,
      user,
    );

    const [row] = await selectDocumentEditRows(tx, companyId, { id: req.id });
    return row!;
  });
}
