// Job Cards service (T-032). Read-only at this phase — JC writes still go
// through op-entry per Phase 3.
//
// One canonical query joins:
//   job_cards
//   ⨝ items (LEFT — drawing/code/name)
//   ⨝ v_jc_status (LEFT — computed_status + ops counts)
//   ⨝ sales_order_lines + sales_orders (LEFT — SO source link)
//   ⨝ job_work_order_lines + job_work_orders (LEFT — JW source link)
//   ⨝ clients (LEFT — fallback customer name)
//
// Filters live as conditional `sql\`\`` fragments. machineId / operatorId use
// EXISTS sub-selects on jc_ops / op_log so we don't blow up the row set.

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  fileRegistry,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  machines,
  salesOrderLines,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAdminRole, requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type {
  JcOpInput,
  JobCardListItem,
  JobCardSourceLink,
  JobCardWriteInput,
  ListJobCardsQuery,
  ListJobCardsResponse,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listJobCards(
  input: ListJobCardsQuery,
  user: AuthContext,
): Promise<ListJobCardsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          jc.code ILIKE ${term}
          OR i.code ILIKE ${term}
          OR i.name ILIKE ${term}
          OR so.code ILIKE ${term}
          OR jw.code ILIKE ${term}
          OR so.customer_name ILIKE ${term}
          OR jw.customer_name ILIKE ${term}
          OR cli_so.name ILIKE ${term}
          OR cli_jw.name ILIKE ${term}
        )`
      : sql``;
    const statusFrag = input.status
      ? sql`AND COALESCE(s.computed_status, 'no_ops') = ${input.status}`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND jc.jc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND jc.jc_date <= ${input.toDate}::date` : sql``;
    // Machine filter: JC has at least one op assigned to this machine.
    const machineFrag = input.machineId
      ? sql`AND EXISTS (
          SELECT 1 FROM public.jc_ops jo
          WHERE jo.job_card_id = jc.id
            AND jo.machine_id = ${input.machineId}::uuid
            AND jo.deleted_at IS NULL
        )`
      : sql``;
    // Operator filter: JC has at least one op_log entry by this operator
    // (joined via jc_ops).
    const operatorFrag = input.operatorId
      ? sql`AND EXISTS (
          SELECT 1 FROM public.op_log ol
          JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
          WHERE jo.job_card_id = jc.id
            AND ol.operator_id = ${input.operatorId}::uuid
        )`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        jc.id, jc.company_id AS "companyId", jc.code,
        jc.jc_date AS "jcDate", jc.item_id AS "itemId",
        jc.order_qty AS "orderQty", jc.priority,
        jc.due_date AS "dueDate", jc.drawing_file_path AS "drawingFilePath",
        jc.closed_at AS "closedAt",
        jc.created_at AS "createdAt", jc.created_by AS "createdBy",
        jc.updated_at AS "updatedAt", jc.updated_by AS "updatedBy",
        i.code AS "itemCode", i.name AS "itemName",
        COALESCE(s.computed_status, 'no_ops') AS "computedStatus",
        COALESCE(s.total_ops, 0)::int        AS "totalOps",
        COALESCE(s.done_ops, 0)::int         AS "doneOps",
        COALESCE(s.qc_pending_ops, 0)::int   AS "qcPendingOps",
        sol.id   AS "soLineId",   so.id  AS "soId",
        so.code  AS "soCode",     sol.line_no AS "soLineNo",
        sol.part_name AS "soPartName",
        jwl.id   AS "jwLineId",   jw.id  AS "jwId",
        jw.code  AS "jwCode",     jwl.line_no AS "jwLineNo",
        jwl.part_name AS "jwPartName",
        COALESCE(so.customer_name, jw.customer_name, cli_so.name, cli_jw.name) AS "customerName",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE((
          SELECT vos.completed_qty FROM public.v_jc_op_status vos
          WHERE vos.job_card_id = jc.id
          ORDER BY vos.op_seq DESC LIMIT 1
        ), 0)::int AS "lastOpCompletedQty",
        (
          SELECT COUNT(*) FROM public.running_ops ro
          JOIN public.jc_ops jor ON jor.id = ro.jc_op_id
          WHERE jor.job_card_id = jc.id AND ro.status = 'running'
        )::int AS "runningCount"
      FROM public.job_cards jc
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cli_so
        ON cli_so.id = so.client_id AND cli_so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw
        ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.clients cli_jw
        ON cli_jw.id = jw.client_id AND cli_jw.deleted_at IS NULL
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${fromFrag}
        ${toFrag}
        ${machineFrag}
        ${operatorFrag}
      ORDER BY jc.jc_date DESC, jc.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total count uses the same WHERE clauses minus pagination. Drizzle ORM
    // doesn't help here because of the v_jc_status join; reuse the raw query.
    const countResult = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM public.job_cards jc
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cli_so
        ON cli_so.id = so.client_id AND cli_so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw
        ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.clients cli_jw
        ON cli_jw.id = jw.client_id AND cli_jw.deleted_at IS NULL
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${fromFrag}
        ${toFrag}
        ${machineFrag}
        ${operatorFrag}
    `);
    const total = Number((countResult as unknown as Array<{ count: number }>)[0]?.count ?? 0);

    const items = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items, total, limit: input.limit, offset: input.offset };
  });
}

export async function getJobCard(id: string, user: AuthContext): Promise<JobCardListItem> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Cheap exists-check first so we surface 404 (not "no rows" silent empty)
    // before running the heavy join.
    const exists = await tx
      .select({ id: jobCards.id })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1);
    if (exists.length === 0) throw new NotFoundError(`Job card ${id} not found`);

    const result = await tx.execute(sql`
      SELECT
        jc.id, jc.company_id AS "companyId", jc.code,
        jc.jc_date AS "jcDate", jc.item_id AS "itemId",
        jc.order_qty AS "orderQty", jc.priority,
        jc.due_date AS "dueDate", jc.drawing_file_path AS "drawingFilePath",
        jc.closed_at AS "closedAt",
        jc.created_at AS "createdAt", jc.created_by AS "createdBy",
        jc.updated_at AS "updatedAt", jc.updated_by AS "updatedBy",
        i.code AS "itemCode", i.name AS "itemName",
        COALESCE(s.computed_status, 'no_ops') AS "computedStatus",
        COALESCE(s.total_ops, 0)::int        AS "totalOps",
        COALESCE(s.done_ops, 0)::int         AS "doneOps",
        COALESCE(s.qc_pending_ops, 0)::int   AS "qcPendingOps",
        sol.id   AS "soLineId",   so.id  AS "soId",
        so.code  AS "soCode",     sol.line_no AS "soLineNo",
        sol.part_name AS "soPartName",
        jwl.id   AS "jwLineId",   jw.id  AS "jwId",
        jw.code  AS "jwCode",     jwl.line_no AS "jwLineNo",
        jwl.part_name AS "jwPartName",
        COALESCE(so.customer_name, jw.customer_name, cli_so.name, cli_jw.name) AS "customerName",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE((
          SELECT vos.completed_qty FROM public.v_jc_op_status vos
          WHERE vos.job_card_id = jc.id
          ORDER BY vos.op_seq DESC LIMIT 1
        ), 0)::int AS "lastOpCompletedQty",
        (
          SELECT COUNT(*) FROM public.running_ops ro
          JOIN public.jc_ops jor ON jor.id = ro.jc_op_id
          WHERE jor.job_card_id = jc.id AND ro.status = 'running'
        )::int AS "runningCount"
      FROM public.job_cards jc
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cli_so
        ON cli_so.id = so.client_id AND cli_so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl
        ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw
        ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.clients cli_jw
        ON cli_jw.id = jw.client_id AND cli_jw.deleted_at IS NULL
      WHERE jc.id = ${id}::uuid
    `);
    const row = (result as unknown as Array<Record<string, unknown>>)[0];
    if (!row) throw new NotFoundError(`Job card ${id} not found`);
    return toListItem(row);
  });
}

// ─── Mappers ──────────────────────────────────────────────────────────────

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function buildSourceLink(r: Record<string, unknown>): JobCardSourceLink | null {
  if (r['soLineId']) {
    return {
      type: 'so',
      salesOrderId: r['soId'] as string,
      salesOrderLineId: r['soLineId'] as string,
      code: r['soCode'] as string,
      lineNo: Number(r['soLineNo']),
      partName: (r['soPartName'] as string | null) ?? null,
    };
  }
  if (r['jwLineId']) {
    return {
      type: 'jw',
      jobWorkOrderId: r['jwId'] as string,
      jobWorkOrderLineId: r['jwLineId'] as string,
      code: r['jwCode'] as string,
      lineNo: Number(r['jwLineNo']),
      partName: (r['jwPartName'] as string | null) ?? null,
    };
  }
  return null;
}

function toListItem(r: Record<string, unknown>): JobCardListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    jcDate: dateLike(r['jcDate']),
    itemId: r['itemId'] as string,
    itemCode: (r['itemCode'] as string | null) ?? '',
    itemName: (r['itemName'] as string | null) ?? '',
    orderQty: Number(r['orderQty']),
    priority: r['priority'] as JobCardListItem['priority'],
    dueDate: r['dueDate'] != null ? dateLike(r['dueDate']) : null,
    drawingFilePath: (r['drawingFilePath'] as string | null) ?? null,
    closedAt: r['closedAt'] != null ? tsLike(r['closedAt']) : null,
    computedStatus: r['computedStatus'] as JobCardListItem['computedStatus'],
    totalOps: Number(r['totalOps'] ?? 0),
    doneOps: Number(r['doneOps'] ?? 0),
    qcPendingOps: Number(r['qcPendingOps'] ?? 0),
    sourceLink: buildSourceLink(r),
    customerName: (r['customerName'] as string | null) ?? null,
    clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    lastOpCompletedQty: Number(r['lastOpCompletedQty'] ?? 0),
    runningCount: Number(r['runningCount'] ?? 0),
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
  };
}

// ─── Writes (parity: addJC L6020 / editJC L6076 / delJC L10955) ─────────────

const NUM = (v: number): string => String(v);

/** Next JC code in the legacy IN-JC-##### series, scoped to the company. */
async function nextJcCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx.select({ code: jobCards.code }).from(jobCards).where(eq(jobCards.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = Number((r.code || '').replace(/\D/g, '')) || 0;
    if (m > max) max = m;
  }
  return `IN-JC-${String(max + 1).padStart(5, '0')}`;
}

async function resolveItem(
  tx: DbTransaction,
  itemCode: string,
  companyId: string,
): Promise<{ id: string; code: string }> {
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.code, itemCode), isNull(items.deletedAt)))
    .limit(1);
  if (!rows[0]) throw new ValidationError(`Item "${itemCode}" not found in Item Master`);
  return rows[0];
}

async function resolveCodeMap(
  tx: DbTransaction,
  table: typeof machines | typeof vendors,
  codes: string[],
  companyId: string,
  label: string,
): Promise<Map<string, string>> {
  const uniq = [...new Set(codes.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await tx
    .select({ id: table.id, code: table.code })
    .from(table)
    .where(and(eq(table.companyId, companyId), inArray(table.code, uniq), isNull(table.deletedAt)));
  const map = new Map(rows.map((r) => [r.code, r.id]));
  for (const c of uniq) {
    if (!map.has(c)) throw new ValidationError(`${label} "${c}" in operations not found`);
  }
  return map;
}

type ResolvedOpType = 'process' | 'qc' | 'outsource';

/** Validates qty vs the linked SO/JW line balance (legacy CASCADE.orderBalance).
 *  remaining = line.order_qty − Σ(other active JCs' order_qty on that line). */
async function assertLineBalance(
  tx: DbTransaction,
  input: JobCardWriteInput,
  companyId: string,
  excludeJcId: string | null,
): Promise<void> {
  const check = async (
    lineTable: typeof salesOrderLines | typeof jobWorkOrderLines,
    fkCol: typeof jobCards.sourceSoLineId | typeof jobCards.sourceJwLineId,
    lineId: string,
  ): Promise<void> => {
    const line = (
      await tx
        .select({ oq: lineTable.orderQty })
        .from(lineTable)
        .where(and(eq(lineTable.id, lineId), eq(lineTable.companyId, companyId), isNull(lineTable.deletedAt)))
        .limit(1)
    )[0];
    if (!line) throw new ValidationError('Linked SO/JW line not found');
    const sumRows = await tx
      .select({ s: sql<number>`COALESCE(SUM(${jobCards.orderQty}), 0)::int` })
      .from(jobCards)
      .where(
        and(
          eq(fkCol, lineId),
          isNull(jobCards.deletedAt),
          excludeJcId ? sql`${jobCards.id} != ${excludeJcId}::uuid` : sql`TRUE`,
        ),
      );
    const inJC = Number(sumRows[0]?.s ?? 0);
    const remaining = Math.max(0, line.oq - inJC);
    if (input.orderQty > remaining) {
      throw new ValidationError(
        `Cannot exceed SO Line balance. Ordered: ${line.oq} | Already in JCs: ${inJC} | Remaining: ${remaining}`,
      );
    }
  };
  if (input.sourceSoLineId) await check(salesOrderLines, jobCards.sourceSoLineId, input.sourceSoLineId);
  else if (input.sourceJwLineId) await check(jobWorkOrderLines, jobCards.sourceJwLineId, input.sourceJwLineId);
}

/** Validate ops (legacy addJC op validations), returning the type per op. */
function validateOps(ops: JcOpInput[]): ResolvedOpType[] {
  return ops.map((o) => {
    const t = o.opType;
    if (t === 'process' && (!o.machineCode || !o.operation)) {
      throw new ValidationError('All in-house operations need machine and operation name.');
    }
    if (t === 'qc' && !o.operation) {
      throw new ValidationError('All QC operations need a process name.');
    }
    if (t === 'outsource' && !o.outsourceVendorCode) {
      throw new ValidationError('All outsource operations need a vendor selected.');
    }
    return t;
  });
}

/** Builds the jc_ops insert rows for a JC, resolving machine/vendor codes. */
function buildOpRows(
  ops: JcOpInput[],
  types: ResolvedOpType[],
  ctx: { companyId: string; jobCardId: string; userId: string },
  machineMap: Map<string, string>,
  vendorMap: Map<string, string>,
): (typeof jcOps.$inferInsert)[] {
  return ops.map((o, i) => {
    const t = types[i]!;
    return {
      companyId: ctx.companyId,
      jobCardId: ctx.jobCardId,
      opSeq: i + 1,
      machineId: t === 'process' ? (machineMap.get(o.machineCode ?? '') ?? null) : null,
      machineCodeText: t === 'process' ? (o.machineCode ?? null) : t === 'qc' ? 'QC' : null,
      operation: o.operation,
      opType: t,
      cycleTimeMin: NUM(o.cycleTimeMin || 0),
      program: o.program ?? null,
      toolNo: o.toolNo ?? null,
      toolDetails: o.toolDetails ?? null,
      qcRequired: t === 'qc' ? true : Boolean(o.qcRequired),
      outsourceVendorId: t === 'outsource' ? (vendorMap.get(o.outsourceVendorCode ?? '') ?? null) : null,
      outsourceVendorText: t === 'outsource' ? (o.outsourceVendorCode ?? null) : null,
      outsourceCost: NUM(t === 'outsource' ? (o.outsourceCost || 0) : 0),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    } satisfies typeof jcOps.$inferInsert;
  });
}

async function registerQcDocs(
  tx: DbTransaction,
  input: JobCardWriteInput,
  ctx: { companyId: string; jobCardId: string; jcCode: string; userId: string },
): Promise<void> {
  if (input.qcDocs.length === 0) return;
  await tx.insert(fileRegistry).values(
    input.qcDocs.map((d) => ({
      companyId: ctx.companyId,
      jobCardId: ctx.jobCardId,
      jcCodeText: ctx.jcCode,
      category: 'qc-docs',
      docType: d.docType,
      fileName: d.fileName,
      storagePath: d.storagePath,
      fileSize: d.fileSize ?? null,
      status: 'active',
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })),
  );
}

export async function createJobCard(input: JobCardWriteInput, user: AuthContext): Promise<JobCardListItem> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  const newId = await withUserContext(user, async (tx) => {
    const item = await resolveItem(tx, input.itemCode, companyId);
    await assertLineBalance(tx, input, companyId, null);

    const types = validateOps(input.ops);
    const machineMap = await resolveCodeMap(
      tx,
      machines,
      input.ops.filter((_, i) => types[i] === 'process').map((o) => o.machineCode ?? ''),
      companyId,
      'Machine',
    );
    const vendorMap = await resolveCodeMap(
      tx,
      vendors,
      input.ops.filter((_, i) => types[i] === 'outsource').map((o) => o.outsourceVendorCode ?? ''),
      companyId,
      'Vendor',
    );

    const code = await nextJcCode(tx, companyId);
    const [jc] = await tx
      .insert(jobCards)
      .values({
        companyId,
        code,
        jcDate: input.jcDate,
        itemId: item.id,
        orderQty: input.orderQty,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        drawingFilePath: input.drawingFilePath ?? null,
        sourceSoLineId: input.sourceSoLineId ?? null,
        sourceJwLineId: input.sourceJwLineId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: jobCards.id });
    const jobCardId = jc!.id;

    if (input.ops.length > 0) {
      await tx
        .insert(jcOps)
        .values(buildOpRows(input.ops, types, { companyId, jobCardId, userId: user.id }, machineMap, vendorMap));
    }
    await registerQcDocs(tx, input, { companyId, jobCardId, jcCode: code, userId: user.id });

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Job Card',
        detail: `Created ${code} — ${item.code} x ${input.orderQty}`,
        refId: code,
      },
      companyId,
      user,
    );
    return jobCardId;
  });

  return getJobCard(newId, user);
}

export async function deleteJobCard(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ code: jobCards.code })
      .from(jobCards)
      .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError(`Job card ${id} not found`);

    const now = new Date();
    await tx.update(jobCards).set({ deletedAt: now, updatedBy: user.id }).where(eq(jobCards.id, id));
    // Soft-delete the ops too (op_log rows are preserved — FK is to jc_ops.id
    // which still exists; we never hard-delete to keep production history).
    await tx
      .update(jcOps)
      .set({ deletedAt: now, updatedBy: user.id })
      .where(and(eq(jcOps.jobCardId, id), isNull(jcOps.deletedAt)));

    await emitActivityLog(
      tx,
      { action: 'DELETE', entity: 'Job Card', detail: `Deleted ${rows[0].code}`, refId: rows[0].code },
      companyId,
      user,
    );
    return { ok: true };
  });
}

// ─── Convenience: total count alone (currently only used for tests) ───────

export async function countJobCards(user: AuthContext): Promise<number> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ value: count() })
      .from(jobCards)
      .where(and(eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)));
    return rows[0]?.value ?? 0;
  });
}
