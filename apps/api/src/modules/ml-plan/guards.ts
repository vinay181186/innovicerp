// Multi-Level Plan (ADR-225 phase 3) — who may be planned, and the guards
// other modules call so they never pull an SO line out from under a live plan.
//
// ONE eligibility rule (contract header, ADR-225 decisions 3 and 6), written
// once as SQL (`refusalSql`) and read by BOTH the Eligible Lines list (rows
// whose refusal is NULL) and Create (the refusal of the one line, re-read
// under the SO line's row lock and turned into a sentence) — so the list and
// the save cannot disagree.
//
// The SO / plan guards (assertNoLiveMlPlan…) are called by the sales-orders
// and plans services. Every caller has already locked the SO line(s) FOR
// UPDATE, or the helper takes that lock itself, so a plan created in parallel
// queues behind the check instead of slipping past it (CLAUDE.md §20.3).

import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { readLiveOrderCodes } from './order-reads';

/** SO types a Multi-Level Plan is for (decision 3). */
export const ML_PLAN_SO_TYPES = ['component_manufacturing', 'with_material'] as const;
/** SO / line statuses that can no longer be planned. */
const DONE_STATUSES = ['cancelled', 'closed', 'dispatched'] as const;
/** What a refusal calls an SO type (shared has no label map for so_type). */
const SO_TYPE_WORDS: Record<string, string> = {
  component_manufacturing: 'Component Manufacturing',
  equipment: 'Equipment',
  with_material: 'With Material',
};

export type LineRefusal =
  | 'so_type'
  | 'so_status'
  | 'line_status'
  | 'no_item'
  | 'item_type'
  | 'no_default_bom'
  | 'line_bom_master'
  | 'already_planned'
  | 'line_has_plans';

const inList = (vals: readonly string[]): SQL =>
  sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * FROM + the refusal CASE over `sol` (sales_order_lines), `so`, `i` (the
 * line's item), `b` (its live Default ml_bom), `lp` (a live ml_plan on the
 * line, other than `excludeMlPlanId`) and `bp` (ANY live plan on the line —
 * a line uses a Multi-Level Plan OR plans, never both). NULL = eligible.
 */
export function lineFactsFromSql(companyId: string, excludeMlPlanId: string | null = null): SQL {
  const notSelf = excludeMlPlanId ? sql`AND mp.id <> ${excludeMlPlanId}::uuid` : sql``;
  // Phase 4 — the excluded Multi-Level Plan's OWN plans (raised from its
  // rows; the top row's plan sits on this very line) do not count either.
  const notOwnPlans = excludeMlPlanId
    ? sql`AND (p.ml_plan_node_id IS NULL OR p.ml_plan_node_id NOT IN (
          SELECT xn.id FROM public.ml_plan_nodes xn
          WHERE xn.ml_plan_id = ${excludeMlPlanId}::uuid))`
    : sql``;
  return sql`
    FROM public.sales_order_lines sol
    JOIN public.sales_orders so
      ON so.id = sol.sales_order_id AND so.company_id = ${companyId}::uuid
     AND so.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = sol.item_id AND i.deleted_at IS NULL
    LEFT JOIN public.ml_boms b
      ON b.item_id = sol.item_id AND b.company_id = ${companyId}::uuid
     AND b.is_default AND b.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT mp.code FROM public.ml_plans mp
      WHERE mp.so_line_id = sol.id AND mp.company_id = ${companyId}::uuid
        AND mp.status <> 'cancelled' AND mp.deleted_at IS NULL
        ${notSelf}
      ORDER BY mp.code LIMIT 1
    ) lp ON TRUE
    LEFT JOIN LATERAL (
      SELECT p.code FROM public.plans p
      WHERE p.so_line_id = sol.id AND p.company_id = ${companyId}::uuid
        AND p.deleted_at IS NULL AND p.plan_status <> 'cancelled'
        ${notOwnPlans}
      ORDER BY p.code LIMIT 1
    ) bp ON TRUE
    WHERE sol.company_id = ${companyId}::uuid AND sol.deleted_at IS NULL`;
}

export const refusalSql = sql`(CASE
    WHEN so.type::text NOT IN (${inList(ML_PLAN_SO_TYPES)}) THEN 'so_type'
    WHEN so.status::text IN (${inList(DONE_STATUSES)}) THEN 'so_status'
    WHEN sol.status::text IN (${inList(DONE_STATUSES)}) OR sol.short_closed_at IS NOT NULL
      THEN 'line_status'
    WHEN i.id IS NULL THEN 'no_item'
    WHEN i.item_type::text <> 'assembly' THEN 'item_type'
    WHEN b.id IS NULL THEN 'no_default_bom'
    WHEN sol.source_bom_master_id IS NOT NULL THEN 'line_bom_master'
    WHEN lp.code IS NOT NULL THEN 'already_planned'
    WHEN bp.code IS NOT NULL THEN 'line_has_plans'
    ELSE NULL END)`;

