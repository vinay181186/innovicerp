// Multi-Level Plan (ADR-225 phase 3) — writes. Each runs inside the caller's
// transaction (service.ts opens it after the access checks).
//
// Lock order, the same on every path so two saves never deadlock:
//   1. the SO LINE row (FOR UPDATE, own statement — guards.ts lockSoLine)
//   2. the ml_plans row (FOR UPDATE)
//   3. the ML BOM tree advisory lock (only when the tree is walked)
//   4. the IN-MLP number series lock (create only)
// The SO edit / short-close / delete paths take (1) through
// readSoLineCommitments, so a plan and an SO change on one line queue.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { ActivityAction, EDIT_CONFLICT_CODE } from '@innovic/shared';
import { mlPlans } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields } from '../../lib/audit-trail';
import { assertUnchangedSinceOpened, timestampMs } from '../../lib/edit-conflict';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { emitActivityLog } from '../activity-log/service';
import { lockMlBomTree } from '../ml-bom/guards';
import { liveOrdersFromMlPlan, lockSoLine, readLineFacts, refusalMessage, soLabel } from './guards';
import { ML_PLAN_NOT_FOUND, loadMlPlanDetail, nextMlPlanCode } from './reads';
import type {
  CancelMlPlanInput,
  CreateMlPlanInput,
  MlPlanDetail,
  RefreshMlPlanInput,
  UpdateMlPlanInput,
} from './schema';
import { snapshotPlanNodes, walkFromBom, walkFromStoredNodes } from './snapshot';

export const ENTITY = 'MlPlan';
const HEADER_FIELDS = [
  { key: 'planQty', label: 'Plan Qty' },
  { key: 'remarks', label: 'Remarks' },
];

const STATUS_WORD: Record<string, string> = {
  draft: 'Draft',
  released: 'Released',
  cancelled: 'Cancelled',
};

/** Plan Qty is complete sets of the SO line, never more than its Order Qty. */
function assertPlanQtyFits(planQty: number, orderQty: number, lineRef: string): void {
  if (planQty > orderQty) {
    throw new ValidationError(
      `Plan Qty (${planQty}) cannot be more than the Order Qty of ${lineRef} (${orderQty}).`,
    );
  }
}

/** The plan's SO line id — read WITHOUT a lock, only to know which line to
 *  lock first (lock order above). */
