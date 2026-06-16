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
  JobCardEditModel,
  JobCardListItem,
  JobCardSourceLink,
  JobCardSourceOption,
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

// ─── Cascade source options (parity: CASCADE.allOpenOrders + orderBalance) ──

export async function listJobCardSourceOptions(user: AuthContext): Promise<JobCardSourceOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = (await tx.execute(sql`
      SELECT 'so' AS type, so.id AS "orderId", sol.id AS "lineId", so.code,
        sol.line_no AS "lineNo", sol.part_name AS "partName",
        COALESCE(i.code, sol.item_code_text) AS "itemCode",
        COALESCE(so.customer_name, cli.name) AS "customerName",
        sol.order_qty AS "orderQty", sol.due_date AS "dueDate",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE((SELECT SUM(jc.order_qty) FROM public.job_cards jc
          WHERE jc.source_so_line_id = sol.id AND jc.deleted_at IS NULL), 0)::int AS "inJc"
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = sol.item_id
      LEFT JOIN public.clients cli ON cli.id = so.client_id
      WHERE sol.company_id = ${companyId}::uuid AND sol.deleted_at IS NULL AND so.status != 'closed'
      UNION ALL
      SELECT 'jw' AS type, jw.id, jwl.id, jw.code, jwl.line_no, jwl.part_name,
        COALESCE(i2.code, jwl.item_code_text),
        COALESCE(jw.customer_name, cli2.name),
        jwl.order_qty, jwl.due_date, NULL,
        COALESCE((SELECT SUM(jc.order_qty) FROM public.job_cards jc
          WHERE jc.source_jw_line_id = jwl.id AND jc.deleted_at IS NULL), 0)::int
      FROM public.job_work_order_lines jwl
      JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.items i2 ON i2.id = jwl.item_id
      LEFT JOIN public.clients cli2 ON cli2.id = jw.client_id
      WHERE jwl.company_id = ${companyId}::uuid AND jwl.deleted_at IS NULL AND jw.status != 'closed'
      ORDER BY type, code, "lineNo"
    `)) as unknown as Array<Record<string, unknown>>;

    return result.map((r): JobCardSourceOption => {
      const orderQty = Number(r['orderQty'] ?? 0);
      const inJc = Number(r['inJc'] ?? 0);
      return {
        type: r['type'] as 'so' | 'jw',
        orderId: r['orderId'] as string,
        lineId: r['lineId'] as string,
        code: r['code'] as string,
        lineNo: Number(r['lineNo'] ?? 0),
        partName: (r['partName'] as string | null) ?? null,
        itemCode: (r['itemCode'] as string | null) ?? null,
        customerName: (r['customerName'] as string | null) ?? null,
        orderQty,
        dueDate: r['dueDate'] != null ? dateLike(r['dueDate']) : null,
        clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
        inJc,
        remaining: Math.max(0, orderQty - inJc),
      };
    });
  });
}

// ─── Edit model (repopulates the modal — full op detail + qc docs) ──────────

