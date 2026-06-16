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

import { and, asc, count, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type {
  CreatePlanInput,
  ListPlansQuery,
  ListPlansResponse,
  Plan,
  PlanDetail,
  PlanOp,
  PlanOpInput,
  PlanRequiredDoc,
  PlanningDashboardResponse,
  PlanStatus,
  UnplannedOrdersResponse,
  UpdatePlanInput,
} from '@innovic/shared';
import {
  items,
  jcOps,
  jobCards,
  planOps,
  plans,
  purchaseRequests,
  routeCardOps,
  routeCards,
} from '../../db/schema';
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

/**
 * Next sequential plan code PLN-NNNN, scoped to the company. Only codes that
 * match the strict PLN-<digits> shape count toward the max, so any legacy
 * timestamp/random codes are ignored and the series stays clean.
 */
async function nextPlanCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: plans.code })
    .from(plans)
    .where(eq(plans.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = /^PLN-(\d+)$/.exec(r.code ?? '');
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `PLN-${String(max + 1).padStart(4, '0')}`;
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
    // Blank/omitted code → auto-number the next PLN-NNNN. A user-supplied code
    // is still honoured (and dup-checked).
    const code =
      input.code && input.code.trim().length > 0
        ? input.code.trim()
        : await nextPlanCode(tx, companyId);

    const dup = await tx
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.companyId, companyId), eq(plans.code, code), isNull(plans.deletedAt)))
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Plan code "${code}" already exists`);
    }

    const inserted = await tx
      .insert(plans)
      .values({
        companyId,
        code,
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
        requiredDocs: input.requiredDocs ?? [],
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
    if (input.requiredDocs !== undefined) updates['requiredDocs'] = input.requiredDocs;
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

// ─── Default route-card ops loader (PL-4) ─────────────────────────────────

/** Fetch the active route card's ops for an item, formatted as PlanOpInput[]
 *  ready to splice into a plan create form. Returns [] when no active route
 *  card exists. UI calls this from the "Load default ops" button. */
export async function getDefaultRouteOpsForItem(
  itemId: string,
  user: AuthContext,
): Promise<PlanOpInput[]> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const rcRows = await tx
      .select({ id: routeCards.id })
      .from(routeCards)
      .where(
        and(
          eq(routeCards.companyId, companyId),
          eq(routeCards.itemId, itemId),
          isNull(routeCards.deletedAt),
        ),
      )
      .limit(1);
    const rc = rcRows[0];
    if (!rc) return [];

    const ops = await tx
      .select()
      .from(routeCardOps)
      .where(and(eq(routeCardOps.routeCardId, rc.id), isNull(routeCardOps.deletedAt)))
      .orderBy(asc(routeCardOps.opSeq));

    return ops.map((op) => ({
      opSeq: op.opSeq,
      machineId: op.machineId,
      machineCodeText: op.machineCodeText,
      operation: op.operation,
      opType: op.opType,
      cycleTimeMin: Number(op.cycleTimeMin),
      program: op.program,
      toolDetails: op.toolDetails,
      qcRequired: op.qcRequired,
      outsourceVendorId: op.ospVendorId,
      outsourceVendorText: op.ospVendorCodeText,
      outsourceCost: 0,
      outsourceLeadDays: op.ospLeadDays,
    }));
  });
}

// ─── Execute plan (PL-4): planned → jc_created | pr_created ──────────────

export interface ExecutePlanResult {
  plan: PlanDetail;
  /** Code of the JC that was created (manufacture / assembly). */
  jcCode?: string;
  /** Code of the primary PR that was created (direct_purchase / full_outsource). */
  primaryPrCode?: string;
  /** Code of the material PR that was created (full_outsource only). */
  materialPrCode?: string;
}

/** Execute a planned plan. Type-specific:
 *   - manufacture / assembly  → create JC (+ copy plan_ops → jc_ops), set plan.jc_id, status=jc_created
 *   - direct_purchase         → create 1 PR, set plan.dp_pr_id, status=pr_created
 *   - full_outsource          → create 1 JW PR (+ optional material PR), set plan.fo_pr_id (+ fo_mat_pr_id), status=pr_created
 *  Wraps all writes in a single transaction so rollback unwinds JC/PR atomically. */
export async function executePlan(
  id: string,
  user: AuthContext,
): Promise<ExecutePlanResult> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1);
    const plan = existing[0];
    if (!plan) throw new NotFoundError(`Plan ${id} not found`);
    if (plan.planStatus !== 'planned') {
      throw new ValidationError(
        `Plan in status '${plan.planStatus}' cannot be executed (must be planned)`,
      );
    }

    let result: ExecutePlanResult;
    if (plan.planType === 'manufacture' || plan.planType === 'assembly') {
      result = await executeManufacture(tx, plan, user);
    } else if (plan.planType === 'direct_purchase') {
      result = await executeDirectPurchase(tx, plan, user);
    } else {
      result = await executeFullOutsource(tx, plan, user);
    }
    return result;
  });
}

async function executeManufacture(
  tx: DbTransaction,
  plan: typeof plans.$inferSelect,
  user: AuthContext,
): Promise<ExecutePlanResult> {
  const ops = await tx
    .select()
    .from(planOps)
    .where(and(eq(planOps.planId, plan.id), isNull(planOps.deletedAt)))
    .orderBy(asc(planOps.opSeq));
  if (ops.length === 0) {
    throw new ValidationError(
      `${plan.planType} plan cannot be executed with zero operations`,
    );
  }
  if (!plan.itemId) {
    throw new ValidationError(
      `${plan.planType} plan requires a resolved itemId to create a JC (item_code_text alone is not enough)`,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const jcCode = await nextPlanJcCode(tx, plan.companyId, plan.id);

  const jcRows = await tx
    .insert(jobCards)
    .values({
      companyId: plan.companyId,
      code: jcCode,
      jcDate: today,
      itemId: plan.itemId,
      orderQty: plan.planQty,
      priority: 'normal',
      sourceSoLineId: plan.soLineId ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const jc = jcRows[0]!;

  // Copy plan_ops → jc_ops verbatim.
  await tx.insert(jcOps).values(
    ops.map((op) => ({
      companyId: plan.companyId,
      jobCardId: jc.id,
      opSeq: op.opSeq,
      machineId: op.machineId,
      machineCodeText: op.machineCodeText,
      operation: op.operation,
      opType: op.opType,
      cycleTimeMin: op.cycleTimeMin,
      program: op.program,
      toolDetails: op.toolDetails,
      qcRequired: op.qcRequired,
      outsourceVendorId: op.outsourceVendorId,
      outsourceVendorText: op.outsourceVendorText,
      outsourceCost: op.outsourceCost,
      createdBy: user.id,
      updatedBy: user.id,
    })),
  );

  await tx
    .update(plans)
    .set({
      planStatus: 'jc_created',
      jcId: jc.id,
      updatedBy: user.id,
    })
    .where(eq(plans.id, plan.id));

  await emitActivityLog(
    tx,
    {
      action: 'PLAN_EXECUTED',
      entity: 'Plan',
      detail: `${plan.code} → JC ${jc.code} (${plan.planType}, ${ops.length} ops)`,
      refId: plan.code,
    },
    plan.companyId,
    user,
  );

  return {
    plan: await getPlanInTx(tx, plan.id, plan.companyId),
    jcCode: jc.code,
  };
}

async function executeDirectPurchase(
  tx: DbTransaction,
  plan: typeof plans.$inferSelect,
  user: AuthContext,
): Promise<ExecutePlanResult> {
  if (!plan.dpVendorId && !plan.dpVendorCodeText) {
    throw new ValidationError('direct_purchase plan requires a vendor before execute');
  }
  const today = new Date().toISOString().slice(0, 10);
  const prCode = await nextPlanPrCode(tx, plan.companyId, plan.id, 'DP');

  const prRows = await tx
    .insert(purchaseRequests)
    .values({
      companyId: plan.companyId,
      code: prCode,
      prDate: today,
      status: 'open',
      vendorId: plan.dpVendorId ?? null,
      vendorCodeText: plan.dpVendorCodeText ?? null,
      itemId: plan.itemId ?? null,
      itemCodeText: plan.itemCodeText ?? null,
      itemName: plan.itemNameText ?? null,
      qty: plan.planQty,
      estCost: plan.dpCost ?? '0',
      sourceSoLineId: plan.soLineId ?? null,
      remarks: `Auto from plan ${plan.code} (direct_purchase)`,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const pr = prRows[0]!;

  await tx
    .update(plans)
    .set({
      planStatus: 'pr_created',
      dpPrId: pr.id,
      updatedBy: user.id,
    })
    .where(eq(plans.id, plan.id));

  await emitActivityLog(
    tx,
    {
      action: 'PLAN_EXECUTED',
      entity: 'Plan',
      detail: `${plan.code} → PR ${pr.code} (direct_purchase)`,
      refId: plan.code,
    },
    plan.companyId,
    user,
  );

  return {
    plan: await getPlanInTx(tx, plan.id, plan.companyId),
    primaryPrCode: pr.code,
  };
}

async function executeFullOutsource(
  tx: DbTransaction,
  plan: typeof plans.$inferSelect,
  user: AuthContext,
): Promise<ExecutePlanResult> {
  if (!plan.foVendorId && !plan.foVendorCodeText) {
    throw new ValidationError('full_outsource plan requires a vendor before execute');
  }
  if (!plan.foProcess) {
    throw new ValidationError('full_outsource plan requires a process description before execute');
  }
  const today = new Date().toISOString().slice(0, 10);

  // 1. Primary JW PR.
  const jwCode = await nextPlanPrCode(tx, plan.companyId, plan.id, 'FO');
  const jwRows = await tx
    .insert(purchaseRequests)
    .values({
      companyId: plan.companyId,
      code: jwCode,
      prDate: today,
      status: 'open',
      vendorId: plan.foVendorId ?? null,
      vendorCodeText: plan.foVendorCodeText ?? null,
      itemId: plan.itemId ?? null,
      itemCodeText: plan.itemCodeText ?? null,
      itemName: plan.itemNameText ?? null,
      qty: plan.planQty,
      estCost: plan.foRate ?? '0',
      requiredDate: plan.foDeliveryDate ?? null,
      sourceSoLineId: plan.soLineId ?? null,
      operation: 'OUTSOURCE',
      remarks: `Auto from plan ${plan.code} (full_outsource: ${plan.foProcess})`,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const jwPr = jwRows[0]!;

  // 2. Optional material PR when foMaterialSrc is set + isn't 'self'/'inhouse'.
  let materialPr: { id: string; code: string } | null = null;
  const matSrc = plan.foMaterialSrc?.trim().toLowerCase();
  if (matSrc && matSrc !== 'self' && matSrc !== 'inhouse' && matSrc !== 'in-house') {
    const matCode = await nextPlanPrCode(tx, plan.companyId, plan.id, 'FOMAT');
    const matRows = await tx
      .insert(purchaseRequests)
      .values({
        companyId: plan.companyId,
        code: matCode,
        prDate: today,
        status: 'open',
        vendorCodeText: plan.foMaterialSrc!,
        itemId: plan.itemId ?? null,
        itemCodeText: plan.itemCodeText ?? null,
        itemName: plan.itemNameText ?? null,
        qty: plan.planQty,
        sourceSoLineId: plan.soLineId ?? null,
        remarks: `Auto from plan ${plan.code} (full_outsource material)`,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    materialPr = { id: matRows[0]!.id, code: matRows[0]!.code };
  }

  await tx
    .update(plans)
    .set({
      planStatus: 'pr_created',
      foPrId: jwPr.id,
      foMatPrId: materialPr?.id ?? null,
      updatedBy: user.id,
    })
    .where(eq(plans.id, plan.id));

  await emitActivityLog(
    tx,
    {
      action: 'PLAN_EXECUTED',
      entity: 'Plan',
      detail: materialPr
        ? `${plan.code} → PR ${jwPr.code} + material PR ${materialPr.code} (full_outsource)`
        : `${plan.code} → PR ${jwPr.code} (full_outsource)`,
      refId: plan.code,
    },
    plan.companyId,
    user,
  );

  const out: ExecutePlanResult = {
    plan: await getPlanInTx(tx, plan.id, plan.companyId),
    primaryPrCode: jwPr.code,
  };
  if (materialPr) out.materialPrCode = materialPr.code;
  return out;
}

async function nextPlanJcCode(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<string> {
  const rows = await tx
    .select({ value: count() })
    .from(jobCards)
    .where(and(eq(jobCards.companyId, companyId), like(jobCards.code, `JC-PLN-${planId.slice(0, 8)}-%`)));
  const seq = (rows[0]?.value ?? 0) + 1;
  return `JC-PLN-${planId.slice(0, 8)}-${String(seq).padStart(2, '0')}`;
}

async function nextPlanPrCode(
  tx: DbTransaction,
  companyId: string,
  planId: string,
  kind: 'DP' | 'FO' | 'FOMAT',
): Promise<string> {
  const slug = planId.slice(0, 8);
  const prefix = `PR-${kind}-${slug}-`;
  const rows = await tx
    .select({ value: count() })
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.companyId, companyId), like(purchaseRequests.code, `${prefix}%`)));
  const seq = (rows[0]?.value ?? 0) + 1;
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

// ─── Planning dashboard ───────────────────────────────────────────────────

export async function getPlanningDashboard(
  user: AuthContext,
): Promise<PlanningDashboardResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const [statusCounts, recentRows, needsPlanningRows] = await Promise.all([
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
      // needsPlanning = SO lines on open SOs with NO non-cancelled plan covering them.
      // Counts each unplanned SO line once. Same shape as the legacy renderPlanDashboard
      // "Needs Planning" tile: open SO lines that haven't been planned yet.
      tx.execute(sql`
        SELECT COUNT(*)::int AS c
        FROM public.sales_order_lines sol
        JOIN public.sales_orders so ON so.id = sol.sales_order_id
        WHERE so.company_id = ${companyId}::uuid
          AND so.status = 'open'
          AND so.deleted_at IS NULL
          AND sol.deleted_at IS NULL
          AND sol.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM public.plans p
            WHERE p.so_line_id = sol.id
              AND p.deleted_at IS NULL
              AND p.plan_status <> 'cancelled'
          )
      `),
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

    const needsPlanning =
      Number((needsPlanningRows as unknown as Array<{ c: number }>)[0]?.c ?? 0);

    return {
      generatedAt: new Date().toISOString(),
      kpi: {
        needsPlanning,
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

// ─── Needs Planning (PL-3b) ──────────────────────────────────────────────
// Lists open SO lines that don't yet have a non-cancelled plan covering
// their full quantity. Mirrors legacy renderPlanDashboard L10024–10041 when
// flt='unplanned'. SO-side only; JW lines join when JW planning lands.
export async function getUnplannedOrders(
  user: AuthContext,
): Promise<UnplannedOrdersResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const rows = await tx.execute(sql`
      WITH planned_qty AS (
        SELECT so_line_id, COALESCE(SUM(plan_qty), 0)::int AS qty
        FROM public.plans
        WHERE company_id = ${companyId}::uuid
          AND deleted_at IS NULL
          AND plan_status <> 'cancelled'
          AND so_line_id IS NOT NULL
        GROUP BY so_line_id
      )
      SELECT
        sol.id            AS so_line_id,
        so.id             AS so_id,
        so.code           AS so_code,
        sol.line_no       AS line_no,
        sol.item_code_text AS item_code,
        sol.part_name     AS part_name,
        so.customer_name  AS customer_name,
        sol.due_date::text AS due_date,
        sol.order_qty     AS order_qty,
        COALESCE(pq.qty, 0)::int AS planned_qty,
        GREATEST(sol.order_qty - COALESCE(pq.qty, 0), 0)::int AS remaining_qty
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN planned_qty pq ON pq.so_line_id = sol.id
      WHERE so.company_id = ${companyId}::uuid
        AND so.status = 'open'
        AND so.deleted_at IS NULL
        AND sol.deleted_at IS NULL
        AND sol.status = 'open'
        AND COALESCE(pq.qty, 0) < sol.order_qty
      ORDER BY sol.due_date ASC NULLS LAST, so.code ASC, sol.line_no ASC
    `);

    type Row = {
      so_line_id: string;
      so_id: string;
      so_code: string;
      line_no: number;
      item_code: string | null;
      part_name: string | null;
      customer_name: string | null;
      due_date: string | null;
      order_qty: number;
      planned_qty: number;
      remaining_qty: number;
    };
    const typed = rows as unknown as Row[];

    return {
      generatedAt: new Date().toISOString(),
      rows: typed.map((r) => ({
        soLineId: r.so_line_id,
        soId: r.so_id,
        soCode: r.so_code,
        lineNo: Number(r.line_no),
        itemCode: r.item_code,
        partName: r.part_name,
        customerName: r.customer_name,
        dueDate: r.due_date,
        orderQty: Number(r.order_qty),
        plannedQty: Number(r.planned_qty),
        remainingQty: Number(r.remaining_qty),
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
    requiredDocs: (Array.isArray(row.requiredDocs) ? row.requiredDocs : []) as PlanRequiredDoc[],
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
