// SO / JWSO status by day (ADR-325) — THE one reader of the 11 figures (§26.3).
// The live screen (today) and the snapshot timer (saved copy) both call
// loadOrderStatusRows; nothing else computes these numbers.
//
// Level: per ORDER (one SO or one JWSO), summed over its live lines. No cap —
// these are counts of documents and two quantity sums, not progress against
// the order qty.
//
// Orders counted: sales_orders / job_work_orders of the company with
//   deleted_at NULL, status <> 'cancelled' and cancelled_at NULL. CLOSED orders
//   are INCLUDED (owner's Excel). Newest created first (ADR-318).
//
// Figure          | documents counted                                     | left out
// ----------------|-------------------------------------------------------|-------------------------------
// totalLines      | sales_order_lines / job_work_order_lines of the order | deleted lines
// totalPlans      | plans on those lines (so_line_id / jw_line_id)        | deleted, plan_status cancelled, cancelled_at set
// totalRc         | DISTINCT route_cards over the order: route cards whose| deleted route cards
//                 | item_id = a counted plan's item_id, UNION the counted |
//                 | PROs' route_card_id                                   |
// proReleased     | production_orders on the counted plans (plan_id)      | deleted, cancelled_at set, status cancelled
// proClosed       | counted PROs with status closed / short_closed        | as proReleased
// jcReleased      | job_cards on the lines (source_so_line_id /           | deleted, cancelled_at set, rework/repair
//                 | source_jw_line_id)                                    | children (parent_job_card_id set)
// jcClosed        | counted JCs with closed_at set                        | as jcReleased
// jcRunning       | counted open JCs where ANY op has started work        | as jcReleased
// jcNotStarted    | counted open JCs where no op has started work         | as jcReleased
//                 | "started" = calc-engine enrichOps → opHasStartedWork, fed exactly as getSoOverview
//                 | (so-overview/service.ts): ops, op logs, running ops, OSP accepted, open rework.
//                 | Not Started + Running + Closed = JC Released, always (checked below).
// dispatchQty     | SO: SUM(sales_order_lines.dispatched_qty);            | deleted lines
//                 | JWSO: SUM(job_work_order_lines.returned_qty)          |
// physicalStock   | SO: SUM(qty − consumed_qty − released_qty) of         | deleted, status other than active /
//                 | so_stock_reservations on the SO's lines (floor 0)     | partially_consumed
//                 | JWSO: 0 — JWSO lines have no finished-stock reservation (party_stock_ledger is the
//                 | customer's own material, a different fact).

import type { OrderKind, OrderStatusRow } from '@innovic/shared';
import { and, asc, inArray, isNull, eq, sql, type SQL } from 'drizzle-orm';
import { jcOps, jobCards, opLog, runningOps } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { enrichOps, opHasStartedWork } from '../../lib/calc-engine';
import { env } from '../../lib/env';
import { loadOpenReworkByOp } from '../../lib/open-rework';
import { loadOspAcceptedByOp } from '../../lib/osp-accepted';

