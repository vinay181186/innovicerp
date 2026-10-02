// ADR-203 — the ONE place that answers three questions about a JWSO line:
//
//   1. lockJwLine            — read the line + its header under a row lock
//   2. assertJwLineOpenForWork — may new work (JC, Party GRN, issue) start on it?
//   3. recomputeJwHeaderStatus — what is the header's status, given its lines?
//   4. jwLineUsage           — which documents already use these lines?
//
// Before ADR-203 each of these was answered differently by every module (the
// audit found short-close ignored by five writers and the header status set by
// three with three rules). Every module now calls these instead; none writes
// job_work_orders.status itself (CLAUDE.md §20.1).

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, NotFoundError } from './errors';

export interface LockedJwLine {
  id: string;
  jobWorkOrderId: string;
  lineNo: number;
  itemId: string | null;
  rmItemId: string | null;
  partyMaterialId: string | null;
  orderQty: number;
  returnedQty: number;
  invoicedQty: number;
  status: string;
  shortClosedAt: string | null;
  jwCode: string;
  jwStatus: string;
  clientId: string | null;
}

/** Lock ONE live JWSO line (FOR UPDATE) and return it with its header. Lock the
 *  line BEFORE summing anything capped by it (CLAUDE.md §20.3). */
export async function lockJwLine(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
): Promise<LockedJwLine> {
  const rows = (await tx.execute(sql`
    SELECT l.id, l.job_work_order_id AS "jobWorkOrderId", l.line_no AS "lineNo",
           l.item_id AS "itemId", l.rm_item_id AS "rmItemId",
           l.party_material_id AS "partyMaterialId",
           l.order_qty AS "orderQty", l.returned_qty AS "returnedQty",
           l.invoiced_qty AS "invoicedQty", l.status::text AS status,
           l.short_closed_at AS "shortClosedAt",
           jw.code AS "jwCode", jw.status::text AS "jwStatus", jw.client_id AS "clientId"
      FROM public.job_work_order_lines l
      JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id AND jw.deleted_at IS NULL
     WHERE l.id = ${lineId}::uuid AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
     FOR UPDATE OF l
  `)) as unknown as LockedJwLine[];
  const row = rows[0];
  if (!row) throw new NotFoundError('JWSO line not found. It may have been removed.');
  return {
    ...row,
    lineNo: Number(row.lineNo),
    orderQty: Number(row.orderQty),
    returnedQty: Number(row.returnedQty),
    invoicedQty: Number(row.invoicedQty),
  };
}

/** New work — a Job Card, a Party GRN, an issue of customer material — may only
 *  start on an OPEN line of an OPEN JWSO. `what` names the action for the
 *  message ("raise a Job Card"). Returns and invoices of work already done are
 *  NOT gated by this (a short-closed line may still dispatch what it made). */
export function assertJwLineOpenForWork(line: LockedJwLine, what: string): void {
  const where = `${line.jwCode} Ln ${line.lineNo}`;
  if (line.jwStatus === 'cancelled') {
    throw new ConflictError(`${line.jwCode} is cancelled — you cannot ${what} on it.`);
  }
  if (line.shortClosedAt) {
    throw new ConflictError(`${where} is short-closed — you cannot ${what} on it.`);
  }
  if (line.status !== 'open') {
    throw new ConflictError(`${where} is ${line.status} — you cannot ${what} on it.`);
  }
}

/** Header status derived from its live lines. Never touches a draft or
 *  cancelled header, and never writes when nothing changes.
 *    every line short-closed or fully returned (returned ≥ order) → dispatched
 *    every line closed (production done, incl. short-closed)     → closed
 *    otherwise                                                   → open
 *  Returns the status now stored. */
export async function recomputeJwHeaderStatus(
  tx: DbTransaction,
  jobWorkOrderId: string,
  userId: string,
): Promise<string> {
  // Lock the header first (aggregates cannot carry FOR UPDATE), then count.
  await tx.execute(sql`
    SELECT id FROM public.job_work_orders WHERE id = ${jobWorkOrderId}::uuid FOR UPDATE
  `);
  const rows = (await tx.execute(sql`
    SELECT jw.status::text AS "jwStatus",
           count(l.id)::int AS n,
           count(l.id) FILTER (WHERE l.short_closed_at IS NOT NULL OR l.returned_qty >= l.order_qty)::int AS "doneDispatch",
           count(l.id) FILTER (WHERE l.status::text = 'closed')::int AS "doneProd"
      FROM public.job_work_orders jw
      LEFT JOIN public.job_work_order_lines l
        ON l.job_work_order_id = jw.id AND l.deleted_at IS NULL
     WHERE jw.id = ${jobWorkOrderId}::uuid AND jw.deleted_at IS NULL
     GROUP BY jw.status
  `)) as unknown as Array<{ jwStatus: string; n: number; doneDispatch: number; doneProd: number }>;
  const r = rows[0];
  if (!r) return 'open';
  if (r.jwStatus === 'draft' || r.jwStatus === 'cancelled') return r.jwStatus;
  const n = Number(r.n);
  let next = 'open';
  if (n > 0 && Number(r.doneDispatch) === n) next = 'dispatched';
  else if (n > 0 && Number(r.doneProd) === n) next = 'closed';
  if (next !== r.jwStatus) {
    await tx.execute(sql`
      UPDATE public.job_work_orders
         SET status = ${next}::so_status, updated_at = now(), updated_by = ${userId}::uuid
       WHERE id = ${jobWorkOrderId}::uuid AND status::text = ${r.jwStatus}
    `);
  }
  return next;
}

/** Which live documents use each line. A line in this map cannot be removed,
 *  and its item / UOM / BOM (and the JWSO's customer) are locked. The values
 *  are short labels for the refusal message ("JC-0045", "PGRN-00031"). */
export async function jwLineUsage(
  tx: DbTransaction,
  lineIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (lineIds.length === 0) return out;
  const ids = sql.join(
    lineIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    SELECT source_jw_line_id AS line_id, code AS label FROM public.job_cards
     WHERE source_jw_line_id IN (${ids}) AND deleted_at IS NULL
    UNION ALL
    SELECT jw_line_id, code FROM public.plans
     WHERE jw_line_id IN (${ids}) AND deleted_at IS NULL
    UNION ALL
    SELECT pgl.jw_line_id, pg.code FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.jw_line_id IN (${ids}) AND pgl.deleted_at IS NULL
    UNION ALL
    SELECT jw_line_id, code FROM public.party_material_issues
     WHERE jw_line_id IN (${ids}) AND deleted_at IS NULL
    UNION ALL
    SELECT job_work_order_line_id, code FROM public.jw_return_challans
     WHERE job_work_order_line_id IN (${ids}) AND deleted_at IS NULL AND status <> 'cancelled'
    UNION ALL
    SELECT job_work_order_line_id, code FROM public.jw_invoices
     WHERE job_work_order_line_id IN (${ids}) AND deleted_at IS NULL AND status <> 'cancelled'
    UNION ALL
    SELECT cl.jw_line_id, c.code FROM public.customer_material_return_lines cl
      JOIN public.customer_material_returns c ON c.id = cl.return_id
     WHERE cl.jw_line_id IN (${ids}) AND cl.deleted_at IS NULL AND c.status <> 'cancelled'
  `)) as unknown as Array<{ line_id: string; label: string }>;
  for (const r of rows) {
    const list = out.get(r.line_id) ?? [];
    if (!list.includes(r.label)) list.push(r.label);
    out.set(r.line_id, list);
  }
  return out;
}
