// Multi-Level Plan (ADR-225 phase 3) — reads: next code, list, detail,
// eligible SO lines.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { tsLike } from '../ml-bom/helpers';
import { lineFactsFromSql, refusalSql } from './guards';
import { raisesOf, readMlPlanOrders, readRaisedByNode } from './order-reads';
import type {
  ListMlPlansQuery,
  ListMlPlansResponse,
  MlPlan,
  MlPlanDetail,
  MlPlanEligibleLine,
  MlPlanEligibleLinesQuery,
  MlPlanListItem,
  MlPlanNode,
  MlPlanStatus,
} from './schema';
import { ML_PLAN_SF_COLUMNS } from './sf-columns';
import { milliToText, toMilli } from './snapshot-math';

export const ML_PLAN_NOT_FOUND = 'Multi-Level Plan not found. It may have been moved to Trash.';

// ─── Numbering (IN-MLP-#####) ────────────────────────────────────────────

/** Next IN-MLP-##### — highest number EVER used + 1 (deleted rows included,
 *  so a number in Trash is never handed out again), under the series lock.
 *  For the SAVE only — the series lock is held until the insert commits. */
export async function nextMlPlanCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'ml_plans');
  return peekNextMlPlanCode(tx, companyId);
}

/** The same number WITHOUT the lock — the create screen's read-only preview
 *  (ADR-224: a preview, the server assigns the real number on save). */
export async function peekNextMlPlanCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT code FROM public.ml_plans
    WHERE company_id = ${companyId}::uuid
      AND code ~ '^IN-MLP-\\d+$'
    ORDER BY (SUBSTRING(code FROM 8))::int DESC
    LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const m = rows[0]?.code.match(/^IN-MLP-(\d+)$/);
  const next = m ? parseInt(m[1]!, 10) + 1 : 1;
  return `IN-MLP-${String(next).padStart(5, '0')}`;
}

// ─── Header mapping ──────────────────────────────────────────────────────

/** Aliases: mp (ml_plans), so, sol, i (plan item), b (pinned ml_bom — NOT
 *  filtered on deleted_at, so a plan whose BOM went to Trash still names it). */
const HEADER_FROM = sql`
  FROM public.ml_plans mp
  JOIN public.sales_orders so ON so.id = mp.sales_order_id
  JOIN public.sales_order_lines sol ON sol.id = mp.so_line_id
  LEFT JOIN public.items i ON i.id = mp.item_id
  JOIN public.ml_boms b ON b.id = mp.ml_bom_id`;

/** "The BOM moved since the copy": for the pinned top BOM AND every copied
 *  sub-assembly node — that BOM is in Trash, its BOM Rev is not the copied
 *  one, or it is no longer the item's live Default. One correlated EXISTS in
 *  the same statement (no per-row query). */
const BOM_CHANGED_SQL = sql`(
    b.deleted_at IS NOT NULL OR b.revision <> mp.ml_bom_revision OR NOT b.is_default
    OR EXISTS (
      SELECT 1 FROM public.ml_plan_nodes cn
      JOIN public.ml_boms cb ON cb.id = cn.ml_bom_id
      WHERE cn.ml_plan_id = mp.id AND cn.deleted_at IS NULL AND cn.ml_bom_id IS NOT NULL
        AND (cb.deleted_at IS NOT NULL OR cb.revision <> cn.ml_bom_revision OR NOT cb.is_default)
    ))`;

const HEADER_COLS = sql`
  mp.id, mp.company_id AS "companyId", mp.code,
  mp.sales_order_id AS "salesOrderId", so.code AS "soCode", so.internal_so_no AS "soInternalNo",
  mp.so_line_id AS "soLineId", sol.line_no AS "lineNo", sol.client_po_line_no AS "clientPoLineNo",
  mp.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
  sol.revision AS "itemRevision", sol.order_qty AS "orderQty", mp.plan_qty AS "planQty",
  mp.ml_bom_id AS "mlBomId", b.code AS "mlBomCode", mp.ml_bom_revision AS "mlBomRevision",
  ${BOM_CHANGED_SQL} AS "bomChanged",
  mp.status, mp.remarks, mp.snapshot_at AS "snapshotAt",
  mp.created_at AS "createdAt", mp.created_by AS "createdBy",
  mp.updated_at AS "updatedAt", mp.updated_by AS "updatedBy"`;