/** The live documents of one company, as CTEs every query below starts from. */
function baseCtes(companyId: string): SQL {
  const c = sql`${companyId}::uuid`;
  return sql`
    WITH ord AS (
      SELECT 'SO'::text AS kind, so.id, so.code, so.created_at FROM public.sales_orders so
       WHERE so.company_id = ${c} AND so.deleted_at IS NULL
         AND so.status <> 'cancelled' AND so.cancelled_at IS NULL
      UNION ALL
      SELECT 'JWSO'::text, jw.id, jw.code, jw.created_at FROM public.job_work_orders jw
       WHERE jw.company_id = ${c} AND jw.deleted_at IS NULL
         AND jw.status <> 'cancelled' AND jw.cancelled_at IS NULL
    ),
    ln AS (
      SELECT 'SO'::text AS kind, l.sales_order_id AS order_id, l.id AS line_id,
             l.dispatched_qty::numeric AS moved_qty
        FROM public.sales_order_lines l
        JOIN ord o ON o.kind = 'SO' AND o.id = l.sales_order_id
       WHERE l.deleted_at IS NULL
      UNION ALL
      SELECT 'JWSO'::text, l.job_work_order_id, l.id, l.returned_qty::numeric
        FROM public.job_work_order_lines l
        JOIN ord o ON o.kind = 'JWSO' AND o.id = l.job_work_order_id
       WHERE l.deleted_at IS NULL
    ),
    pl AS (
      SELECT ln.kind, ln.order_id, p.id AS plan_id, p.item_id FROM public.plans p
        JOIN ln ON ln.kind = 'SO' AND p.so_line_id = ln.line_id
       WHERE p.company_id = ${c} AND p.deleted_at IS NULL
         AND p.plan_status <> 'cancelled' AND p.cancelled_at IS NULL
      UNION ALL
      SELECT ln.kind, ln.order_id, p.id, p.item_id FROM public.plans p
        JOIN ln ON ln.kind = 'JWSO' AND p.jw_line_id = ln.line_id
       WHERE p.company_id = ${c} AND p.deleted_at IS NULL
         AND p.plan_status <> 'cancelled' AND p.cancelled_at IS NULL
    ),
    pro AS (
      SELECT pl.kind, pl.order_id, po.id, po.status, po.route_card_id
        FROM public.production_orders po
        JOIN pl ON po.plan_id = pl.plan_id
       WHERE po.company_id = ${c} AND po.deleted_at IS NULL
         AND po.cancelled_at IS NULL AND po.status <> 'cancelled'
    ),
    rc AS (
      SELECT pl.kind, pl.order_id, r.id AS rc_id FROM pl
        JOIN public.route_cards r
          ON r.item_id = pl.item_id AND r.company_id = ${c} AND r.deleted_at IS NULL
      UNION
      SELECT pro.kind, pro.order_id, pro.route_card_id FROM pro WHERE pro.route_card_id IS NOT NULL
    ),
    jc AS (
      SELECT ln.kind, ln.order_id, j.id, j.closed_at FROM public.job_cards j
        JOIN ln ON ln.kind = 'SO' AND j.source_so_line_id = ln.line_id
       WHERE j.company_id = ${c} AND j.deleted_at IS NULL
         AND j.cancelled_at IS NULL AND j.parent_job_card_id IS NULL
      UNION ALL
      SELECT ln.kind, ln.order_id, j.id, j.closed_at FROM public.job_cards j
        JOIN ln ON ln.kind = 'JWSO' AND j.source_jw_line_id = ln.line_id
       WHERE j.company_id = ${c} AND j.deleted_at IS NULL
         AND j.cancelled_at IS NULL AND j.parent_job_card_id IS NULL
    ),
    stk AS (
      SELECT ln.order_id, SUM(r.qty - r.consumed_qty - r.released_qty) AS qty
        FROM public.so_stock_reservations r
        JOIN ln ON ln.kind = 'SO' AND r.so_line_id = ln.line_id
       WHERE r.company_id = ${c} AND r.deleted_at IS NULL
         AND r.status IN ('active', 'partially_consumed')
       GROUP BY ln.order_id
    )`;
}

interface CountRow {
  kind: OrderKind;
  id: string;
  code: string;
  lines: number;
  plans: number;
  rcs: number;
  pros: number;
  proClosed: number;
  jcs: number;
  jcClosed: number;
  moved: string | number;
  stock: string | number;
}

/** Every SO and every JWSO with its 11 figures, newest created first. */
export async function loadOrderStatusRows(
  tx: DbTransaction,
  companyId: string,
): Promise<OrderStatusRow[]> {
  const counts = (await tx.execute(sql`
    ${baseCtes(companyId)},
    ln_agg AS (SELECT kind, order_id, count(*)::int AS n, COALESCE(SUM(moved_qty), 0) AS moved
                 FROM ln GROUP BY kind, order_id),
    pl_agg AS (SELECT kind, order_id, count(*)::int AS n FROM pl GROUP BY kind, order_id),
    rc_agg AS (SELECT kind, order_id, count(DISTINCT rc_id)::int AS n FROM rc GROUP BY kind, order_id),
    pro_agg AS (SELECT kind, order_id, count(*)::int AS n,
                       (count(*) FILTER (WHERE status IN ('closed', 'short_closed')))::int AS closed
                  FROM pro GROUP BY kind, order_id),
    jc_agg AS (SELECT kind, order_id, count(*)::int AS n,
                      (count(*) FILTER (WHERE closed_at IS NOT NULL))::int AS closed
                 FROM jc GROUP BY kind, order_id)
    SELECT o.kind, o.id, o.code,
           COALESCE(la.n, 0) AS lines, COALESCE(la.moved, 0)::text AS moved,
           COALESCE(pa.n, 0) AS plans, COALESCE(ra.n, 0) AS rcs,
           COALESCE(oa.n, 0) AS pros, COALESCE(oa.closed, 0) AS "proClosed",
           COALESCE(ja.n, 0) AS jcs, COALESCE(ja.closed, 0) AS "jcClosed",
           (CASE WHEN o.kind = 'SO' THEN GREATEST(COALESCE(s.qty, 0), 0) ELSE 0 END)::text AS stock
      FROM ord o
      LEFT JOIN ln_agg la ON la.kind = o.kind AND la.order_id = o.id
      LEFT JOIN pl_agg pa ON pa.kind = o.kind AND pa.order_id = o.id
      LEFT JOIN rc_agg ra ON ra.kind = o.kind AND ra.order_id = o.id
      LEFT JOIN pro_agg oa ON oa.kind = o.kind AND oa.order_id = o.id
      LEFT JOIN jc_agg ja ON ja.kind = o.kind AND ja.order_id = o.id
      LEFT JOIN stk s ON o.kind = 'SO' AND s.order_id = o.id
     ORDER BY o.created_at DESC, o.id DESC
  `)) as unknown as CountRow[];

  const openJcs = (await tx.execute(sql`
    ${baseCtes(companyId)}
    SELECT jc.kind, jc.order_id AS "orderId", jc.id FROM jc WHERE jc.closed_at IS NULL
  `)) as unknown as Array<{ kind: OrderKind; orderId: string; id: string }>;

  const runningByOrder = await countRunningJcs(tx, companyId, openJcs);

  return counts.map((r) => {
    const key = `${r.kind}:${r.id}`;
    const jcRunning = runningByOrder.get(key) ?? 0;
    const jcOpen = Number(r.jcs) - Number(r.jcClosed);
    const row: OrderStatusRow = {
      orderKind: r.kind,
      orderId: r.id,
      orderCode: r.code,
      totalLines: Number(r.lines),
      totalPlans: Number(r.plans),
      totalRc: Number(r.rcs),
      proReleased: Number(r.pros),
      jcReleased: Number(r.jcs),
      jcNotStarted: jcOpen - jcRunning,
      jcRunning,
      jcClosed: Number(r.jcClosed),
      proClosed: Number(r.proClosed),
      dispatchQty: Number(r.moved),
      physicalStock: Number(r.stock),
    };
    assertJcSplit(row);
    return row;
  });
}

