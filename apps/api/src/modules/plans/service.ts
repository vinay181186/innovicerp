// Plans service (PL-3 of Phase B Planning module per ADR-030).
//
// CRUD + status finalize for the new plans + plan_ops tables. Scope:
//   - list + get + create (in_planning only) + update + softDelete
//   - finalizePlan: in_planning → planned (lone forward transition shipped in PL-3)
//   - planning dashboard aggregate (KPI counts + recent plans table)
//
// Out of scope (deferred to PL-4):
//   - executePlan (planned → jc_created | pr_created with JC/PR creation)
//   - status updates beyond finalize
//   - default-ops auto-load from route_card
//
// Service-layer state-machine guards mirror the DB CHECK constraints from
// 0024_phase8_plans.sql. Both layers must agree; the service enforces friendly
// errors, the DB catches anything that slips through.

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CreatePlanInput,
  ListPlansQuery,
  ListPlansResponse,
  Plan,
  PlanDetail,
  PlanOp,
  PlanOpInput,
  PlanningDashboardResponse,
  PlanStatus,
  UpdatePlanInput,
} from '@innovic/shared';
import { items, planOps, plans } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const EDITABLE_STATUSES: readonly PlanStatus[] = ['in_planning', 'planned'];

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function numericToString(v: number | null | undefined): string | null {
  return v == null ? null : v.toFixed(2);
}