function toMlPlan(r: Record<string, unknown>): MlPlan {
  return {
    id: String(r['id']),
    companyId: String(r['companyId']),
    code: String(r['code']),
    salesOrderId: String(r['salesOrderId']),
    soCode: String(r['soCode']),
    soInternalNo: (r['soInternalNo'] as string | null) ?? null,
    soLineId: String(r['soLineId']),
    lineNo: Number(r['lineNo']),
    clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    itemId: String(r['itemId']),
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    itemRevision: (r['itemRevision'] as string | null) ?? null,
    orderQty: Number(r['orderQty']),
    planQty: Number(r['planQty']),
    mlBomId: String(r['mlBomId']),
    mlBomCode: String(r['mlBomCode']),
    mlBomRevision: Number(r['mlBomRevision']),
    bomChanged: Boolean(r['bomChanged']),
    status: String(r['status']) as MlPlanStatus,
    remarks: (r['remarks'] as string | null) ?? null,
    snapshotAt: tsLike(r['snapshotAt']),
    createdAt: tsLike(r['createdAt']),
    createdBy: String(r['createdBy']),
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: String(r['updatedBy']),
  };
}

// ─── List ────────────────────────────────────────────────────────────────

export async function listMlPlansTx(
  tx: DbTransaction,
  companyId: string,
  input: ListMlPlansQuery,
): Promise<ListMlPlansResponse> {
  const term = input.search ? `%${likeEscape(input.search)}%` : null;
  const searchFrag = term
    ? sql`AND (mp.code ILIKE ${term} ESCAPE '\\' OR so.code ILIKE ${term} ESCAPE '\\'
        OR so.internal_so_no ILIKE ${term} ESCAPE '\\' OR i.code ILIKE ${term} ESCAPE '\\'
        OR i.name ILIKE ${term} ESCAPE '\\')`
    : sql``;
  const statusFrag = input.status ? sql`AND mp.status = ${input.status}` : sql``;
  const soFrag = input.salesOrderId
    ? sql`AND mp.sales_order_id = ${input.salesOrderId}::uuid`
    : sql``;
  // Sort & Filter (ADR-200) on the page AND the count (ADR-201).
  const sf = readSf(input.sf);
  const sfFrag = sfWhere(ML_PLAN_SF_COLUMNS, sf);
  const orderBy = sfOrderBy(ML_PLAN_SF_COLUMNS, sf, sql`mp.code DESC, mp.id DESC`);

  const fromWhere = sql`
    ${HEADER_FROM}
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS node_count, COALESCE(MAX(n.depth), 0)::int AS levels
      FROM public.ml_plan_nodes n
      WHERE n.ml_plan_id = mp.id AND n.deleted_at IS NULL
    ) na ON TRUE
    WHERE mp.company_id = ${companyId}::uuid
      AND mp.deleted_at IS NULL
      ${searchFrag}
      ${statusFrag}
      ${soFrag}
      ${sfFrag}`;

  const rows = (await tx.execute(sql`
    SELECT ${HEADER_COLS},
      COALESCE(na.node_count, 0)::int AS "nodeCount",
      COALESCE(na.levels, 0)::int AS "levels"
    ${fromWhere}
    ORDER BY ${orderBy}
    LIMIT ${input.limit} OFFSET ${input.offset}
  `)) as unknown as Array<Record<string, unknown>>;
  const totalRows = (await tx.execute(
    sql`SELECT COUNT(*)::int AS n ${fromWhere}`,
  )) as unknown as Array<{ n: number }>;

  const listItems: MlPlanListItem[] = rows.map((r) => ({
    ...toMlPlan(r),
    nodeCount: Number(r['nodeCount'] ?? 0),
    levels: Number(r['levels'] ?? 0),
  }));
  return {
    items: listItems,
    total: Number(totalRows[0]?.n ?? 0),
    limit: input.limit,
    offset: input.offset,
  };
}

// ─── Detail ──────────────────────────────────────────────────────────────

