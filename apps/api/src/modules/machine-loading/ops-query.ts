// Machine Loading — the open-operations query (Production Wave 3), split from
// service.ts for the 25-row paging (ADR-201). One SELECT / FROM / WHERE serves
// the whole-board call (no paging, unchanged) and the paged screen call, which
// adds the machine pick, search, the Operation-View scope, Sort & Filter and
// LIMIT / OFFSET — and counts with the SAME WHERE.

import { sql, type SQL } from 'drizzle-orm';
import type { MachineLoadOp, MachineLoadingQuery } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

/** CODE/REV exactly as the cell prints it (itemCodeWithRev). */
const CODE_REV = sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`;

/** Sort & Filter (ADR-200) fields of the open-operations table — each the same
 *  expression the SELECT shows, valid in the count query too. */
export const MACHINE_LOAD_SF_COLUMNS: SfColumnMap = {
  jcCode: { sql: sql`jc.code`, type: 'text' },
  opSeq: { sql: sql`jo.op_seq`, type: 'num' },
  operation: { sql: sql`jo.operation`, type: 'text' },
  itemCode: { sql: CODE_REV, type: 'text' },
  available: { sql: sql`vos.available`, type: 'num' },
  pendingHrs: { sql: sql`ROUND(vos.available * jo.cycle_time_min / 60.0, 2)`, type: 'num' },
  opStatus: { sql: sql`vos.computed_status`, type: 'list' },
  dueDate: { sql: sql`jc.due_date`, type: 'date' },
};

// Priority (High first) -> due date -> op_seq -> op id (unique, so a page never
// repeats or skips a row).
const DEFAULT_ORDER = sql`(jc.priority = 'high') DESC, jc.due_date ASC NULLS LAST, jo.op_seq ASC, jo.id ASC`;

const SELECT_LIST = sql.raw(`
      SELECT
        jo.id AS "jcOpId", jo.job_card_id AS "jobCardId", jc.code AS "jobCardCode",
        jo.op_seq AS "opSeq", jo.operation, jo.machine_id AS "machineId",
        m.code AS "machineCode",
        i.code AS "itemCode", i.name AS "itemName",
        -- The customer's drawing revision off the SO line this card was raised
        -- against, not items.revision (a different column, about the item master).
        -- The sol join below is a LEFT JOIN, so JW-sourced and standalone cards
        -- come back null and render as the bare code.
        --
        -- ::text on purpose: the contract types this as a string, but a database
        -- without migration 0119 still holds an integer here and would hand the
        -- board a number. The cast is a no-op once 0119 is applied.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
        -- POL = the line number printed on the CUSTOMER's own purchase order,
        -- off the same SO line as the revision above. SO side only: a job-work
        -- line has no customer PO, so JW-sourced cards are correctly null.
        sol.client_po_line_no AS "clientPoLineNo",
        so.code AS "soCode",
        so.internal_so_no AS "soInternalNo",
        jc.priority, jc.due_date AS "dueDate", jc.order_qty AS "orderQty",
        vos.completed_qty AS "completedQty", vos.available,
        vos.computed_status AS "computedStatus",
        ROUND(vos.available * jo.cycle_time_min / 60.0, 2) AS "pendingHrs",
        -- Who actually made the completed qty, per machine (0095 / ADR-126). The
        -- machine columns above are the op's CURRENT machine — where the
        -- REMAINING qty runs — so on a re-routed op they name a machine that may
        -- have produced nothing. This is the honest breakdown.
        COALESCE(mo.machines, '[]'::json) AS "machines"
`);

const FROM_WHERE = (companyId: string): SQL => sql`
      FROM public.jc_ops jo
      JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = jo.machine_id
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines rev_jwl
        ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                 ORDER BY v.completed_qty DESC, v.machine_code
               ) AS machines
        FROM public.v_op_machine_output v
        WHERE v.jc_op_id = jo.id
      ) mo ON true
      WHERE jo.company_id = ${companyId}::uuid
        AND jo.deleted_at IS NULL
        AND jo.op_type <> 'outsource'
        AND vos.computed_status <> 'complete'