function detail(plan: { code: string; planType: string; itemNameText: string | null }): string {
  return `${plan.code} — ${plan.itemNameText ?? plan.planType}`;
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listPlans(
  query: ListPlansQuery,
  user: AuthContext,
): Promise<ListPlansResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const conditions = [eq(plans.companyId, companyId), isNull(plans.deletedAt)];
    if (query.status) conditions.push(eq(plans.planStatus, query.status));
    if (query.planType) conditions.push(eq(plans.planType, query.planType));
    if (query.soLineId) conditions.push(eq(plans.soLineId, query.soLineId));

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(${plans.code} ILIKE ${term} OR ${plans.itemCodeText} ILIKE ${term} OR ${plans.itemNameText} ILIKE ${term} OR ${plans.soCodeText} ILIKE ${term})`,
      );
    }

    const rows = await tx
      .select({
        plan: plans,
        itemCode: items.code,
        itemName: items.name,
      })
      .from(plans)
      .leftJoin(items, and(eq(items.id, plans.itemId), isNull(items.deletedAt)))
      .where(and(...conditions))
      .orderBy(desc(plans.planDate), asc(plans.code))
      .limit(query.limit)
      .offset(query.offset);

    const totalRows = await tx
      .select({ value: count() })
      .from(plans)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    // Ops counts in one batched query
    const ids = rows.map((r) => r.plan.id);
    const opsCounts = new Map<string, number>();
    if (ids.length > 0) {
      const opsAgg = await tx
        .select({ planId: planOps.planId, c: count() })
        .from(planOps)
        .where(and(inArray(planOps.planId, ids), isNull(planOps.deletedAt)))
        .groupBy(planOps.planId);
      for (const r of opsAgg) opsCounts.set(r.planId, Number(r.c));
    }

    return {
      items: rows.map((r) => ({
        ...toPlan(r.plan),
        itemCode: r.itemCode ?? null,
        itemName: r.itemName ?? null,
        opsCount: opsCounts.get(r.plan.id) ?? 0,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  });
}

export async function getPlan(id: string, user: AuthContext): Promise<PlanDetail> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select({
        plan: plans,
        itemCode: items.code,
        itemName: items.name,
      })
      .from(plans)
      .leftJoin(items, and(eq(items.id, plans.itemId), isNull(items.deletedAt)))
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1);
    const row = headers[0];
    if (!row) throw new NotFoundError(`Plan ${id} not found`);

    const opRows = await tx
      .select()
      .from(planOps)
      .where(and(eq(planOps.planId, id), isNull(planOps.deletedAt)))
      .orderBy(asc(planOps.opSeq));

    return {
      ...toPlan(row.plan),
      itemCode: row.itemCode ?? null,
      itemName: row.itemName ?? null,
      ops: opRows.map(toPlanOp),
    };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createPlan(
  input: CreatePlanInput,
  user: AuthContext,
): Promise<PlanDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(
        and(
          eq(plans.companyId, companyId),
          eq(plans.code, input.code),
          isNull(plans.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Plan code "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(plans)
      .values({
        companyId,
        code: input.code,
        planDate: input.planDate,
        planStatus: 'in_planning',
        planType: input.planType,
        soLineId: input.soLineId ?? null,
        soCodeText: input.soCodeText ?? null,
        lineNo: input.lineNo ?? null,
        itemId: input.itemId ?? null,
        itemCodeText: input.itemCodeText ?? null,
        itemNameText: input.itemNameText ?? null,
        orderQty: input.orderQty,
        planQty: input.planQty,
        plannedStartDate: input.plannedStartDate ?? null,
        plannedEndDate: input.plannedEndDate ?? null,
        bomMasterId: input.bomMasterId ?? null,
        bomParentCode: input.bomParentCode ?? null,
        bomChildCode: input.bomChildCode ?? null,
        dpVendorId: input.dpVendorId ?? null,
        dpVendorCodeText: input.dpVendorCodeText ?? null,
        dpCost: numericToString(input.dpCost),
        dpRemarks: input.dpRemarks ?? null,
        foVendorId: input.foVendorId ?? null,
        foVendorCodeText: input.foVendorCodeText ?? null,
        foProcess: input.foProcess ?? null,
        foRate: numericToString(input.foRate),
        foMaterialSrc: input.foMaterialSrc ?? null,
        foDeliveryDate: input.foDeliveryDate ?? null,
        foCostCenter: input.foCostCenter ?? null,
        foRemarks: input.foRemarks ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const plan = inserted[0]!;

    if (input.ops && input.ops.length > 0) {
      await insertOps(tx, companyId, plan.id, input.ops, user);
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Plan',
        detail: detail(plan),
        refId: plan.code,
      },
      companyId,
      user,
    );

    return getPlanInTx(tx, plan.id, companyId);
  });
}

export async function updatePlan(
  id: string,
  input: UpdatePlanInput,
  user: AuthContext,
): Promise<PlanDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`Plan ${id} not found`);

    if (!EDITABLE_STATUSES.includes(row.planStatus)) {
      throw new ValidationError(
        `Plan in status '${row.planStatus}' cannot be edited (only in_planning / planned)`,
      );
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.planDate !== undefined) updates['planDate'] = input.planDate;
    if (input.planType !== undefined) updates['planType'] = input.planType;
    if (input.orderQty !== undefined) updates['orderQty'] = input.orderQty;
    if (input.planQty !== undefined) updates['planQty'] = input.planQty;
    if (input.plannedStartDate !== undefined) updates['plannedStartDate'] = input.plannedStartDate;
    if (input.plannedEndDate !== undefined) updates['plannedEndDate'] = input.plannedEndDate;
    if (input.dpVendorId !== undefined) updates['dpVendorId'] = input.dpVendorId;
    if (input.dpVendorCodeText !== undefined) updates['dpVendorCodeText'] = input.dpVendorCodeText;
    if (input.dpCost !== undefined) updates['dpCost'] = numericToString(input.dpCost);
    if (input.dpRemarks !== undefined) updates['dpRemarks'] = input.dpRemarks;
    if (input.foVendorId !== undefined) updates['foVendorId'] = input.foVendorId;
    if (input.foVendorCodeText !== undefined) updates['foVendorCodeText'] = input.foVendorCodeText;
    if (input.foProcess !== undefined) updates['foProcess'] = input.foProcess;
    if (input.foRate !== undefined) updates['foRate'] = numericToString(input.foRate);
    if (input.foMaterialSrc !== undefined) updates['foMaterialSrc'] = input.foMaterialSrc;
    if (input.foDeliveryDate !== undefined) updates['foDeliveryDate'] = input.foDeliveryDate;
    if (input.foCostCenter !== undefined) updates['foCostCenter'] = input.foCostCenter;
    if (input.foRemarks !== undefined) updates['foRemarks'] = input.foRemarks;
    if (input.remarks !== undefined) updates['remarks'] = input.remarks;

    await tx.update(plans).set(updates).where(eq(plans.id, id));

    // Ops replace-all when provided.
    if (input.ops !== undefined) {
      await tx
        .update(planOps)
        .set({ deletedAt: new Date(), updatedBy: user.id })
        .where(and(eq(planOps.planId, id), isNull(planOps.deletedAt)));
      if (input.ops.length > 0) {
        await insertOps(tx, companyId, id, input.ops, user);
      }
    }

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Plan',
        detail: detail(row),
        refId: row.code,
      },
      companyId,
      user,
    );

    return getPlanInTx(tx, id, companyId);
  });
}

/** Transition: in_planning → planned. Single forward state move shipped in
 *  PL-3; the bigger executePlan() that lands jc_created / pr_created comes
 *  with PL-4. Idempotent: planned → planned is a no-op. */
export async function finalizePlan(id: string, user: AuthContext): Promise<PlanDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`Plan ${id} not found`);

    if (row.planStatus === 'planned') {
      // Idempotent: caller sent finalize again on an already-planned row.
      return getPlanInTx(tx, id, companyId);
    }
    if (row.planStatus !== 'in_planning') {
      throw new ValidationError(
        `Plan in status '${row.planStatus}' cannot be finalized (must be in_planning)`,
      );
    }

    // Manufacture + assembly plans require at least 1 op to be finalized.
    if (row.planType === 'manufacture' || row.planType === 'assembly') {
      const opCheck = await tx
        .select({ c: count() })
        .from(planOps)
        .where(and(eq(planOps.planId, id), isNull(planOps.deletedAt)));
      const ops = opCheck[0]?.c ?? 0;
      if (Number(ops) === 0) {
        throw new ValidationError(
          `${row.planType} plan requires at least 1 operation to be finalized`,
        );
      }
    }

    await tx
      .update(plans)
      .set({ planStatus: 'planned', updatedBy: user.id })
      .where(eq(plans.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'PLAN_FINALIZED',
        entity: 'Plan',
        detail: `${row.code} — ${row.planType} marked Planned`,
        refId: row.code,
      },
      companyId,
      user,
    );

    return getPlanInTx(tx, id, companyId);
  });
}

export async function softDeletePlan(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: plans.id,
        code: plans.code,
        planType: plans.planType,
        planStatus: plans.planStatus,
        itemNameText: plans.itemNameText,
      })
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`Plan ${id} not found`);

    if (!EDITABLE_STATUSES.includes(row.planStatus)) {
      throw new ConflictError(
        `Plan in status '${row.planStatus}' cannot be deleted — cancel via the workflow instead`,
      );
    }

    const now = new Date();
    await tx
      .update(planOps)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(planOps.planId, id), isNull(planOps.deletedAt)));
    await tx
      .update(plans)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(eq(plans.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'Plan',
        detail: detail(row),
        refId: row.code,
      },
      companyId,
      user,
    );

    return { ok: true };
  });
}

// ─── Planning dashboard ───────────────────────────────────────────────────

export async function getPlanningDashboard(
  user: AuthContext,
): Promise<PlanningDashboardResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const [statusCounts, recentRows] = await Promise.all([
      tx
        .select({ status: plans.planStatus, c: count() })
        .from(plans)
        .where(and(eq(plans.companyId, companyId), isNull(plans.deletedAt)))
        .groupBy(plans.planStatus),
      tx
        .select({
          plan: plans,
          itemCode: items.code,
          itemName: items.name,
        })
        .from(plans)
        .leftJoin(items, and(eq(items.id, plans.itemId), isNull(items.deletedAt)))
        .where(and(eq(plans.companyId, companyId), isNull(plans.deletedAt)))
        .orderBy(desc(plans.planDate), asc(plans.code))
        .limit(50),
    ]);

    const byStatus = new Map<PlanStatus, number>();
    for (const r of statusCounts) byStatus.set(r.status, Number(r.c));

    const recentIds = recentRows.map((r) => r.plan.id);
    const opsCounts = new Map<string, number>();
    if (recentIds.length > 0) {
      const opsAgg = await tx
        .select({ planId: planOps.planId, c: count() })
        .from(planOps)
        .where(and(inArray(planOps.planId, recentIds), isNull(planOps.deletedAt)))
        .groupBy(planOps.planId);
      for (const r of opsAgg) opsCounts.set(r.planId, Number(r.c));
    }

    return {
      generatedAt: new Date().toISOString(),
      kpi: {
        needsPlanning: 0, // legacy "open SO lines with no plan" — deferred to PL-4
        inPlanning: byStatus.get('in_planning') ?? 0,
        planned: byStatus.get('planned') ?? 0,
        jcCreated: byStatus.get('jc_created') ?? 0,
        prCreated: byStatus.get('pr_created') ?? 0,
        inProduction: byStatus.get('in_production') ?? 0,
        complete: byStatus.get('complete') ?? 0,
      },
      recentPlans: recentRows.map((r) => ({
        ...toPlan(r.plan),
        itemCode: r.itemCode ?? null,
        itemName: r.itemName ?? null,
        opsCount: opsCounts.get(r.plan.id) ?? 0,
      })),
    };
  });
}

// ─── Internals ────────────────────────────────────────────────────────────

async function insertOps(
  tx: DbTransaction,
  companyId: string,
  planId: string,
  ops: PlanOpInput[],
  user: AuthContext,
): Promise<void> {
  const seen = new Set<number>();
  for (const op of ops) {
    if (seen.has(op.opSeq)) {
      throw new ValidationError(`Duplicate op_seq ${op.opSeq} within plan ops`);
    }
    seen.add(op.opSeq);
  }
  const values = ops.map((op) => ({
    companyId,
    planId,
    opSeq: op.opSeq,
    machineId: op.machineId ?? null,
    machineCodeText: op.machineCodeText ?? null,
    operation: op.operation,
    opType: op.opType ?? 'process',
    cycleTimeMin: (op.cycleTimeMin ?? 0).toFixed(2),
    program: op.program ?? null,
    toolDetails: op.toolDetails ?? null,
    qcRequired: op.qcRequired ?? false,
    outsourceVendorId: op.outsourceVendorId ?? null,
    outsourceVendorText: op.outsourceVendorText ?? null,
    outsourceCost: (op.outsourceCost ?? 0).toFixed(2),
    outsourceLeadDays: op.outsourceLeadDays ?? null,
    createdBy: user.id,
    updatedBy: user.id,
  }));
  await tx.insert(planOps).values(values);
}

async function getPlanInTx(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<PlanDetail> {
  const headers = await tx
    .select({
      plan: plans,
      itemCode: items.code,
      itemName: items.name,
    })
    .from(plans)
    .leftJoin(items, and(eq(items.id, plans.itemId), isNull(items.deletedAt)))
    .where(and(eq(plans.id, id), eq(plans.companyId, companyId)))
    .limit(1);
  const row = headers[0];
  if (!row) throw new NotFoundError(`Plan ${id} not found after write`);
  const opRows = await tx
    .select()
    .from(planOps)
    .where(and(eq(planOps.planId, id), isNull(planOps.deletedAt)))
    .orderBy(asc(planOps.opSeq));
  return {
    ...toPlan(row.plan),
    itemCode: row.itemCode ?? null,
    itemName: row.itemName ?? null,
    ops: opRows.map(toPlanOp),
  };
}

function toPlan(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    planDate: row.planDate,
    planStatus: row.planStatus,
    planType: row.planType,
    soLineId: row.soLineId,
    soCodeText: row.soCodeText,
    lineNo: row.lineNo,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemNameText: row.itemNameText,
    orderQty: row.orderQty,
    planQty: row.planQty,
    plannedStartDate: row.plannedStartDate,
    plannedEndDate: row.plannedEndDate,
    bomMasterId: row.bomMasterId,
    bomParentCode: row.bomParentCode,
    bomChildCode: row.bomChildCode,
    jcId: row.jcId,
    dpVendorId: row.dpVendorId,
    dpVendorCodeText: row.dpVendorCodeText,
    dpCost: row.dpCost,
    dpRemarks: row.dpRemarks,
    dpPrId: row.dpPrId,
    foVendorId: row.foVendorId,
    foVendorCodeText: row.foVendorCodeText,
    foProcess: row.foProcess,
    foRate: row.foRate,
    foMaterialSrc: row.foMaterialSrc,
    foDeliveryDate: row.foDeliveryDate,
    foCostCenter: row.foCostCenter,
    foRemarks: row.foRemarks,
    foPrId: row.foPrId,
    foMatPrId: row.foMatPrId,
    materialPrId: row.materialPrId,
    remarks: row.remarks,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}

function toPlanOp(row: typeof planOps.$inferSelect): PlanOp {
  return {
    id: row.id,
    companyId: row.companyId,
    planId: row.planId,
    opSeq: row.opSeq,
    machineId: row.machineId,
    machineCodeText: row.machineCodeText,
    operation: row.operation,
    opType: row.opType,
    cycleTimeMin: row.cycleTimeMin,
    program: row.program,
    toolDetails: row.toolDetails,
    qcRequired: row.qcRequired,
    outsourceVendorId: row.outsourceVendorId,
    outsourceVendorText: row.outsourceVendorText,
    outsourceCost: row.outsourceCost,
    outsourcePrId: row.outsourcePrId,
    outsourceLeadDays: row.outsourceLeadDays,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt
      ? row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : String(row.deletedAt)
      : null,
  };
}