export async function loadMlPlanDetail(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<MlPlanDetail> {
  const headers = (await tx.execute(sql`
    SELECT ${HEADER_COLS}
    ${HEADER_FROM}
    WHERE mp.id = ${id}::uuid AND mp.company_id = ${companyId}::uuid AND mp.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const h = headers[0];
  if (!h) throw new NotFoundError(ML_PLAN_NOT_FOUND);

  const nodeRows = (await tx.execute(sql`
    SELECT n.id, n.parent_node_id AS "parentNodeId", n.depth, n.seq,
      n.item_id AS "itemId", ni.code AS "itemCode", ni.name AS "itemName", ni.uom::text AS uom,
      n.bom_type::text AS "bomType", n.is_sub_assembly AS "isSubAssembly",
      n.ml_bom_id AS "mlBomId", nb.code AS "mlBomCode", n.ml_bom_revision AS "mlBomRevision",
      n.qty_per_set::text AS "qtyPerSet",
      n.gross_need_qty::text AS "grossNeedQty", n.from_stock_qty::text AS "fromStockQty",
      n.on_po_pr_qty::text AS "onPoPrQty", n.net_need_qty::text AS "netNeedQty",
      n.raw_material_grade_text AS "rawMaterialGradeText",
      n.raw_material_size_text AS "rawMaterialSizeText"
    FROM public.ml_plan_nodes n
    LEFT JOIN public.items ni ON ni.id = n.item_id
    LEFT JOIN public.ml_boms nb ON nb.id = n.ml_bom_id
    WHERE n.ml_plan_id = ${id}::uuid AND n.company_id = ${companyId}::uuid
      AND n.deleted_at IS NULL
    ORDER BY n.seq
  `)) as unknown as Array<Record<string, unknown>>;

  // Phase 4 — Raised = live orders made from the row; To Raise = Net Need −
  // Raised, never below 0 (thousandths, no float drift).
  const raisedByNode = await readRaisedByNode(tx, companyId, id);
  const nodes = nodeRows.map((r): MlPlanNode => {
    const raised = toMilli(raisedByNode.get(String(r['id'])) ?? '0');
    const toRaise = toMilli(String(r['netNeedQty'])) - raised;
    return {
      id: String(r['id']),
      parentNodeId: (r['parentNodeId'] as string | null) ?? null,
      depth: Number(r['depth']),
      seq: Number(r['seq']),
      itemId: String(r['itemId']),
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      uom: (r['uom'] as string | null) ?? null,
      bomType: (r['bomType'] as MlPlanNode['bomType']) ?? null,
      raises: raisesOf({
        depth: Number(r['depth']),
        bomType: (r['bomType'] as string | null) ?? null,
      }),
      isSubAssembly: Boolean(r['isSubAssembly']),
      mlBomId: (r['mlBomId'] as string | null) ?? null,
      mlBomCode: (r['mlBomCode'] as string | null) ?? null,
      mlBomRevision: r['mlBomRevision'] == null ? null : Number(r['mlBomRevision']),
      qtyPerSet: (r['qtyPerSet'] as string | null) ?? null,
      grossNeedQty: String(r['grossNeedQty']),
      fromStockQty: String(r['fromStockQty']),
      onPoPrQty: String(r['onPoPrQty']),
      netNeedQty: String(r['netNeedQty']),
      raisedQty: milliToText(raised),
      toRaiseQty: milliToText(toRaise > 0n ? toRaise : 0n),
      rawMaterialGradeText: (r['rawMaterialGradeText'] as string | null) ?? null,
      rawMaterialSizeText: (r['rawMaterialSizeText'] as string | null) ?? null,
    };
  });
  const orders = await readMlPlanOrders(tx, companyId, id);
  return { ...toMlPlan(h), nodes, orders };
}

// ─── Eligible SO lines ───────────────────────────────────────────────────

/** SO lines a Multi-Level Plan can be made for — the rows whose refusal
 *  (guards.ts refusalSql, the same rule Create re-checks) is NULL. */
export async function listEligibleLinesTx(
  tx: DbTransaction,
  companyId: string,
  input: MlPlanEligibleLinesQuery,
): Promise<MlPlanEligibleLine[]> {
  const term = input.search ? `%${likeEscape(input.search)}%` : null;
  const searchFrag = term
    ? sql`AND (so.code ILIKE ${term} ESCAPE '\\' OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
        OR i.code ILIKE ${term} ESCAPE '\\' OR i.name ILIKE ${term} ESCAPE '\\')`
    : sql``;
  const soFrag = input.salesOrderId
    ? sql`AND sol.sales_order_id = ${input.salesOrderId}::uuid`
    : sql``;
  const rows = (await tx.execute(sql`
    SELECT sol.id AS "soLineId", so.id AS "salesOrderId", so.code AS "soCode",
      so.internal_so_no AS "soInternalNo", sol.line_no AS "lineNo",
      sol.client_po_line_no AS "clientPoLineNo", sol.item_id AS "itemId",
      i.code AS "itemCode", i.name AS "itemName", sol.revision AS "itemRevision",
      sol.order_qty AS "orderQty", sol.due_date::text AS "dueDate",
      b.id AS "mlBomId", b.code AS "mlBomCode"
    ${lineFactsFromSql(companyId)}
      AND ${refusalSql} IS NULL
      ${searchFrag}
      ${soFrag}
    ORDER BY so.code DESC, sol.line_no
    LIMIT ${input.limit}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    soLineId: String(r['soLineId']),
    salesOrderId: String(r['salesOrderId']),
    soCode: String(r['soCode']),
    soInternalNo: (r['soInternalNo'] as string | null) ?? null,
    lineNo: Number(r['lineNo']),
    clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    itemId: String(r['itemId']),
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    itemRevision: (r['itemRevision'] as string | null) ?? null,
    orderQty: Number(r['orderQty']),
    dueDate: (r['dueDate'] as string | null) ?? null,
    mlBomId: String(r['mlBomId']),
    mlBomCode: String(r['mlBomCode']),
  }));
}
