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

import { and, count, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  fileRegistry,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  machines,
  ncRegister,
  plans,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAdminRole, requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { DEFAULT_FINAL_QC_OP, needsDefaultQcOp } from '../../lib/jc-default-qc';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import type {
  JcOpInput,
  JobCardCompletionEvent,
  JobCardEditModel,
  JobCardListItem,
  JobCardSourceLink,
  JobCardSourceOption,
  JobCardStatusExtras,
  JobCardStatusOpExtra,
  JobCardStatusQcDoc,
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
        jc.remarks AS "remarks", jc.closed_at AS "closedAt",
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
          SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                      THEN vos.qc_accepted_qty ELSE vos.completed_qty END
          FROM public.v_jc_op_status vos
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
        jc.remarks AS "remarks", jc.closed_at AS "closedAt",
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
          SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                      THEN vos.qc_accepted_qty ELSE vos.completed_qty END
          FROM public.v_jc_op_status vos
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
    remarks: (r['remarks'] as string | null) ?? null,
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

/** Maps one SO/JW line row (shape shared by listJobCardSourceOptions and
 *  resolveLinkedSource) into a JobCardSourceOption. */
function toSourceOption(r: Record<string, unknown>): JobCardSourceOption {
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
}

/** Resolves the JC's currently-linked SO/JW line into a full option EVEN when
 *  the parent order is closed (ISSUE-170 / legacy editJC L5947-50). Unlike
 *  listJobCardSourceOptions there is no `status != 'closed'` filter. Every
 *  joined table is soft-delete filtered. */
async function resolveLinkedSource(
  tx: DbTransaction,
  companyId: string,
  kind: 'so' | 'jw',
  lineId: string,
): Promise<JobCardSourceOption | null> {
  const rows = (
    kind === 'so'
      ? await tx.execute(sql`
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
          LEFT JOIN public.items i ON i.id = sol.item_id AND i.deleted_at IS NULL
          LEFT JOIN public.clients cli ON cli.id = so.client_id AND cli.deleted_at IS NULL
          WHERE sol.id = ${lineId}::uuid AND sol.company_id = ${companyId}::uuid AND sol.deleted_at IS NULL
          LIMIT 1
        `)
      : await tx.execute(sql`
          SELECT 'jw' AS type, jw.id AS "orderId", jwl.id AS "lineId", jw.code,
            jwl.line_no AS "lineNo", jwl.part_name AS "partName",
            COALESCE(i.code, jwl.item_code_text) AS "itemCode",
            COALESCE(jw.customer_name, cli.name) AS "customerName",
            jwl.order_qty AS "orderQty", jwl.due_date AS "dueDate",
            NULL AS "clientPoLineNo",
            COALESCE((SELECT SUM(jc.order_qty) FROM public.job_cards jc
              WHERE jc.source_jw_line_id = jwl.id AND jc.deleted_at IS NULL), 0)::int AS "inJc"
          FROM public.job_work_order_lines jwl
          JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
          LEFT JOIN public.items i ON i.id = jwl.item_id AND i.deleted_at IS NULL
          LEFT JOIN public.clients cli ON cli.id = jw.client_id AND cli.deleted_at IS NULL
          WHERE jwl.id = ${lineId}::uuid AND jwl.company_id = ${companyId}::uuid AND jwl.deleted_at IS NULL
          LIMIT 1
        `)
  ) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  return r ? toSourceOption(r) : null;
}

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

    return result.map(toSourceOption);
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
        jc.drawing_file_path AS "drawingFilePath", jc.remarks AS "remarks", i.code AS "itemCode"
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

    // ISSUE-170: resolve the linked source line as a full option even when the
    // parent order is closed (source-options lists only open lines).
    const soLineId = (h['sourceSoLineId'] as string | null) ?? null;
    const jwLineId = (h['sourceJwLineId'] as string | null) ?? null;
    const linkedSourceOption = soLineId
      ? await resolveLinkedSource(tx, companyId, 'so', soLineId)
      : jwLineId
        ? await resolveLinkedSource(tx, companyId, 'jw', jwLineId)
        : null;

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
      remarks: (h['remarks'] as string | null) ?? null,
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
      linkedSourceOption,
    };
  });
}