`;

function toOp(r: Record<string, unknown>): MachineLoadOp {
  return {
    jcOpId: r['jcOpId'] as string,
    jobCardId: r['jobCardId'] as string,
    jobCardCode: r['jobCardCode'] as string,
    opSeq: Number(r['opSeq']),
    operation: (r['operation'] as string | null) ?? '',
    machineId: (r['machineId'] as string | null) ?? null,
    machineCode: (r['machineCode'] as string | null) ?? null,
    machines: ((r['machines'] as Array<{ machineCode: string; qty: unknown }> | null) ?? []).map(
      (v) => ({ machineCode: String(v.machineCode), qty: Number(v.qty ?? 0) }),
    ),
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemRevision: (r['itemRevision'] as string | null) ?? null,
    clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    soCode: (r['soCode'] as string | null) ?? null,
    soInternalNo: (r['soInternalNo'] as string | null) ?? null,
    priority: r['priority'] as MachineLoadOp['priority'],
    dueDate: r['dueDate'] != null ? String(r['dueDate']).slice(0, 10) : null,
    orderQty: Number(r['orderQty'] ?? 0),
    completedQty: Number(r['completedQty'] ?? 0),
    available: Number(r['available'] ?? 0),
    pendingHrs: Number(r['pendingHrs'] ?? 0),
    computedStatus: (r['computedStatus'] as string | null) ?? '',
  };
}

/** Screen-side filters (paged mode). */
function pagedWhere(input: MachineLoadingQuery): SQL {
  const parts: SQL[] = [];
  if (input.machineId) parts.push(sql`AND jo.machine_id = ${input.machineId}::uuid`);
  // The Operation View's narrow set (legacy renderLoading L5060); the printed
  // queue asks for scope 'queue' = every non-complete op.
  if ((input.scope ?? 'ops') === 'ops') {
    parts.push(sql`AND (vos.available > 0 OR vos.computed_status = 'in_progress')`);
  }
  const term = (input.search ?? '').trim();
  if (term !== '') {
    const pat = `%${likeEscape(term)}%`;
    parts.push(sql`AND (
      jc.code ILIKE ${pat} ESCAPE '\\'
      OR sol.client_po_line_no ILIKE ${pat} ESCAPE '\\'
      OR ${CODE_REV} ILIKE ${pat} ESCAPE '\\'
      OR i.name ILIKE ${pat} ESCAPE '\\'
      OR so.code ILIKE ${pat} ESCAPE '\\'
      OR so.internal_so_no ILIKE ${pat} ESCAPE '\\'
      OR jo.operation ILIKE ${pat} ESCAPE '\\'
    )`);
  }
  parts.push(sfWhere(MACHINE_LOAD_SF_COLUMNS, readSf(input.sf)));
  return sql.join(parts, sql` `);
}

/** Every open op (whole board, no paging) — the unchanged default. */
export async function allOpenOps(tx: DbTransaction, companyId: string): Promise<MachineLoadOp[]> {
  const rows = (await tx.execute(sql`
    ${SELECT_LIST} ${FROM_WHERE(companyId)}
    ORDER BY ${DEFAULT_ORDER}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(toOp);
}

/** One page of open ops + the total with the SAME filters. */
export async function pagedOpenOps(
  tx: DbTransaction,
  companyId: string,
  input: MachineLoadingQuery & { limit: number },
): Promise<{ ops: MachineLoadOp[]; total: number }> {
  const where = pagedWhere(input);
  const orderBy = sfOrderBy(MACHINE_LOAD_SF_COLUMNS, readSf(input.sf), DEFAULT_ORDER);
  const rows = (await tx.execute(sql`
    ${SELECT_LIST} ${FROM_WHERE(companyId)} ${where}
    ORDER BY ${orderBy}
    LIMIT ${input.limit} OFFSET ${input.offset ?? 0}
  `)) as unknown as Array<Record<string, unknown>>;
  const [c] = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n ${FROM_WHERE(companyId)} ${where}
  `)) as unknown as Array<{ n: number }>;
  return { ops: rows.map(toOp), total: Number(c?.n ?? 0) };
}
