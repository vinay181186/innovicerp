// ADR-291 — the impact list an ECR builds when it is submitted: every live
// SO / JWSO line on the old Rev whose order is open, every open Job Card on
// the old Rev (finished / in progress / not started), and the old Rev's stock.
// A snapshot for the people deciding; implement re-reads every number it acts
// on under the Job Card's lock (§20.3).

import { itemRevLabel } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import type { EcrRow } from './read';

/** Order statuses that end a line's open life (header or line) — the same
 *  list the Drawing Register's "open lines" count uses. */
const DONE = sql`('closed', 'dispatched', 'cancelled')`;

/** Open Job Cards on a Rev: not closed / complete, PRO (if any) not closed. */
export async function openJobCardsOnRev(
  tx: DbTransaction,
  companyId: string,
  itemRevisionId: string,
): Promise<
  Array<{ id: string; code: string; orderQty: number; productionOrderId: string | null }>
> {
  return (await tx.execute(sql`
    SELECT jc.id, jc.code, jc.order_qty AS "orderQty", jc.production_order_id AS "productionOrderId"
      FROM public.job_cards jc
      LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
      LEFT JOIN public.production_orders po ON po.id = jc.production_order_id AND po.deleted_at IS NULL
     WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
       AND jc.item_revision_id = ${itemRevisionId}::uuid AND jc.closed_at IS NULL
       AND COALESCE(js.computed_status, 'open') NOT IN ('complete', 'closed')
       AND (po.id IS NULL OR po.status NOT IN ('closed', 'short_closed'))
     ORDER BY jc.code`)) as unknown as Array<{
    id: string;
    code: string;
    orderQty: number;
    productionOrderId: string | null;
  }>;
}

/** Every live op of the Job Cards that is not complete — what a hold covers. */
export async function unfinishedOpIds(tx: DbTransaction, jobCardIds: string[]): Promise<string[]> {
  if (jobCardIds.length === 0) return [];
  const rows = (await tx.execute(sql`
    SELECT o.id FROM public.jc_ops o
      LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = o.id
     WHERE o.job_card_id = ANY(${sql.param(jobCardIds)}::uuid[]) AND o.deleted_at IS NULL
       AND COALESCE(vos.computed_status, 'waiting') <> 'complete'`)) as unknown as Array<{
    id: string;
  }>;
  return rows.map((r) => r.id);
}