// ─── JC Status extras (parity: viewJCStatus L11020) ─────────────────────────
// QC documents (L11250-57), per-op machine name + tool details (L11049/L11230),
// and the merged completion feed (op_log ∪ NC ∪ NC-disposition ∪ OSP activity,
// L11091-11134) with a REAL server total (ISSUE-174). All over existing tables.

/** op_log rows fetched for the feed are capped so a JC with a very long
 *  production history doesn't ship an unbounded payload; the TOTAL is still an
 *  exact server COUNT (legacy fetched all; we cap the list but never the count). */
const COMPLETION_LOG_OPLOG_CAP = 300;

export async function getJobCardStatusExtras(
  id: string,
  user: AuthContext,
): Promise<JobCardStatusExtras> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jcRows = (await tx.execute(sql`
      SELECT jc.code FROM public.job_cards jc
      WHERE jc.id = ${id}::uuid AND jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ code: string }>;
    const jcRow = jcRows[0];
    if (!jcRow) throw new NotFoundError(`Job card ${id} not found`);
    const jcCode = jcRow.code;
    const jcLike = `%${jcCode}%`;

    // 1. QC documents (file_registry qc-docs — same source the JC modal writes).
    const docRows = (await tx.execute(sql`
      SELECT id, doc_type AS "docType", file_name AS "fileName",
        storage_path AS "storagePath", file_size AS "fileSize",
        to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS "uploadDate"
      FROM public.file_registry
      WHERE job_card_id = ${id}::uuid AND category = 'qc-docs'
        AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      ORDER BY created_at
    `)) as unknown as Array<Record<string, unknown>>;
    const qcDocs: JobCardStatusQcDoc[] = docRows.map((d) => ({
      id: d['id'] as string,
      docType: (d['docType'] as string | null) ?? 'Other',
      docName: null,
      fileName: (d['fileName'] as string | null) ?? '',
      storagePath: (d['storagePath'] as string | null) ?? '',
      fileSize: d['fileSize'] != null ? Number(d['fileSize']) : null,
      uploadDate: (d['uploadDate'] as string | null) ?? null,
    }));

    // 2. Per-op machine name + tool_details.
    const opRows = (await tx.execute(sql`
      SELECT o.id AS "jcOpId", o.tool_details AS "toolDetails", m.name AS "machineName"
      FROM public.jc_ops o
      LEFT JOIN public.machines m ON m.id = o.machine_id AND m.deleted_at IS NULL
      WHERE o.job_card_id = ${id}::uuid AND o.deleted_at IS NULL
      ORDER BY o.op_seq
    `)) as unknown as Array<Record<string, unknown>>;
    const opExtras: JobCardStatusOpExtra[] = opRows.map((o) => ({
      jcOpId: o['jcOpId'] as string,
      machineName: (o['machineName'] as string | null) ?? null,
      toolDetails: (o['toolDetails'] as string | null) ?? null,
    }));

    // 3. Completion feed sources (all JC-scoped, soft-delete filtered on
    //    jc_ops / nc_register; op_log has no deleted_at column).
    const opLogRows = (await tx.execute(sql`
      SELECT ol.id, ol.log_type AS "logType", ol.log_date AS "logDate",
        ol.start_time AS "startTime", ol.shift, ol.qty, ol.reject_qty AS "rejectQty",
        ol.remarks, ol.operator_name AS "operatorName",
        o.op_seq AS "opSeq", o.operation,
        COALESCE(m.code, o.machine_code_text) AS "machineCode"
      FROM public.op_log ol
      JOIN public.jc_ops o ON o.id = ol.jc_op_id AND o.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = o.machine_id AND m.deleted_at IS NULL
      WHERE o.job_card_id = ${id}::uuid AND ol.company_id = ${companyId}::uuid
      ORDER BY ol.log_date DESC, ol.start_time DESC NULLS LAST, ol.created_at DESC
      LIMIT ${COMPLETION_LOG_OPLOG_CAP}
    `)) as unknown as Array<Record<string, unknown>>;

    const ncRows = (await tx.execute(sql`
      SELECT nc.id, nc.code AS "ncNo", nc.nc_date AS "ncDate", nc.op_seq AS "opSeq",
        nc.reason_category AS "reasonCategory", nc.reason,
        nc.rejected_qty AS "rejectedQty", nc.disposition,
        nc.disposition_date AS "dispositionDate", nc.disposition_by_text AS "dispositionBy",
        nc.rework_op_seq AS "reworkOpSeq", nc.operator_text AS "operatorText",
        to_char(nc.time_logged AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "ncTime"
      FROM public.nc_register nc
      WHERE nc.job_card_id = ${id}::uuid AND nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
      ORDER BY nc.nc_date DESC
    `)) as unknown as Array<Record<string, unknown>>;

    // OSP activity: CREATE of an OSP Auto PR/PO referencing this JC. Both the
    // PurchaseRequest and PurchaseOrder activity details carry the JC code + "OSP"
    // (the PO linkage is a new-ERP enhancement beyond legacy — osp-cascade.ts:303),
    // so both PR and PO events link into this feed via `detail ILIKE '%<jc.code>%'`.
    const actRows = (await tx.execute(sql`
      SELECT a.id, a.entity, a.detail,
        to_char(a.ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS "actDate",
        to_char(a.ts AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "actTime"
      FROM public.activity_log a
      WHERE a.company_id = ${companyId}::uuid
        AND a.entity IN ('PurchaseRequest', 'PurchaseOrder')
        AND a.detail ILIKE ${jcLike}
        AND a.detail ILIKE '%OSP%'
      ORDER BY a.ts DESC
    `)) as unknown as Array<Record<string, unknown>>;

    // 4. Exact total (legacy `_allEvents.length`) — independent of the op_log cap.
    const countRows = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM public.op_log ol
           JOIN public.jc_ops o ON o.id = ol.jc_op_id AND o.deleted_at IS NULL
           WHERE o.job_card_id = ${id}::uuid AND ol.company_id = ${companyId}::uuid)::int AS oplog,
        (SELECT COUNT(*) FROM public.nc_register nc
           WHERE nc.job_card_id = ${id}::uuid AND nc.company_id = ${companyId}::uuid
             AND nc.deleted_at IS NULL)::int AS nc,
        (SELECT COUNT(*) FROM public.nc_register nc
           WHERE nc.job_card_id = ${id}::uuid AND nc.company_id = ${companyId}::uuid
             AND nc.deleted_at IS NULL AND nc.disposition IS NOT NULL)::int AS ncdisp,
        (SELECT COUNT(*) FROM public.activity_log a
           WHERE a.company_id = ${companyId}::uuid
             AND a.entity IN ('PurchaseRequest', 'PurchaseOrder')
             AND a.detail ILIKE ${jcLike} AND a.detail ILIKE '%OSP%')::int AS osp
    `)) as unknown as Array<{ oplog: number; nc: number; ncdisp: number; osp: number }>;
    const c = countRows[0] ?? { oplog: 0, nc: 0, ncdisp: 0, osp: 0 };
    const total = Number(c.oplog) + Number(c.nc) + Number(c.ncdisp) + Number(c.osp);

    // 5. Build the merged, structured feed (presentation stays on the client).
    const events: JobCardCompletionEvent[] = [];
    const nz = (v: unknown): number => Number(v ?? 0);

    for (const l of opLogRows) {
      const date = dateLike(l['logDate']);
      const time = l['startTime'] != null ? String(l['startTime']).slice(0, 5) : null;
      events.push({
        id: l['id'] as string,
        kind: 'op',
        date,
        time,
        sortKey: `${date}T${time ?? '99:99'}`,
        logType: l['logType'] as JobCardCompletionEvent['logType'],
        opSeq: l['opSeq'] != null ? Number(l['opSeq']) : null,
        operation: (l['operation'] as string | null) ?? null,
        machineCode: (l['machineCode'] as string | null) ?? null,
        operatorName: (l['operatorName'] as string | null) ?? null,
        shift: (l['shift'] as string | null) ?? null,
        qty: nz(l['qty']),
        rejectQty: nz(l['rejectQty']),
        remarks: (l['remarks'] as string | null) ?? null,
        ncNo: null,
        reasonCategory: null,
        reason: null,
        disposition: null,
        dispositionBy: null,
        reworkOpSeq: null,
        rejectedQty: null,
        operatorText: null,
        ospCategory: null,
        detail: null,
      });
    }

    for (const nc of ncRows) {
      const date = dateLike(nc['ncDate']);
      const time = (nc['ncTime'] as string | null) ?? null;
      const rejectedQty = nz(nc['rejectedQty']);
      const disposition = (nc['disposition'] as string | null) ?? null;
      events.push({
        id: nc['id'] as string,
        kind: 'nc',
        date,
        time,
        sortKey: `${date}T${time ?? '99:99'}`,
        logType: null,
        opSeq: nc['opSeq'] != null ? Number(nc['opSeq']) : null,
        operation: null,
        machineCode: null,
        operatorName: null,
        shift: null,
        qty: null,
        rejectQty: null,
        remarks: null,
        ncNo: (nc['ncNo'] as string | null) ?? null,
        reasonCategory: (nc['reasonCategory'] as string | null) ?? null,
        reason: (nc['reason'] as string | null) ?? null,
        disposition,
        dispositionBy: (nc['dispositionBy'] as string | null) ?? null,
        reworkOpSeq: nc['reworkOpSeq'] != null ? Number(nc['reworkOpSeq']) : null,
        rejectedQty,
        operatorText: (nc['operatorText'] as string | null) ?? null,
        ospCategory: null,
        detail: null,
      });
      if (disposition) {
        const dDate = dateLike(nc['dispositionDate'] ?? nc['ncDate']);
        events.push({
          id: `${nc['id'] as string}:disp`,
          kind: 'nc-disposition',
          date: dDate,
          time: null,
          sortKey: `${dDate}T99:98`,
          logType: null,
          opSeq: null,
          operation: null,
          machineCode: null,
          operatorName: null,
          shift: null,
          qty: null,
          rejectQty: null,
          remarks: null,
          ncNo: (nc['ncNo'] as string | null) ?? null,
          reasonCategory: null,
          reason: null,
          disposition,
          dispositionBy: (nc['dispositionBy'] as string | null) ?? null,
          reworkOpSeq: nc['reworkOpSeq'] != null ? Number(nc['reworkOpSeq']) : null,
          rejectedQty,
          operatorText: null,
          ospCategory: null,
          detail: null,
        });
      }
    }

    for (const a of actRows) {
      const date = (a['actDate'] as string | null) ?? '';
      const time = (a['actTime'] as string | null) ?? null;
      events.push({
        id: a['id'] as string,
        kind: 'osp',
        date,
        time,
        sortKey: `${date}T${time ?? '99:99'}`,
        logType: null,
        opSeq: null,
        operation: null,
        machineCode: null,
        operatorName: null,
        shift: null,
        qty: null,
        rejectQty: null,
        remarks: null,
        ncNo: null,
        reasonCategory: null,
        reason: null,
        disposition: null,
        dispositionBy: null,
        reworkOpSeq: null,
        rejectedQty: null,
        operatorText: null,
        ospCategory:
          a['entity'] === 'PurchaseRequest' ? 'Purchase Request' : 'Purchase Order',
        detail: (a['detail'] as string | null) ?? null,
      });
    }

    // Latest first (legacy L11134).
    events.sort((x, y) => y.sortKey.localeCompare(x.sortKey));

    return {
      qcDocs,
      opExtras,
      completionLog: { events, total, truncated: total > events.length },
    };
  });
}

