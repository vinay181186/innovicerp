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
import { canSeeFormPrice, primeAccess, requireFormAccess } from '../../lib/access';
import { diffFields, valuesEqual } from '../../lib/audit-trail';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { getEntry, maskPriceChanges, requireCompany, selectDocumentEditRows } from './helpers';
import { isPriceField } from './price-field';
import type { DocEditTarget } from './registry';

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

/** The requester's own note on the edit — a `reason` field on the payload (the
 *  Dispatch and DC edit screens send one; the Party GRN and Production Order
 *  edit schemas accept one; the SO OrStage adds the route's separate edit
 *  reason) — written on the REQUEST row of the document's History so it is not
 *  lost while the edit waits. Dispatch, DC and SO also pass it on to the
 *  approved EDIT row (their writers record a reason; the Party GRN and
 *  Production Order writers do not). Empty → none. */
function requestNote(input: unknown): string | null {
  const reason = (input as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

/** The module's own staging refusals (a line added / removed, a status move,
 *  a JC raw-material or routing check, a GSTIN problem, a PRO qty change…). Run
 *  by requestDocumentEdit for a LIVE document only, inside its transaction and
 *  under the locks loadForDiff took — so the check and the staging read one
 *  and the same state. Throw to refuse. Return a payload to freeze INSTEAD of
 *  the input (the Job Card adds its Final Inspection id), or nothing. */
export type DocEditPrecheck = (tx: DbTransaction, target: DocEditTarget) => Promise<unknown>;

// ─── Request (stage an edit) ─────────────────────────────────────────────────

/**
 * Stage an edit for approval — or say it is not to be staged. ONE transaction,
 * ONE locked load, ONE "is it still live?" rule (the registry entry's isLive):
 *   gate off, document gone / not visible, or not live → null, nothing written:
 *     the caller then runs its direct writer exactly as before;
 *   live → the version check (§20.4), then `precheck` under the same lock,
 *     then the diff and the request row.
 * Every update<Doc>OrStage calls this; none of them decides liveness itself.
 * The `edit` tick is checked only for a document that is actually staged, so a
 * direct edit keeps whatever access its own writer asks for.
 */
export async function requestDocumentEdit(
  entity: string,
  entityId: string,
  input: unknown,
  expectedUpdatedAt: string | null | undefined,
  user: AuthContext,
  precheck?: DocEditPrecheck,
): Promise<DocumentEditRow | null> {
  // Access is read now, outside the transaction below (see primeAccess): the
  // Edit-tick and price checks run while the document is locked.
  await primeAccess(user);
  return withUserContext(user, (tx) =>
    requestDocumentEditInTx(tx, entity, entityId, input, expectedUpdatedAt, user, precheck),
  );
}

/**
 * requestDocumentEdit inside a transaction the caller already holds (ADR-249
 * Step B: a master Excel import staging one request per row, a Route Card
 * rewrite from a JC create / Plan execute). Runs in a SAVEPOINT, so a refusal
 * (nothing changed, already waiting, …) rolls back only this request and the
 * caller's transaction carries on. The caller must have called primeAccess.
 */
export interface RequestDocumentEditOpts {
  /** A save of ANOTHER document proposes this change (a JC / Plan bringing a
   *  new routing for the item's Route Card): the proposer needs no Edit tick
   *  on this page — they could not edit it directly either; the approver's
   *  Approve tick decides. */
  proposedBySourceDoc?: boolean;
  /** The caller already read the gate as ON in this same transaction (a
   *  master Excel import staging many rows) — skip re-reading it per row. */
  gateKnownOn?: boolean;
}

export async function requestDocumentEditInTx(
  outer: DbTransaction,
  entity: string,
  entityId: string,
  input: unknown,
  expectedUpdatedAt: string | null | undefined,
  user: AuthContext,
  precheck?: DocEditPrecheck,
  opts?: RequestDocumentEditOpts,
): Promise<DocumentEditRow | null> {
  const requestId = await requestDocumentEditIdInTx(
    outer,
    entity,
    entityId,
    input,
    expectedUpdatedAt,
    user,
    precheck,
    opts,
  );
  if (requestId === null) return null;
  const companyId = requireCompany(user);
  const [row] = await selectDocumentEditRows(outer, companyId, { id: requestId });
  // Access is already read for this request (memo), so no extra connection.
  return (await maskPriceChanges([row!], user))[0]!;
}

/**
 * requestDocumentEditInTx WITHOUT reading the request row back: returns the new
 * request's id (or null — same rules). For callers that stage many rows and
 * only need to know each was staged (a master / ML-BOM Excel import), so each
 * row saves the re-select and the price masking.
 */
export async function requestDocumentEditIdInTx(
  outer: DbTransaction,
  entity: string,
  entityId: string,
  input: unknown,
  expectedUpdatedAt: string | null | undefined,
  user: AuthContext,
  precheck?: DocEditPrecheck,
  opts?: RequestDocumentEditOpts,
): Promise<string | null> {
  const entry = getEntry(entity);
  const companyId = requireCompany(user);

  return outer.transaction(async (tx) => {
    if (!opts?.gateKnownOn && !(await isDocEditApprovalOn(tx, companyId))) return null;
    // Locks the document (and its lines / ops) in the writer's own order.
    const target = await entry.loadForDiff(tx, companyId, entityId, { purpose: 'request' });
    if (!target?.isLive) return null;
    if (!opts?.proposedBySourceDoc) await requireFormAccess(user, entry.formKey, 'edit');
    // R5 / §20.4 — refuse if the document moved after this form opened it.
    // FIRST, so a stale form is told to reload rather than given a business
    // refusal about a document it is not looking at any more.
    assertUnchangedSinceOpened(target.updatedAt, expectedUpdatedAt);
    const checked = precheck ? await precheck(tx, target) : undefined;
    const payload = checked === undefined ? input : checked;

    const before = entry.beforeSnapshot(target, payload, new Set());
    const after = await entry.afterSnapshot(tx, companyId, payload, user, target);
    // Stable change id = the field key; one open edit per document means a field
    // key is unique within a request.
    const changes = diffFields(before, after, entry.diffFields(target, payload)).map((c) => ({
      ...c,
      id: c.field,
    }));
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
          proposedPayload: payload,
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

    const note = requestNote(payload);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Request,
        entity,
        entityId,
        refId: target.docCode,
        changes,
        ...(note ? { reason: note } : {}),
        detail: `${target.docCode} — edit requested (${changes.length} change(s) waiting for approval)`,
      },
      companyId,
      user,
    );

    return requestId;
  });
}