/** Build and insert the impact rows. Returns the affected Job Card ids. */
export async function buildImpacts(
  tx: DbTransaction,
  companyId: string,
  e: EcrRow,
  userId: string,
): Promise<string[]> {
  const fromLabel = itemRevLabel(e.itemCode, e.fromRev);
  type Row = {
    docType: 'so_line' | 'jw_line' | 'job_card' | 'stock';
    soLineId?: string;
    jwLineId?: string;
    jobCardId?: string;
    label: string;
    qtyDone?: number;
    qtyWip?: number;
    qtyNotStarted?: number;
    qtyStock?: number;
    disposition?: string | null;
    moveQty?: number;
  };
  const out: Row[] = [];

  const so = (await tx.execute(sql`
    SELECT l.id, h.code, l.line_no AS "lineNo"
      FROM public.sales_order_lines l JOIN public.sales_orders h ON h.id = l.sales_order_id
     WHERE l.company_id = ${companyId}::uuid AND l.item_revision_id = ${e.fromItemRevisionId}::uuid
       AND l.deleted_at IS NULL AND h.deleted_at IS NULL
       AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
     ORDER BY h.code, l.line_no`)) as unknown as Array<{
    id: string;
    code: string;
    lineNo: number;
  }>;
  for (const l of so)
    out.push({ docType: 'so_line', soLineId: l.id, label: `${l.code} Ln ${l.lineNo}` });

  const jw = (await tx.execute(sql`
    SELECT l.id, h.code, l.line_no AS "lineNo"
      FROM public.job_work_order_lines l JOIN public.job_work_orders h ON h.id = l.job_work_order_id
     WHERE l.company_id = ${companyId}::uuid AND l.item_revision_id = ${e.fromItemRevisionId}::uuid
       AND l.deleted_at IS NULL AND h.deleted_at IS NULL
       AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
     ORDER BY h.code, l.line_no`)) as unknown as Array<{
    id: string;
    code: string;
    lineNo: number;
  }>;
  for (const l of jw)
    out.push({ docType: 'jw_line', jwLineId: l.id, label: `${l.code} Ln ${l.lineNo}` });

  const jcs = await openJobCardsOnRev(tx, companyId, e.fromItemRevisionId);
  // One read for every card: finished = the LAST op's done (accepted on a QC /
  // QC-required op — as production-orders lastOpFinishedQtySql), not started =
  // the FIRST op's available less rework waiting (as reduce-qty readNotStartedQty).
  const figures = new Map<string, { done: number; notStarted: number }>();
  if (jcs.length > 0) {
    const rows = (await tx.execute(sql`
      SELECT o.job_card_id AS "jobCardId",
             (ARRAY_AGG(CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                             THEN vos.qc_accepted_qty ELSE vos.completed_qty END
                        ORDER BY o.op_seq DESC))[1] AS done,
             (ARRAY_AGG(GREATEST(0, COALESCE(vos.available, 0) - COALESCE(vos.rework_pending_qty, 0))
                        ORDER BY o.op_seq))[1] AS "notStarted"
        FROM public.jc_ops o
        LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = o.id
       WHERE o.job_card_id = ANY(${sql.param(jcs.map((j) => j.id))}::uuid[]) AND o.deleted_at IS NULL
       GROUP BY o.job_card_id`)) as unknown as Array<{
      jobCardId: string;
      done: string | number | null;
      notStarted: string | number | null;
    }>;
    for (const r of rows) {
      figures.set(r.jobCardId, {
        done: Math.max(0, Number(r.done ?? 0)),
        notStarted: Math.max(0, Number(r.notStarted ?? 0)),
      });
    }
  }
  for (const jc of jcs) {
    const { done, notStarted } = figures.get(jc.id) ?? { done: 0, notStarted: 0 };
    const wip = Math.max(0, Number(jc.orderQty) - done - notStarted);
    const doc = e.classification === 'documentation_only';
    out.push({
      docType: 'job_card',
      jobCardId: jc.id,
      label: jc.code,
      qtyDone: done,
      qtyWip: wip,
      qtyNotStarted: notStarted,
      disposition: doc ? null : 'decide_later',
      moveQty: e.classification === 'interchangeable' ? notStarted : 0,
    });
  }

  const stock = (await tx.execute(sql`
    SELECT COALESCE(SUM(on_hand_qty), 0)::numeric AS qty FROM public.item_rev_stock_balances
     WHERE company_id = ${companyId}::uuid AND item_id = ${e.itemId}::uuid
       AND item_revision_id = ${e.fromItemRevisionId}::uuid`)) as unknown as Array<{
    qty: string | number;
  }>;
  const onHand = Number(stock[0]?.qty ?? 0);
  if (onHand > 0) out.push({ docType: 'stock', label: `${fromLabel} stock`, qtyStock: onHand });

  if (out.length > 0) {
    const values = sql.join(
      out.map(
        (r) => sql`(${companyId}::uuid, ${e.id}::uuid, ${r.docType}, ${r.soLineId ?? null}::uuid,
          ${r.jwLineId ?? null}::uuid, ${r.jobCardId ?? null}::uuid, ${e.fromItemRevisionId}::uuid,
          ${r.label}, ${r.qtyDone ?? 0}, ${r.qtyWip ?? 0}, ${r.qtyNotStarted ?? 0}, ${r.qtyStock ?? 0},
          ${r.disposition ?? null}, ${r.moveQty ?? 0}, ${userId}::uuid, ${userId}::uuid)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO public.engineering_change_impacts
        (company_id, ecr_id, doc_type, so_line_id, jw_line_id, job_card_id, item_revision_id,
         label, qty_done, qty_wip, qty_not_started, qty_stock, disposition, move_qty,
         created_by, updated_by)
      VALUES ${values}`);
  }
  return jcs.map((j) => j.id);
}