export async function getJobCardEditModel(id: string, user: AuthContext): Promise<JobCardEditModel> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headRows = (await tx.execute(sql`
      SELECT jc.id, jc.code, jc.jc_date AS "jcDate",
        jc.source_so_line_id AS "sourceSoLineId", jc.source_jw_line_id AS "sourceJwLineId",
        jc.order_qty AS "orderQty", jc.priority, jc.due_date AS "dueDate",
        jc.drawing_file_path AS "drawingFilePath", i.code AS "itemCode"
      FROM public.job_cards jc
      LEFT JOIN public.items i ON i.id = jc.item_id
      WHERE jc.id = ${id}::uuid AND jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    const h = headRows[0];
    if (!h) throw new NotFoundError(`Job card ${id} not found`);

    const opRows = (await tx.execute(sql`
      SELECT o.id, o.op_seq AS "opSeq",
        COALESCE(m.code, o.machine_code_text) AS "machineCode",
        o.operation, o.op_type AS "opType", o.cycle_time_min AS "cycleTimeMin",
        o.program, o.tool_no AS "toolNo", o.tool_details AS "toolDetails",
        o.qc_required AS "qcRequired",
        COALESCE(v.code, o.outsource_vendor_text) AS "outsourceVendorCode",
        o.outsource_cost AS "outsourceCost",
        (
          EXISTS (SELECT 1 FROM public.op_log ol WHERE ol.jc_op_id = o.id)
          OR EXISTS (SELECT 1 FROM public.running_ops ro WHERE ro.jc_op_id = o.id AND ro.status = 'running')
        ) AS "hasStarted"
      FROM public.jc_ops o
      LEFT JOIN public.machines m ON m.id = o.machine_id
      LEFT JOIN public.vendors v ON v.id = o.outsource_vendor_id
      WHERE o.job_card_id = ${id}::uuid AND o.deleted_at IS NULL
      ORDER BY o.op_seq
    `)) as unknown as Array<Record<string, unknown>>;

    const docRows = (await tx.execute(sql`
      SELECT id, doc_type AS "docType", file_name AS "fileName",
        storage_path AS "storagePath", file_size AS "fileSize"
      FROM public.file_registry
      WHERE job_card_id = ${id}::uuid AND category = 'qc-docs' AND deleted_at IS NULL
      ORDER BY created_at
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      id: h['id'] as string,
      code: h['code'] as string,
      jcDate: dateLike(h['jcDate']),
      sourceSoLineId: (h['sourceSoLineId'] as string | null) ?? null,
      sourceJwLineId: (h['sourceJwLineId'] as string | null) ?? null,
      itemCode: (h['itemCode'] as string | null) ?? '',
      orderQty: Number(h['orderQty'] ?? 0),
      priority: h['priority'] as JobCardEditModel['priority'],
      dueDate: h['dueDate'] != null ? dateLike(h['dueDate']) : null,
      drawingFilePath: (h['drawingFilePath'] as string | null) ?? null,
      ops: opRows.map((o) => ({
        id: o['id'] as string,
        opSeq: Number(o['opSeq'] ?? 0),
        machineCode: (o['machineCode'] as string | null) ?? null,
        operation: (o['operation'] as string | null) ?? '',
        opType: o['opType'] as JobCardEditModel['ops'][number]['opType'],
        cycleTimeMin: Number(o['cycleTimeMin'] ?? 0),
        program: (o['program'] as string | null) ?? null,
        toolNo: (o['toolNo'] as string | null) ?? null,
        toolDetails: (o['toolDetails'] as string | null) ?? null,
        qcRequired: Boolean(o['qcRequired']),
        outsourceVendorCode: (o['outsourceVendorCode'] as string | null) ?? null,
        outsourceCost: Number(o['outsourceCost'] ?? 0),
        hasStarted: Boolean(o['hasStarted']),
      })),
      qcDocs: docRows.map((d) => ({
        id: d['id'] as string,
        docType: (d['docType'] as string | null) ?? 'Other',
        fileName: (d['fileName'] as string | null) ?? '',
        storagePath: (d['storagePath'] as string | null) ?? '',
        fileSize: d['fileSize'] != null ? Number(d['fileSize']) : null,
      })),
    };
  });
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

  // Governance: direct Job Cards are disabled. SO/item Job Cards must originate
  // from a Plan (Planning → execute). Manual creation is permitted only for
  // Job Work (JW) orders, until JW is supported in Planning. Plan execution,
  // NC rework and BOM cascade insert JCs internally and bypass this entry point.
  if (!input.sourceJwLineId) {
    throw new ValidationError(
      'Direct Job Cards are disabled — create the Job Card from Planning (execute a Plan). Manual creation is allowed only for Job Work (JW) orders.',
    );
  }

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

/** ids of this JC's active ops that have started (any op_log row OR a running
 *  session) — legacy `_hasOpStarted`. Such ops can't be removed or retyped. */