export async function planLineId(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<string> {
  const rows = await tx
    .select({ soLineId: mlPlans.soLineId })
    .from(mlPlans)
    .where(and(eq(mlPlans.id, id), eq(mlPlans.companyId, companyId), isNull(mlPlans.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError(ML_PLAN_NOT_FOUND);
  return r.soLineId;
}

/** The live plan row, FOR UPDATE. */
export async function lockPlan(tx: DbTransaction, companyId: string, id: string) {
  const rows = await tx
    .select()
    .from(mlPlans)
    .where(and(eq(mlPlans.id, id), eq(mlPlans.companyId, companyId), isNull(mlPlans.deletedAt)))
    .for('update')
    .limit(1);
  const r = rows[0];
  if (!r) throw new NotFoundError(ML_PLAN_NOT_FOUND);
  return r;
}

export async function userName(tx: DbTransaction, userId: string | null): Promise<string> {
  if (!userId) return 'someone';
  const rows = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(full_name), ''), email) AS name
    FROM public.users WHERE id = ${userId}::uuid LIMIT 1
  `)) as unknown as Array<{ name: string | null }>;
  return rows[0]?.name ?? 'someone';
}

/** `updated_at` still the version we locked — compared to the millisecond, as
 *  edit-conflict does (the column keeps microseconds, a JS Date does not). */
const sameVersion = (at: Date) =>
  sql`date_trunc('milliseconds', ${mlPlans.updatedAt}) = date_trunc('milliseconds', ${at.toISOString()}::timestamptz)`;

/** Draft only — Update and Refresh. Says what the plan is instead. */
function assertDraft(row: { code: string; status: string }): void {
  if (row.status !== 'draft') {
    throw new ConflictError(
      `${row.code} is ${STATUS_WORD[row.status] ?? row.status} — only a Draft plan can be changed.`,
    );
  }
}

/**
 * Update / Refresh: the line must STILL be plannable — re-read under the
 * line lock, the plan's own row not counting against itself (it is the
 * `already_planned` it would otherwise hit), nor the plans raised from its
 * own rows (phase 4 — guards.ts lineFactsFromSql).
 */
export async function readFactsStillEligible(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  planId: string,
) {
  const facts = await readLineFacts(tx, companyId, soLineId, planId);
  if (!facts) throw new NotFoundError('The SO line of this plan was removed.');
  if (facts.refusal) throw new ConflictError(refusalMessage(facts));
  return facts;
}

// ─── Create ──────────────────────────────────────────────────────────────

export async function createMlPlanTx(
  tx: DbTransaction,
  companyId: string,
  input: CreateMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  // §20.3 — the SO line is the parent: lock it FIRST, in its own statement,
  // then re-check eligibility in the NEXT statement (which sees anything the
  // previous lock holder committed — e.g. a plan made a moment ago).
  if (!(await lockSoLine(tx, companyId, input.soLineId))) {
    throw new NotFoundError('SO line not found. It may have been removed — refresh the page.');
  }
  const facts = await readLineFacts(tx, companyId, input.soLineId);
  if (!facts) {
    throw new NotFoundError('SO line not found. It may have been removed — refresh the page.');
  }
  if (facts.refusal) throw new ConflictError(refusalMessage(facts));
  const lineRef = `${soLabel(facts)} Line ${facts.lineNo}`;
  assertPlanQtyFits(input.planQty, facts.orderQty, lineRef);

  // One committed state of the BOM tree for the walk + the BOM Rev it pins.
  await lockMlBomTree(tx, companyId);
  const walked = await walkFromBom(tx, companyId, facts.mlBomId!);

  const code = await nextMlPlanCode(tx, companyId);
  const inserted = await tx
    .insert(mlPlans)
    .values({
      companyId,
      code,
      salesOrderId: facts.salesOrderId,
      soLineId: facts.soLineId,
      itemId: facts.itemId!,
      mlBomId: facts.mlBomId!,
      mlBomRevision: walked.revision,
      planQty: input.planQty,
      status: 'draft',
      remarks: input.remarks?.trim() || null,
      snapshotAt: new Date(),
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: mlPlans.id });
  const planId = inserted[0]!.id;

  const nodes = await snapshotPlanNodes(
    tx,
    { companyId, planId, planQty: input.planQty, walk: walked.nodes },
    user,
  );

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Create,
      entity: ENTITY,
      entityId: planId,
      refId: code,
      qty: input.planQty,
      detail:
        `${code} — ${lineRef} · ${facts.itemCode ?? ''} × ${input.planQty} from ` +
        `${facts.mlBomCode ?? ''} Rev ${walked.revision} (${nodes.length} rows)`,
    },
    companyId,
    user,
  );
  return loadMlPlanDetail(tx, planId, companyId);
}

// ─── Update (Draft: Plan Qty / Remarks, figures re-worked) ───────────────

export async function updateMlPlanTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: UpdateMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  const soLineId = await planLineId(tx, companyId, id);
  await lockSoLine(tx, companyId, soLineId);
  const row = await lockPlan(tx, companyId, id);
  assertDraft(row);
  // §20.4 — refuse if someone else saved this plan after the form opened it.
  assertUnchangedSinceOpened(row.updatedAt, input.expectedUpdatedAt);

  const facts = await readFactsStillEligible(tx, companyId, soLineId, id);
  assertPlanQtyFits(input.planQty, facts.orderQty, `${soLabel(facts)} Line ${facts.lineNo}`);

  const remarks = input.remarks === undefined ? row.remarks : input.remarks?.trim() || null;
  // §20.2 — conditional on the status AND the version we locked.
  const updated = await tx
    .update(mlPlans)
    .set({
      planQty: input.planQty,
      remarks,
      snapshotAt: new Date(),
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(mlPlans.id, id), eq(mlPlans.status, 'draft'), sameVersion(row.updatedAt)))
    .returning({ id: mlPlans.id });
  if (updated.length === 0) {
    throw new AppError(
      409,
      EDIT_CONFLICT_CODE,
      `${row.code} was changed by someone else — reload.`,
    );
  }

  // Same copied structure (the pin holds), new Plan Qty, fresh pools.
  const walk = await walkFromStoredNodes(tx, companyId, id);
  await snapshotPlanNodes(tx, { companyId, planId: id, planQty: input.planQty, walk }, user);

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: ENTITY,
      entityId: id,
      refId: row.code,
      changes: diffFields(
        { planQty: row.planQty, remarks: row.remarks },
        { planQty: input.planQty, remarks },
        HEADER_FIELDS,
      ),
      detail: `Edited ${row.code} — figures re-worked`,
    },
    companyId,
    user,
  );
  return loadMlPlanDetail(tx, id, companyId);
}

// ─── Refresh (Draft: re-copy from the BOM as it is now) ──────────────────

export async function refreshMlPlanTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: RefreshMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  const soLineId = await planLineId(tx, companyId, id);
  await lockSoLine(tx, companyId, soLineId);
  const row = await lockPlan(tx, companyId, id);
  assertDraft(row);
  assertUnchangedSinceOpened(row.updatedAt, input.expectedUpdatedAt);

  await lockMlBomTree(tx, companyId);
  // Still plannable (under the line lock, after the tree lock so the Default
  // read here is the one the walk copies) — and the target is the item's
  // live Default BOM NOW, which may be another BOM than the pinned one.
  const facts = await readFactsStillEligible(tx, companyId, soLineId, id);
  const target = { id: facts.mlBomId!, code: facts.mlBomCode ?? '' };
  const before = (await tx.execute(sql`
    SELECT code FROM public.ml_boms
    WHERE id = ${row.mlBomId}::uuid AND company_id = ${companyId}::uuid
    LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const walked = await walkFromBom(tx, companyId, target.id);

  const updated = await tx
    .update(mlPlans)
    .set({
      mlBomId: target.id,
      mlBomRevision: walked.revision,
      snapshotAt: new Date(),
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(mlPlans.id, id), eq(mlPlans.status, 'draft'), sameVersion(row.updatedAt)))
    .returning({ id: mlPlans.id });
  if (updated.length === 0) {
    throw new AppError(
      409,
      EDIT_CONFLICT_CODE,
      `${row.code} was changed by someone else — reload.`,
    );
  }
  await snapshotPlanNodes(
    tx,
    { companyId, planId: id, planQty: row.planQty, walk: walked.nodes },
    user,
  );

  const fromRef = `${before[0]?.code ?? ''} Rev ${row.mlBomRevision}`;
  const toRef = `${target.code} Rev ${walked.revision}`;
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: ENTITY,
      entityId: id,
      refId: row.code,
      changes:
        fromRef === toRef
          ? null
          : [{ field: 'mlBom', label: 'Multi-Level BOM', before: fromRef, after: toRef }],
      detail: `Refreshed ${row.code} from ${toRef}`,
    },
    companyId,
    user,
  );
  return loadMlPlanDetail(tx, id, companyId);
}

