// Production Dashboard — the two lists, paged on the server (ADR-201: 25 rows
// a page, `total` from the same WHERE). They were capped at LIMIT 60 / 100.
//
//   GET /production-dashboard/open-job-cards  Open Job Cards (cards widget)
//   GET /production-dashboard/ready           Available Now (fit table, sf)

import { type SQL, sql } from 'drizzle-orm';
import type {
  ProductionDashboardJc,
  ProductionDashboardJcPage,
  ProductionDashboardPageQuery,
  ProductionDashboardReadyOp,
  ProductionDashboardReadyPage,
} from '@innovic/shared';
import { productionDashboardPageQuerySchema } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// The customer's drawing revision for the card, read live off the SO line it
// was raised against (else the JWSO line) — never items.revision. Cast to text:
// the column is only text on a database that has had migration 0119.
const REV = sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`;
// LEFT joins: a JW-sourced or standalone card has no SO line, and a row must
// never fall off the board because its item / revision could not be resolved.
const ITEM_JOINS = sql`
  LEFT JOIN public.items i ON i.id = jc.item_id
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines rev_jwl
    ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL`;

type Raw = Record<string, unknown>;

export async function listOpenJobCards(
  user: AuthContext,
  raw: ProductionDashboardPageQuery,
): Promise<ProductionDashboardJcPage> {
  const input = productionDashboardPageQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const from = sql`
    FROM public.v_jc_status s
    JOIN public.job_cards jc ON jc.id = s.job_card_id AND jc.deleted_at IS NULL
    ${ITEM_JOINS}
    WHERE s.company_id = ${companyId}::uuid AND s.computed_status = 'open'`;
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        jc.id AS "jobCardId", jc.code, i.code AS "itemCode", i.name AS "itemName",
        ${REV} AS "itemRevision",
        jc.priority, jc.order_qty AS "orderQty", jc.due_date AS "dueDate",
        s.total_ops AS "totalOps", s.done_ops AS "doneOps"
      ${from}
      ORDER BY (jc.priority = 'high') DESC, jc.due_date ASC NULLS LAST, jc.code, jc.id
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Raw[];
    const [cnt] = (await tx.execute(sql`SELECT COUNT(*)::int AS c ${from}`)) as unknown as Array<{
      c: number;
    }>;
    const items: ProductionDashboardJc[] = rows.map((r) => ({
      jobCardId: r['jobCardId'] as string,
      code: r['code'] as string,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemRevision: (r['itemRevision'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      priority: r['priority'] as ProductionDashboardJc['priority'],
      orderQty: Number(r['orderQty'] ?? 0),
      doneOps: Number(r['doneOps'] ?? 0),
      totalOps: Number(r['totalOps'] ?? 0),
      dueDate: r['dueDate'] != null ? String(r['dueDate']).slice(0, 10) : null,
    }));
    return { items, total: Number(cnt?.c) || 0 };
  });
}

/** Sort & Filter (ADR-200) on the Available Now board — the SELECT's own expressions. */
export const PROD_READY_SF_COLUMNS: SfColumnMap = {
  jobCardCode: { sql: sql`jc.code`, type: 'text' },
  opSeq: { sql: sql`jo.op_seq`, type: 'num' },
  operation: { sql: sql`jo.operation`, type: 'text' },
  available: { sql: sql`vos.available`, type: 'num' },
  computedStatus: { sql: sql`vos.computed_status`, type: 'list' },
  // CODE/REV as the cell prints it.
  itemCode: {
    sql: sql`(btrim(i.code) || COALESCE('/' || NULLIF(btrim(${REV}), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`i.name`, type: 'text' },
  machineCode: { sql: sql`m.code`, type: 'text' },
  orderQty: { sql: sql`jc.order_qty`, type: 'num' },
  completedQty: { sql: sql`vos.completed_qty`, type: 'num' },
  pendingHrs: { sql: sql`ROUND(vos.available * jo.cycle_time_min / 60.0, 2)`, type: 'num' },
};

export async function listReadyOps(
  user: AuthContext,
  raw: ProductionDashboardPageQuery,
): Promise<ProductionDashboardReadyPage> {
  const input = productionDashboardPageQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const joins: SQL = sql`
    FROM public.jc_ops jo
    JOIN public.v_jc_op_status vos ON vos.jc_op_id = jo.id
    JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
    ${ITEM_JOINS}
    LEFT JOIN public.machines m ON m.id = jo.machine_id`;
  const where: SQL = sql`
    WHERE jo.company_id = ${companyId}::uuid
      AND jo.deleted_at IS NULL
      AND jo.op_type <> 'outsource'
      AND (vos.available > 0 OR vos.computed_status = 'in_progress')
      ${sfWhere(PROD_READY_SF_COLUMNS, sf)}`;
  const order = sfOrderBy(PROD_READY_SF_COLUMNS, sf, sql`jc.code, jo.op_seq, jo.id`);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        jo.id AS "jcOpId", jc.id AS "jobCardId",
        jc.code AS "jobCardCode", jo.op_seq AS "opSeq",
        jo.operation, m.code AS "machineCode",
        i.code AS "itemCode", i.name AS "itemName", ${REV} AS "itemRevision",
        jc.order_qty AS "orderQty", vos.completed_qty AS "completedQty",
        vos.available, vos.computed_status AS "computedStatus",
        ROUND(vos.available * jo.cycle_time_min / 60.0, 2) AS "pendingHrs",
        -- Who actually made the completed qty, per machine (0095 / ADR-126);
        -- machineCode above is where the REMAINING qty runs.
        COALESCE(mo.machines, '[]'::json) AS "machines"
      ${joins}
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                 ORDER BY v.completed_qty DESC, v.machine_code
               ) AS machines
        FROM public.v_op_machine_output v
        WHERE v.jc_op_id = jo.id
      ) mo ON true
      ${where}
      ORDER BY ${order}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Raw[];
    const [cnt] = (await tx.execute(
      sql`SELECT COUNT(*)::int AS c ${joins} ${where}`,
    )) as unknown as Array<{ c: number }>;
    const items: ProductionDashboardReadyOp[] = rows.map((r) => ({
      jcOpId: r['jcOpId'] as string,
      jobCardId: r['jobCardId'] as string,
      jobCardCode: r['jobCardCode'] as string,
      opSeq: Number(r['opSeq']),
      operation: (r['operation'] as string | null) ?? '',
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemRevision: (r['itemRevision'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      machineCode: (r['machineCode'] as string | null) ?? null,
      machines: ((r['machines'] as Array<{ machineCode: string; qty: unknown }> | null) ?? []).map(
        (v) => ({ machineCode: String(v.machineCode), qty: Number(v.qty ?? 0) }),
      ),
      orderQty: Number(r['orderQty'] ?? 0),
      completedQty: Number(r['completedQty'] ?? 0),
      available: Number(r['available'] ?? 0),
      pendingHrs: Number(r['pendingHrs'] ?? 0),
      computedStatus: (r['computedStatus'] as string | null) ?? '',
    }));
    return { items, total: Number(cnt?.c) || 0 };
  });
}