async function startedOpIds(tx: DbTransaction, jobCardId: string): Promise<Set<string>> {
  const rows = (await tx.execute(sql`
    SELECT o.id::text AS id
    FROM public.jc_ops o
    WHERE o.job_card_id = ${jobCardId}::uuid
      AND o.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM public.op_log ol WHERE ol.jc_op_id = o.id)
        OR EXISTS (SELECT 1 FROM public.running_ops ro WHERE ro.jc_op_id = o.id AND ro.status = 'running')
      )
  `)) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export async function updateJobCard(
  id: string,
  input: JobCardWriteInput,
  user: AuthContext,
): Promise<JobCardListItem> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  await withUserContext(user, async (tx) => {
    const headRows = await tx
      .select({ code: jobCards.code })
      .from(jobCards)
      .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)))
      .limit(1);
    const head = headRows[0];
    if (!head) throw new NotFoundError(`Job card ${id} not found`);

    const item = await resolveItem(tx, input.itemCode, companyId);
    await assertLineBalance(tx, input, companyId, id);
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

    // Existing ops + which have started.
    const existing = await tx
      .select({ id: jcOps.id, opType: jcOps.opType })
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, id), isNull(jcOps.deletedAt)));
    const existingById = new Map(existing.map((o) => [o.id, o]));
    const started = await startedOpIds(tx, id);
    const payloadIds = new Set(input.ops.map((o) => o.id).filter((x): x is string => Boolean(x)));

    // Guard: a started op may not be removed or have its type changed (legacy
    // blocks the outsource toggle once an op has started; we extend it to
    // removal + any type change, since op_log is FK-bound to the op row).
    for (const ex of existing) {
      if (!started.has(ex.id)) continue;
      if (!payloadIds.has(ex.id)) {
        throw new ValidationError('Cannot remove an operation that already has logged work.');
      }
      const inPayload = input.ops.find((o) => o.id === ex.id);
      if (inPayload && inPayload.opType !== ex.opType) {
        throw new ValidationError('Cannot change the type of an operation that already has logged work.');
      }
    }

    const now = new Date();
    // 1. Soft-delete removed ops (all guaranteed un-started by the guard above).
    const removedIds = existing.filter((o) => !payloadIds.has(o.id)).map((o) => o.id);
    if (removedIds.length > 0) {
      await tx
        .update(jcOps)
        .set({ deletedAt: now, updatedBy: user.id })
        .where(inArray(jcOps.id, removedIds));
    }
    // 2. Park kept ops' opSeq out of the 1..N range to avoid unique collisions
    //    while we renumber (jc_ops unique on (job_card_id, op_seq)).
    const keptIds = input.ops.map((o) => o.id).filter((x): x is string => Boolean(x) && existingById.has(x!));
    if (keptIds.length > 0) {
      await tx
        .update(jcOps)
        .set({ opSeq: sql`${jcOps.opSeq} + 100000` })
        .where(inArray(jcOps.id, keptIds));
    }
    // 3. Upsert ops in payload order (final op_seq = index + 1).
    for (let i = 0; i < input.ops.length; i += 1) {
      const o = input.ops[i]!;
      const t = types[i]!;
      const vals = {
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
        updatedBy: user.id,
        updatedAt: now,
      };
      if (o.id && existingById.has(o.id)) {
        await tx
          .update(jcOps)
          .set({ ...vals, opSeq: i + 1 })
          .where(eq(jcOps.id, o.id));
      } else {
        await tx.insert(jcOps).values({
          companyId,
          jobCardId: id,
          opSeq: i + 1,
          ...vals,
          createdBy: user.id,
        });
      }
    }

    // 4. Header.
    await tx
      .update(jobCards)
      .set({
        jcDate: input.jcDate,
        itemId: item.id,
        orderQty: input.orderQty,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        drawingFilePath: input.drawingFilePath ?? null,
        sourceSoLineId: input.sourceSoLineId ?? null,
        sourceJwLineId: input.sourceJwLineId ?? null,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(jobCards.id, id));

    // 5. QC docs — register any new ones (dedup by storage path). Removal of an
    //    existing doc is done via the file_registry/SO-Documents delete UI.
    if (input.qcDocs.length > 0) {
      const have = await tx
        .select({ p: fileRegistry.storagePath })
        .from(fileRegistry)
        .where(and(eq(fileRegistry.jobCardId, id), isNull(fileRegistry.deletedAt)));
      const havePaths = new Set(have.map((r) => r.p));
      const fresh = input.qcDocs.filter((d) => !havePaths.has(d.storagePath));
      await registerQcDocs(tx, { ...input, qcDocs: fresh }, {
        companyId,
        jobCardId: id,
        jcCode: head.code,
        userId: user.id,
      });
    }

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Job Card',
        detail: `Updated ${head.code} — ${item.code} x ${input.orderQty}`,
        refId: head.code,
      },
      companyId,
      user,
    );
  });

  return getJobCard(id, user);
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