export interface LineFacts {
  soLineId: string;
  salesOrderId: string;
  soCode: string;
  soInternalNo: string | null;
  soType: string;
  soStatus: string;
  lineNo: number;
  lineStatus: string;
  shortClosed: boolean;
  orderQty: number;
  itemId: string | null;
  itemCode: string | null;
  itemType: string | null;
  mlBomId: string | null;
  mlBomCode: string | null;
  mlBomRevision: number | null;
  livePlanCode: string | null;
  linePlanCode: string | null;
  refusal: LineRefusal | null;
}

/** Lock ONE SO line FOR UPDATE, in its own statement (as plans'
 *  assertPlanQtyWithinRemaining does: under READ COMMITTED a statement that
 *  waited on a row lock re-checks only that row, so the facts are read by the
 *  NEXT statement, which sees whatever the lock holder committed). */
export async function lockSoLine(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT sol.id FROM public.sales_order_lines sol
    WHERE sol.id = ${soLineId}::uuid AND sol.company_id = ${companyId}::uuid
      AND sol.deleted_at IS NULL
    FOR UPDATE OF sol
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Everything the eligibility rule looks at, for one SO line. */
export async function readLineFacts(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  /** Update / Refresh: the plan being saved does not count against itself. */
  excludeMlPlanId: string | null = null,
): Promise<LineFacts | null> {
  const rows = (await tx.execute(sql`
    SELECT sol.id AS so_line_id, so.id AS sales_order_id, so.code AS so_code,
           so.internal_so_no, so.type::text AS so_type, so.status::text AS so_status,
           sol.line_no, sol.status::text AS line_status,
           sol.short_closed_at IS NOT NULL AS short_closed, sol.order_qty,
           sol.item_id, COALESCE(i.code, sol.item_code_text) AS item_code,
           i.item_type::text AS item_type,
           b.id AS ml_bom_id, b.code AS ml_bom_code, b.revision AS ml_bom_revision,
           lp.code AS live_plan_code, bp.code AS line_plan_code,
           ${refusalSql} AS refusal
    ${lineFactsFromSql(companyId, excludeMlPlanId)}
      AND sol.id = ${soLineId}::uuid
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    soLineId: String(r['so_line_id']),
    salesOrderId: String(r['sales_order_id']),
    soCode: String(r['so_code']),
    soInternalNo: (r['internal_so_no'] as string | null) ?? null,
    soType: String(r['so_type']),
    soStatus: String(r['so_status']),
    lineNo: Number(r['line_no']),
    lineStatus: String(r['line_status']),
    shortClosed: Boolean(r['short_closed']),
    orderQty: Number(r['order_qty']),
    itemId: (r['item_id'] as string | null) ?? null,
    itemCode: (r['item_code'] as string | null) ?? null,
    itemType: (r['item_type'] as string | null) ?? null,
    mlBomId: (r['ml_bom_id'] as string | null) ?? null,
    mlBomCode: (r['ml_bom_code'] as string | null) ?? null,
    mlBomRevision: r['ml_bom_revision'] == null ? null : Number(r['ml_bom_revision']),
    livePlanCode: (r['live_plan_code'] as string | null) ?? null,
    linePlanCode: (r['line_plan_code'] as string | null) ?? null,
    refusal: (r['refusal'] as LineRefusal | null) ?? null,
  };
}

/** A RELEASED plan's re-check (its rows are frozen): only the SO and the
 *  line still being open — not cancelled / closed / dispatched / closed
 *  short. Null = still open. */
export function closedLineRefusal(f: LineFacts): LineRefusal | null {
  const done: readonly string[] = DONE_STATUSES;
  if (done.includes(f.soStatus)) return 'so_status';
  if (done.includes(f.lineStatus) || f.shortClosed) return 'line_status';
  return null;
}

/** "IN-SO-00012 · SO-2401" — what messages call the SO (ADR-207). */
export const soLabel = (f: { soCode: string; soInternalNo: string | null }): string =>
  f.soInternalNo ? `${f.soCode} · ${f.soInternalNo}` : f.soCode;

/** The plain sentence for a refusal. */
export function refusalMessage(f: LineFacts): string {
  const so = soLabel(f);
  const line = `${so} Line ${f.lineNo}`;
  switch (f.refusal) {
    case 'so_type': {
      const t = SO_TYPE_WORDS[f.soType] ?? f.soType;
      return `${so} is a ${t} order — a Multi-Level Plan is only for Component Manufacturing or With Material orders.`;
    }
    case 'so_status':
      return `${so} is ${f.soStatus} — it cannot be planned.`;
    case 'line_status':
      return `${line} is ${f.shortClosed ? 'closed short' : f.lineStatus} — it cannot be planned.`;
    case 'no_item':
      return `${line} has no Item Master item — pick the item on the Sales Order first.`;
    case 'item_type':
      return `${line}: ${f.itemCode ?? 'the item'} is not an Assembly item — a Multi-Level Plan is for an Assembly.`;
    case 'no_default_bom':
      return `${f.itemCode ?? 'The item'} has no Default Multi-Level BOM — make one (or use Make Default) first.`;
    case 'line_bom_master':
      return `${line} is linked to a BOM Master — one line uses the old BOM or the new one, never both.`;
    case 'already_planned':
      return (
        `${line} is already planned with Multi-Level Plan ${f.livePlanCode ?? ''}`.trim() + '.'
      );
    case 'line_has_plans':
      return `This line already has plan ${f.linePlanCode ?? ''} — a line uses a Multi-Level Plan or plans, not both.`;
    default:
      return `${line} cannot be planned.`;
  }
}

// ─── Guards other services call ──────────────────────────────────────────

interface LivePlanOnLine {
  soLineId: string;
  lineNo: number;
  code: string;
  planQty: number;
}

/** Live (status <> 'cancelled', not deleted) Multi-Level Plans on these SO
 *  lines, keyed by line. One query. The caller holds the lines' lock. */
export async function readLiveMlPlansOnLines(
  tx: DbTransaction,
  companyId: string,
  soLineIds: readonly string[],
): Promise<Map<string, LivePlanOnLine>> {
  const out = new Map<string, LivePlanOnLine>();
  if (soLineIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT mp.so_line_id, sol.line_no, mp.code, mp.plan_qty
    FROM public.ml_plans mp
    JOIN public.sales_order_lines sol ON sol.id = mp.so_line_id
    WHERE mp.company_id = ${companyId}::uuid
      AND mp.so_line_id = ANY(${sql.param(Array.from(new Set(soLineIds)))}::uuid[])
      AND mp.status <> 'cancelled' AND mp.deleted_at IS NULL
    ORDER BY sol.line_no
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    out.set(String(r['so_line_id']), {
      soLineId: String(r['so_line_id']),
      lineNo: Number(r['line_no']),
      code: String(r['code']),
      planQty: Number(r['plan_qty']),
    });
  }
  return out;
}

const plannedHere = (p: LivePlanOnLine): string =>
  `Line ${p.lineNo}: ${p.code} is planned on this line — cancel it first.`;

/**
 * Refuse (409) while any of these SO lines carries a live Multi-Level Plan.
 * For line cancel / remove / close short. The caller holds the lines' lock.
 */
export async function assertNoLiveMlPlan(
  tx: DbTransaction,
  companyId: string,
  soLineIds: readonly string[],
): Promise<void> {
  const live = await readLiveMlPlansOnLines(tx, companyId, soLineIds);
  const first = live.values().next();
  if (!first.done) throw new ConflictError(plannedHere(first.value));
}

/** Same, for every live line of one SO (header cancel / back to draft /
 *  delete). The caller holds the SO lines' lock. */
export async function assertNoLiveMlPlanOnSo(
  tx: DbTransaction,
  companyId: string,
  salesOrderId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT mp.code, sol.line_no
    FROM public.ml_plans mp
    JOIN public.sales_order_lines sol ON sol.id = mp.so_line_id
    WHERE mp.company_id = ${companyId}::uuid AND mp.sales_order_id = ${salesOrderId}::uuid
      AND mp.status <> 'cancelled' AND mp.deleted_at IS NULL
    ORDER BY sol.line_no, mp.code
  `)) as unknown as Array<{ code: string; line_no: number }>;
  const r = rows[0];
  if (r) {
    throw new ConflictError(
      `Line ${Number(r.line_no)}: ${r.code} is planned on this line — cancel it first.`,
    );
  }
}

/**
 * The SO line edits a live Multi-Level Plan refuses (409): removing the line,
 * cancelling or closing it, swapping its item, linking a BOM Master to it, or
 * cutting its Order Qty below the plan's Plan Qty. Only real CHANGES are checked — re-sending the stored
 * value always saves. The caller (sales-orders mergeLines) holds the lines'
 * lock from readSoLineCommitments.
 */
export async function assertSoLineEditsKeepMlPlans(
  tx: DbTransaction,
  companyId: string,
  changes: {
    removedLineIds: readonly string[];
    updates: ReadonlyArray<{
      lineId: string;
      wasStatus: string;
      status: string | undefined;
      orderQty: number | undefined;
      itemChanged: boolean;
      /** A BOM Master newly linked to the line (decision 6). */
      bomMasterLinked: boolean;
    }>;
  },
): Promise<void> {
  const ids = [...changes.removedLineIds, ...changes.updates.map((u) => u.lineId)];
  const live = await readLiveMlPlansOnLines(tx, companyId, ids);
  if (live.size === 0) return;
  for (const id of changes.removedLineIds) {
    const p = live.get(id);
    if (p) throw new ConflictError(plannedHere(p));
  }
  for (const u of changes.updates) {
    const p = live.get(u.lineId);
    if (!p) continue;
    const statusMoves = u.status !== undefined && u.status !== u.wasStatus;
    if (statusMoves && (u.status === 'cancelled' || u.status === 'closed')) {
      throw new ConflictError(plannedHere(p));
    }
    if (u.itemChanged) {
      throw new ConflictError(
        `Line ${p.lineNo}: the item cannot be changed — ${p.code} is planned on this line. Cancel it first.`,
      );
    }
    if (u.bomMasterLinked) {
      throw new ConflictError(
        `Line ${p.lineNo} is planned with Multi-Level Plan ${p.code} — it cannot also be linked to a BOM Master.`,
      );
    }
    if (u.orderQty !== undefined && u.orderQty < p.planQty) {
      throw new ConflictError(
        `Line ${p.lineNo}: Order Qty cannot go below ${p.planQty} — Multi-Level Plan ${p.code} plans ${p.planQty} set${p.planQty === 1 ? '' : 's'}. Lower its Plan Qty or cancel it first.`,
      );
    }
  }
}

/**
 * ADR-225 decision 6 (extended): a line uses a Multi-Level Plan OR ordinary
 * plans, never both. ANY plan (plans row) for an SO line that already has a
 * live Multi-Level Plan is refused — except one raised BY that Multi-Level
 * Plan (`fromMlPlanNode`, phase 4; internal only, never on the shared input).
 * Takes the SO line lock itself (own statement), the same lock ml-plan create
 * takes, so the two creates queue and the second sees the first.
 */
export async function assertLineFreeForPlan(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  fromMlPlanNode: boolean,
): Promise<void> {
  if (fromMlPlanNode) return;
  await lockSoLine(tx, companyId, soLineId);
  const live = await readLiveMlPlansOnLines(tx, companyId, [soLineId]);
  const p = live.get(soLineId);
  if (p) {
    throw new ConflictError(`This line is planned with Multi-Level Plan ${p.code}.`);
  }
}

/**
 * An SO's Type decides whether its lines may carry a Multi-Level Plan, so it
 * cannot change while one is live. Locks the SO's lines first (the lock
 * ml-plan create takes), so a plan being created at the same moment queues.
 */
export async function assertSoTypeChangeKeepsMlPlans(
  tx: DbTransaction,
  companyId: string,
  salesOrderId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT sol.id FROM public.sales_order_lines sol
    WHERE sol.sales_order_id = ${salesOrderId}::uuid AND sol.company_id = ${companyId}::uuid
      AND sol.deleted_at IS NULL
    FOR UPDATE OF sol
  `);
  const rows = (await tx.execute(sql`
    SELECT mp.code, sol.line_no
    FROM public.ml_plans mp
    JOIN public.sales_order_lines sol ON sol.id = mp.so_line_id
    WHERE mp.company_id = ${companyId}::uuid AND mp.sales_order_id = ${salesOrderId}::uuid
      AND mp.status <> 'cancelled' AND mp.deleted_at IS NULL
    ORDER BY sol.line_no, mp.code
    LIMIT 1
  `)) as unknown as Array<{ code: string; line_no: number }>;
  const r = rows[0];
  if (r) {
    throw new ConflictError(
      `The SO Type cannot change — Line ${Number(r.line_no)} is planned with Multi-Level Plan ${r.code}. Cancel it first.`,
    );
  }
}

/**
 * The live orders (plans / PRs) made from this Multi-Level Plan's rows, as
 * readable codes (order-reads.ts — the same definition Raised uses). Cancel
 * refuses while this is non-empty.
 */
export async function liveOrdersFromMlPlan(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<string[]> {
  return readLiveOrderCodes(tx, companyId, planId);
}