// ─── Writes (parity: addJC L6020 / editJC L6076 / delJC L10955) ─────────────

const NUM = (v: number): string => String(v);

/** Next JC code in the IN-JC-YY-##### series (YY = 2-digit year), scoped to the
 *  company and reset per year — e.g. IN-JC-26-00001. Exported so the plans module
 *  uses the same series when a plan is executed into a Job Card. Only same-year
 *  IN-JC-YY-##### codes count toward the sequence, so legacy JC-PLN-… and the old
 *  yearless IN-JC-##### codes never corrupt the next number. */
export async function nextJcCode(tx: DbTransaction, companyId: string): Promise<string> {
  const yy = new Date().toISOString().slice(2, 4);
  const prefix = `IN-JC-${yy}-`;
  const rows = await tx
    .select({ code: jobCards.code })
    .from(jobCards)
    .where(and(eq(jobCards.companyId, companyId), like(jobCards.code, `${prefix}%`)));
  const re = new RegExp(`^IN-JC-${yy}-(\\d+)$`, 'i');
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(re);
    const n = m ? Number(m[1]) : 0;
    if (n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/** Preview the next IN-JC-YY-##### for the create form (visible before save).
 *  Reuses the year-scoped generator so the preview matches the assigned code. */
export async function getNextJcCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextJcCode(tx, companyId) }));
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