/** Not Started + Running + Closed must equal JC Released. Tests only: throw
 *  (never on a deployed API, where one odd order must not break the page). */
function assertJcSplit(row: OrderStatusRow): void {
  if (env.NODE_ENV !== 'test') return;
  const sum = row.jcNotStarted + row.jcRunning + row.jcClosed;
  if (sum !== row.jcReleased || row.jcNotStarted < 0) {
    throw new Error(
      `so-jwso-status: JC split ${sum} ≠ JC Released ${row.jcReleased} on ${row.orderCode}`,
    );
  }
}

/** Open JCs with any started op, per order (`kind:orderId`). Batched — one
 *  load per table for every open JC — and fed to enrichOps exactly as
 *  getSoOverview feeds it. */
async function countRunningJcs(
  tx: DbTransaction,
  companyId: string,
  openJcs: ReadonlyArray<{ kind: OrderKind; orderId: string; id: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (openJcs.length === 0) return out;
  const jcIds = openJcs.map((j) => j.id);
  const opIdsOfJcs = tx
    .select({ id: jcOps.id })
    .from(jcOps)
    .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt)));

  const [jcRows, opRows, logRows, runningRows, ospAcceptedByOp, openReworkByOp] = await Promise.all(
    [
      tx.select().from(jobCards).where(inArray(jobCards.id, jcIds)),
      tx
        .select()
        .from(jcOps)
        .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt)))
        .orderBy(asc(jcOps.jobCardId), asc(jcOps.opSeq)),
      tx.select().from(opLog).where(inArray(opLog.jcOpId, opIdsOfJcs)),
      tx
        .select({ jcOpId: runningOps.jcOpId })
        .from(runningOps)
        .where(and(eq(runningOps.status, 'running'), inArray(runningOps.jcOpId, opIdsOfJcs))),
      loadOspAcceptedByOp(tx, companyId, jcIds),
      loadOpenReworkByOp(tx, companyId, jcIds),
    ],
  );

  const opsByJc = new Map<string, typeof opRows>();
  for (const op of opRows) {
    const arr = opsByJc.get(op.jobCardId);
    if (arr) arr.push(op);
    else opsByJc.set(op.jobCardId, [op]);
  }
  const logsByOp = new Map<string, typeof logRows>();
  for (const log of logRows) {
    const arr = logsByOp.get(log.jcOpId);
    if (arr) arr.push(log);
    else logsByOp.set(log.jcOpId, [log]);
  }
  const runningOpIds = new Set(runningRows.map((r) => r.jcOpId));
  const jcById = new Map(jcRows.map((j) => [j.id, j]));

  for (const open of openJcs) {
    const jc = jcById.get(open.id);
    if (!jc) continue;
    const ops = opsByJc.get(jc.id) ?? [];
    const logs = ops.flatMap((o) => logsByOp.get(o.id) ?? []);
    const enriched = enrichOps(jc, ops, logs, runningOpIds, ospAcceptedByOp, openReworkByOp);
    if (enriched.some(opHasStartedWork)) {
      const key = `${open.kind}:${open.orderId}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}