// ─── Decide (per-change approve / reject) ────────────────────────────────────

export async function decideDocumentEdit(
  input: DecideDocumentEditInput,
  user: AuthContext,
): Promise<DocumentEditRow> {
  // Access is read now, outside the transaction below (see primeAccess): the
  // Approve-tick check runs after the request row is locked, and the writer's
  // price check (canSeeFormPrice) runs while the document is locked too.
  await primeAccess(user);
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
    // Outcomes recorded by EARLIER decide calls on this same request. Per-field
    // immediate decide (1A): each call resolves only the changes it names, so a
    // request can be decided across several calls by one or more approvers.
    const priorOutcomes = (req.decisions as DocumentEditDecision[] | null) ?? [];
    const decidedIds = new Set(priorOutcomes.map((o) => o.changeId));
    const decisionByChange = new Map(input.decisions.map((d) => [d.changeId, d]));

    // Validate every change this call names: it must be a real change on this
    // request, and it must NOT already carry an outcome. A rival approver who
    // decided the same change first (and committed before our FOR UPDATE lock was
    // granted) is already reflected in priorOutcomes, so this is where exactly one
    // of two concurrent deciders of the same change wins and the other is refused.
    for (const d of input.decisions) {
      const change = storedChanges.find((c) => c.id === d.changeId);
      if (!change) {
        throw new ValidationError(`Unknown change "${d.changeId}" for this edit request.`);
      }
      if (decidedIds.has(d.changeId)) {
        throw new ConflictError(
          `"${change.label}" was already decided by someone else — reload the page.`,
        );
      }
      // A price the approver may not see (blanked in their inbox) can be
      // rejected but not approved: the document's writer keeps the stored
      // figure for a price-blind caller, so the approval would report a change
      // it never wrote. A price box (isPriceField), or a box that carries a
      // price in its proposed value (the entry's carriesPrice — a Job Card
      // operation added with an outsource cost).
      if (
        d.decision === 'approve' &&
        (isPriceField(change.field) ||
          (entry.carriesPrice?.(change.field, req.proposedPayload) ?? false))
      ) {
        if (!(await canSeeFormPrice(user, entry.formKey))) {
          throw new ConflictError(
            `"${change.label}" is a price you cannot see on this page — you can reject it, or ask someone who can see prices to approve it.`,
          );
        }
      }
    }

    // Reload + lock the target; recompute what WOULD change now, so a field the
    // document drifted on since the request is caught and marked superseded.
    const target = await entry.loadForDiff(tx, companyId, req.entityId, { purpose: 'decide' });
    if (!target) throw new NotFoundError('The document no longer exists.');
    // The boxes earlier decide calls on this request already applied — so a
    // row-set box (`line:add:<n>`) does not read this request's own adds /
    // removes as someone else's drift.
    const priorApproved = new Set(
      priorOutcomes
        .filter((o) => o.outcome === 'approved')
        .map((o) => storedChanges.find((c) => c.id === o.changeId)?.field ?? o.changeId),
    );
    const before = entry.beforeSnapshot(target, req.proposedPayload, priorApproved);
    // Prices included whatever THIS approver may see: the fresh before/after
    // must be the same facts the requester staged, or a price box would read
    // as "superseded" to a price-blind approver.
    const after = await entry.afterSnapshot(tx, companyId, req.proposedPayload, user, target, {
      allPrices: true,
    });
    const freshByField = new Map(
      diffFields(before, after, entry.diffFields(target, req.proposedPayload)).map((c) => [
        c.field,
        c,
      ]),
    );

    // Resolve ONLY the changes named in this call; untouched changes stay pending.
    const newOutcomes: DocumentEditDecision[] = [];
    const approvedFields = new Set<string>();
    for (const c of storedChanges) {
      const d = decisionByChange.get(c.id);
      if (!d) continue; // not decided in this call — leave it pending
      if (d.decision === 'reject') {
        newOutcomes.push({ changeId: c.id, outcome: 'rejected', reason: d.reason?.trim() || null });
        continue;
      }
      const fresh = freshByField.get(c.field);
      // Fresh = the document's current value still equals the value captured when
      // the edit was requested (same comparison diffFields uses).
      if (fresh && valuesEqual(fresh.before, c.before)) {
        newOutcomes.push({ changeId: c.id, outcome: 'approved', reason: null });
        approvedFields.add(c.field);
      } else {
        newOutcomes.push({ changeId: c.id, outcome: 'superseded', reason: null });
      }
    }

    // Apply ONLY the fields approved in THIS call. buildFilteredInput narrows the
    // proposed payload to those keys, so still-pending and rejected fields — and
    // fields approved by an earlier call (already written then) — are not touched.
    const currentToken = target.updatedAt ? new Date(target.updatedAt).toISOString() : null;
    if (approvedFields.size > 0) {
      // `firstApply` — no earlier decide call on this request applied anything,
      // so a once-per-request extra (the BOM Revision Note) is applied once.
      const filtered = entry.buildFilteredInput(req.proposedPayload, approvedFields, {
        firstApply: !priorOutcomes.some((o) => o.outcome === 'approved'),
      });
      if (filtered)
        await entry.applyEdit(tx, companyId, req.entityId, filtered, currentToken, user, target);
    }

    // Merge this call's outcomes with the earlier ones, then decide the request's
    // own status. It stays 'pending' until EVERY change has an outcome; only the
    // last decide finalizes it — approved if any change was applied, rejected if
    // every change was rejected, superseded otherwise (none applied, at least one
    // drifted). Reuses DOCUMENT_EDIT_STATUSES values; no new status invented.
    const outcomes = [...priorOutcomes, ...newOutcomes];
    const outcomeIds = new Set(outcomes.map((o) => o.changeId));
    const allDecided = storedChanges.every((c) => outcomeIds.has(c.id));
    const anyApproved = outcomes.some((o) => o.outcome === 'approved');
    const allRejected = outcomes.every((o) => o.outcome === 'rejected');
    const status: DocumentEditStatus = !allDecided
      ? 'pending'
      : anyApproved
        ? 'approved'
        : allRejected
          ? 'rejected'
          : 'superseded';

    // Guarded write (§20.2): only a still-pending request moves. We hold the row
    // FOR UPDATE, so a rival decide blocked on the lock and re-read our merged
    // outcomes above; 0 rows here still rolls back the applyEdit above (same tx).
    // decidedBy/decidedAt are stamped only when the request is finally resolved.
    const decided = await tx
      .update(documentEditRequests)
      .set({
        decisions: outcomes,
        status,
        ...(allDecided ? { decidedBy: user.id, decidedAt: new Date() } : {}),
        updatedBy: user.id,
      })
      .where(and(eq(documentEditRequests.id, req.id), eq(documentEditRequests.status, 'pending')))
      .returning({ id: documentEditRequests.id });
    if (decided.length === 0) {
      throw new ConflictError('This edit was already decided by someone else — reload the page.');
    }

    // ADR-197 — APPROVE / REJECT on the document itself, so both show on its
    // History tab. Logged for the changes resolved in THIS call only; the applied
    // EDIT rows are emitted by the document's own writer.
    const outcomeOf = (id: string): DocumentEditDecision['outcome'] | undefined =>
      newOutcomes.find((o) => o.changeId === id)?.outcome;
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
    // Access is already read for this request (memo), so no extra connection.
    return (await maskPriceChanges([row!], user))[0]!;
  });
}

// ─── Withdraw (requester pulls it back) ──────────────────────────────────────

export async function withdrawDocumentEdit(
  id: string,
  user: AuthContext,
): Promise<DocumentEditRow> {
  // Access is read now, outside the transaction below (see primeAccess).
  await primeAccess(user);
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
    // ADR-232: the requester, or anyone who may approve edits on that page.
    if (req.requestedBy !== user.id) {
      await requireFormAccess(user, getEntry(req.entity).formKey, 'approve');
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
    // Access is already read for this request (memo), so no extra connection.
    return (await maskPriceChanges([row!], user))[0]!;
  });
}