// ─── Cancel ──────────────────────────────────────────────────────────────

export async function cancelMlPlanTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: CancelMlPlanInput,
  user: AuthContext,
): Promise<MlPlanDetail> {
  const reason = input.reason.trim();
  // The row lock first (a second cancel waits here), and the status it had —
  // for the History row. The UPDATE below is still conditional (§20.2).
  const soLineId = await planLineId(tx, companyId, id);
  await lockSoLine(tx, companyId, soLineId);
  const row = await lockPlan(tx, companyId, id);
  // Phase 4: refuse while orders made from the plan are live (read under
  // the plan's lock, which Raise orders also takes — so a raise and a
  // cancel queue, and the second sees the first).
  const live = await liveOrdersFromMlPlan(tx, companyId, id);
  if (live.length > 0) {
    throw new ConflictError(
      `${row.code} has live orders: ${live.join(', ')} — delete / cancel them first.`,
    );
  }

  const expected = input.expectedUpdatedAt;
  if (expected !== undefined && Number.isNaN(timestampMs(expected))) {
    throw new ValidationError('expectedUpdatedAt is not a valid timestamp');
  }
  const versionFrag =
    expected !== undefined
      ? sql`AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${new Date(timestampMs(expected)).toISOString()}::timestamptz)`
      : sql``;

  // §20.2 — one conditional UPDATE; 0 rows = someone got there first.
  const rows = (await tx.execute(sql`
    UPDATE public.ml_plans
    SET status = 'cancelled', cancel_reason = ${reason}, cancelled_at = now(),
        cancelled_by = ${user.id}::uuid, updated_by = ${user.id}::uuid, updated_at = now()
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND status <> 'cancelled'
      ${versionFrag}
    RETURNING code, plan_qty
  `)) as unknown as Array<{ code: string; plan_qty: number }>;

  if (rows.length === 0) {
    const cur = (await tx.execute(sql`
      SELECT code, status, cancelled_at, cancelled_by, updated_at, updated_by
      FROM public.ml_plans
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    const c = cur[0];
    if (!c) throw new NotFoundError(ML_PLAN_NOT_FOUND);
    if (c['status'] === 'cancelled') {
      const who = await userName(tx, (c['cancelled_by'] as string | null) ?? null);
      throw new ConflictError(
        `${String(c['code'])} was already cancelled by ${who} at ${fmtDateTime(c['cancelled_at'] as string)}.`,
      );
    }
    const who = await userName(tx, (c['updated_by'] as string | null) ?? null);
    throw new AppError(
      409,
      EDIT_CONFLICT_CODE,
      `${String(c['code'])} was changed by ${who} at ${fmtDateTime(c['updated_at'] as string)} — reload and try again.`,
    );
  }

  const done = rows[0]!;
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: ENTITY,
      entityId: id,
      refId: done.code,
      qty: Number(done.plan_qty),
      reason,
      changes: [
        {
          field: 'status',
          label: 'Plan Status',
          before: STATUS_WORD[row.status] ?? row.status,
          after: 'Cancelled',
        },
      ],
      detail: `${done.code} cancelled`,
    },
    companyId,
    user,
  );
  return loadMlPlanDetail(tx, id, companyId);
}