/** Rule B (ADR-069): a JC must end with a QC op so finished goods pass a QC
 *  gate and get credited to stock (qc_accept fires only on the last op). When
 *  the caller's last op isn't QC, append a default DIR QC stage. Idempotent on
 *  edit: once the JC ends with the DIR op it is re-submitted as the last op and
 *  no new one is added. */
function withTerminalQcOp(ops: JcOpInput[]): JcOpInput[] {
  if (!needsDefaultQcOp(ops)) return ops;
  return [
    ...ops,
    { operation: DEFAULT_FINAL_QC_OP, opType: 'qc', cycleTimeMin: 0, qcRequired: true, outsourceCost: 0 },
  ];
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

    const ops = withTerminalQcOp(input.ops);
    const types = validateOps(ops);
    const machineMap = await resolveCodeMap(
      tx,
      machines,
      ops.filter((_, i) => types[i] === 'process').map((o) => o.machineCode ?? ''),
      companyId,
      'Machine',
    );
    const vendorMap = await resolveCodeMap(
      tx,
      vendors,
      ops.filter((_, i) => types[i] === 'outsource').map((o) => o.outsourceVendorCode ?? ''),
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
        remarks: input.remarks ?? null,
        sourceSoLineId: input.sourceSoLineId ?? null,
        sourceJwLineId: input.sourceJwLineId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: jobCards.id });
    const jobCardId = jc!.id;

    if (ops.length > 0) {
      await tx
        .insert(jcOps)
        .values(buildOpRows(ops, types, { companyId, jobCardId, userId: user.id }, machineMap, vendorMap));
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
    const ops = withTerminalQcOp(input.ops);
    const types = validateOps(ops);
    const machineMap = await resolveCodeMap(
      tx,
      machines,
      ops.filter((_, i) => types[i] === 'process').map((o) => o.machineCode ?? ''),
      companyId,
      'Machine',
    );
    const vendorMap = await resolveCodeMap(
      tx,
      vendors,
      ops.filter((_, i) => types[i] === 'outsource').map((o) => o.outsourceVendorCode ?? ''),
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
    // `ops` may carry an appended DIR QC op (no id) — harmless for payloadIds
    // (id-filtered) but the upsert loop below must iterate `ops` so it lands.
    const payloadIds = new Set(ops.map((o) => o.id).filter((x): x is string => Boolean(x)));

    // Guard: a started op may not be removed or have its type changed (legacy
    // blocks the outsource toggle once an op has started; we extend it to
    // removal + any type change, since op_log is FK-bound to the op row).
    for (const ex of existing) {
      if (!started.has(ex.id)) continue;
      if (!payloadIds.has(ex.id)) {
        throw new ValidationError('Cannot remove an operation that already has logged work.');
      }
      const inPayload = ops.find((o) => o.id === ex.id);
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
    const keptIds = ops.map((o) => o.id).filter((x): x is string => Boolean(x) && existingById.has(x!));
    if (keptIds.length > 0) {
      await tx
        .update(jcOps)
        .set({ opSeq: sql`${jcOps.opSeq} + 100000` })
        .where(inArray(jcOps.id, keptIds));
    }
    // 3. Upsert ops in payload order (final op_seq = index + 1). Iterates `ops`
    //    (not input.ops) so an appended DIR QC op is inserted as the last op.
    for (let i = 0; i < ops.length; i += 1) {
      const o = ops[i]!;
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
        remarks: input.remarks ?? null,
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

// ─── Related documents (read-only traceability) ──────────────────────────
//
// GET /job-cards/:id/related. Mirrors getSalesOrderRelated: a single
// withUserContext transaction, an existence check, then company-scoped +
// soft-delete-filtered subqueries feeding the shared traceability shape.
//
// Anchor: job_cards (code, jc_date). No status column — coarse status is
// derived from closed_at ('closed' if set else 'open').
//
// Upstream (source):
//   - job_cards.item_id            → items                               (item)
//   - job_cards.source_so_line_id  → sales_order_lines → sales_orders    (sales-order)
//   - job_cards.source_jw_line_id  → job_work_order_lines → job_work_orders (job-work-order)
//   - job_cards.parent_nc_id       → nc_register                         (rework source NC)
//
// Downstream (generated):
//   - nc_register.job_card_id = :id                                      (non-conformances)
//   - plans.jc_id = :id                                                  (planning)
//   - DISTINCT purchase_requests via this JC's jc_ops.outsource_pr_id    (OSP PRs)
//   - DISTINCT purchase_orders via jc_ops.outsource_po_line_id
//       → purchase_order_lines → purchase_order_id                       (OSP POs)
export async function getJobCardRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the JC is visible before gathering related docs; grab the source
    // FKs for the upstream links.
    const headers = await tx
      .select({
        id: jobCards.id,
        code: jobCards.code,
        jcDate: jobCards.jcDate,
        itemId: jobCards.itemId,
        sourceSoLineId: jobCards.sourceSoLineId,
        sourceJwLineId: jobCards.sourceJwLineId,
        parentNcId: jobCards.parentNcId,
      })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Job card ${id} not found`);

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedDoc => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream: item master this JC produces ──────────────────────────────
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(
        and(eq(items.id, header.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1);
    const item = itemRows[0] ?? null;

    // ── Upstream: source Sales Order (via source_so_line_id → line → header) ─
    const soRows = header.sourceSoLineId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrders)
          .innerJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
          .where(
            and(
              eq(salesOrderLines.id, header.sourceSoLineId),
              eq(salesOrders.companyId, companyId),
              isNull(salesOrders.deletedAt),
              isNull(salesOrderLines.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const so = soRows[0] ?? null;

    // ── Upstream: source Job Work Order (via source_jw_line_id → line → hdr) ─
    const jwRows = header.sourceJwLineId
      ? await tx
          .select({
            id: jobWorkOrders.id,
            code: jobWorkOrders.code,
            status: jobWorkOrders.status,
            date: jobWorkOrders.jwDate,
          })
          .from(jobWorkOrders)
          .innerJoin(jobWorkOrderLines, eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrders.id))
          .where(
            and(
              eq(jobWorkOrderLines.id, header.sourceJwLineId),
              eq(jobWorkOrders.companyId, companyId),
              isNull(jobWorkOrders.deletedAt),
              isNull(jobWorkOrderLines.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const jw = jwRows[0] ?? null;

    // ── Upstream: parent NC (this JC is a rework/fresh JC spawned by an NC) ──
    const parentNcRows = header.parentNcId
      ? await tx
          .select({
            id: ncRegister.id,
            code: ncRegister.code,
            status: ncRegister.status,
            date: ncRegister.ncDate,
          })
          .from(ncRegister)
          .where(
            and(
              eq(ncRegister.id, header.parentNcId),
              eq(ncRegister.companyId, companyId),
              isNull(ncRegister.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const parentNc = parentNcRows[0] ?? null;

    // ── Downstream: NCs raised against this JC ──────────────────────────────
    const ncRows = await tx
      .select({
        id: ncRegister.id,
        code: ncRegister.code,
        status: ncRegister.status,
        date: ncRegister.ncDate,
      })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.jobCardId, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .orderBy(desc(ncRegister.ncDate));

    // ── Downstream: plans linked to this JC ─────────────────────────────────
    const planRows = await tx
      .select({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .where(and(eq(plans.jcId, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .orderBy(desc(plans.planDate));

    // ── Downstream: OSP purchase requests reachable from this JC's ops ───────
    const prRows = await tx
      .selectDistinct({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        status: purchaseRequests.status,
        date: purchaseRequests.prDate,
      })
      .from(purchaseRequests)
      .innerJoin(jcOps, eq(jcOps.outsourcePrId, purchaseRequests.id))
      .where(
        and(
          eq(jcOps.jobCardId, id),
          isNull(jcOps.deletedAt),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .orderBy(desc(purchaseRequests.prDate));

    // ── Downstream: OSP purchase orders via ops → PO line → PO header ───────
    const poRows = await tx
      .selectDistinct({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        status: purchaseOrders.status,
        date: purchaseOrders.poDate,
      })
      .from(purchaseOrders)
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .innerJoin(jcOps, eq(jcOps.outsourcePoLineId, purchaseOrderLines.id))
      .where(
        and(
          eq(jcOps.jobCardId, id),
          isNull(jcOps.deletedAt),
          isNull(purchaseOrderLines.deletedAt),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .orderBy(desc(purchaseOrders.poDate));

    // ── Upstream sections (what this JC was built FROM) ─────────────────────
    const itemSection = section(
      'item',
      'Item',
      '📦',
      'item',
      item ? [row(item.id, item.code, null, null, { label: item.name })] : [],
    );
    const soSection = section(
      'sales-order',
      'Sales Order',
      '📄',
      'sales-order',
      so ? [row(so.id, so.code, so.status, so.date)] : [],
    );
    const jwSection = section(
      'job-work-order',
      'Job Work Order',
      '🛠',
      'job-work-order',
      jw ? [row(jw.id, jw.code, jw.status, jw.date)] : [],
    );
    const parentNcSection = section(
      'parent-nc',
      'Rework Source NC',
      '⚠',
      'nc',
      parentNc ? [row(parentNc.id, parentNc.code, parentNc.status, parentNc.date)] : [],
    );

    // ── Downstream sections (generated from this JC) ────────────────────────
    const ncSection = section(
      'nc',
      'Non-Conformances',
      '⚠',
      'nc',
      ncRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const plansSection = section(
      'plans',
      'Planning',
      '🗂',
      'plan',
      planRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const ospPrSection = section(
      'osp-pr',
      'OSP Purchase Requests',
      '📝',
      'purchase-request',
      prRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );
    const ospPoSection = section(
      'osp-po',
      'OSP Purchase Orders',
      '🧾',
      'purchase-order',
      poRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );

    const upstream = [itemSection, soSection, jwSection, parentNcSection];
    const downstream = [ncSection, plansSection, ospPrSection, ospPoSection];
    return {
      self: { module: 'job-cards', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.jcDate),
          label: 'Job Card created',
          code: header.code,
          routeKind: 'job-card',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
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
