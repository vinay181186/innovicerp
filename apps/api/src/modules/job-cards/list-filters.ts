// The Job Card list's FROM + WHERE, shared by the list page, its total and the
// JC Status dropdown counts (ADR-201) — one definition, so the counts and the
// pages can never disagree about which cards match.

import { type SQL, sql } from 'drizzle-orm';
import { sfTodayIst } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { readSf, sfWhere } from '../../lib/list-query';
import type { JcStatusCountsQuery, JcStatusCountsResponse, ListJobCardsQuery } from './schema';
import { JC_SF_COLUMNS } from './sf-columns';

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "50%" or "a_b" in the Job Card search box gets a wildcard
 *  pattern instead of a literal search — a bare "%" returned every job card.
 *  The SQL side must pair it with an ESCAPE '\' clause on every ILIKE, or the
 *  escapes match literally.
 *  Deliberately a local copy of the sales-orders helper rather than an export
 *  across modules: it is three lines, and each list must be free to change its
 *  own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** The joins after `FROM public.job_cards jc` — every alias the list SELECT,
 *  the search and the Sort & Filter map (sf-columns.ts) refer to. */
export const JC_LIST_JOINS = sql`
      LEFT JOIN public.items i ON i.id = jc.item_id
      -- The item's single active route card (route_cards is unique per item) —
      -- surfaces the route-card reference (code + current revision) on the JC.
      LEFT JOIN public.route_cards rc
        ON rc.company_id = jc.company_id AND rc.item_id = jc.item_id AND rc.deleted_at IS NULL
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      LEFT JOIN public.job_cards pjc ON pjc.id = jc.parent_job_card_id
      LEFT JOIN public.nc_register pnc ON pnc.id = jc.parent_nc_id
      LEFT JOIN public.production_orders po
        ON po.id = jc.production_order_id AND po.deleted_at IS NULL
      -- The parent card's Production Order — a rework/repair child reads its
      -- Customer Dispatch Date off the parent's plan (see the list select).
      LEFT JOIN public.production_orders pjc_po
        ON pjc_po.id = pjc.production_order_id AND pjc_po.deleted_at IS NULL
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
        ON cli_jw.id = jw.client_id AND cli_jw.deleted_at IS NULL`;

/** Late and unfinished — the SAME rule as the screen's Days Left colour: the
 *  due date the list shows is before today (IST) and the card is not
 *  complete / closed. A card with no due date is never overdue. */
export function jcOverdueSql(today: string = sfTodayIst()): SQL {
  return sql`(COALESCE(jc.due_date, sol.due_date, jwl.due_date) < ${today}::date
    AND COALESCE(s.computed_status, 'no_ops') NOT IN ('closed', 'complete'))`;
}

type JcListFilterInput = Omit<ListJobCardsQuery, 'limit' | 'offset'>;

/** The WHERE body (company + not deleted + search + every filter + sf). */
export function jcListWhere(companyId: string, input: JcListFilterInput): SQL {
  // Search covers every field the JC list card actually shows — band 1 (JC
  // code, item name, item code, the SO/JWSO source code, the priority badge
  // and the computed-status badge) and band 2's meta line (JC date, client PO
  // line no, due date, remarks). Customer name is kept from the original
  // clause set: the search box placeholder advertises "customer", even though
  // the card itself resolves the customer only on the detail page.
  // Deliberately NOT searched: order qty, completed / pending / ops counts and
  // the running-op count — matching numbers would make "1" hit nearly every
  // job card. No money column either: the JC list shows none, and this module
  // hides prices behind `canSeeFormPrice` elsewhere, so a searchable amount
  // would let a user without that right confirm a value by guessing.
  const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
  const searchFrag = term
    ? sql`AND (
          jc.code ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR jw.code ILIKE ${term} ESCAPE '\\'
          OR so.customer_name ILIKE ${term} ESCAPE '\\'
          OR jw.customer_name ILIKE ${term} ESCAPE '\\'
          OR cli_so.name ILIKE ${term} ESCAPE '\\'
          OR cli_jw.name ILIKE ${term} ESCAPE '\\'
          -- Badges on band 1: priority renders as High/Normal, status as the
          -- computed status. Both are matched on the stored value.
          OR jc.priority::text ILIKE ${term} ESCAPE '\\'
          OR COALESCE(s.computed_status, 'no_ops')::text ILIKE ${term} ESCAPE '\\'
          -- Band 2 meta line, in the order the card prints it.
          OR jc.jc_date::text ILIKE ${term} ESCAPE '\\'
          OR sol.client_po_line_no ILIKE ${term} ESCAPE '\\'
          -- Same COALESCE the SELECT uses for "dueDate", so what the card shows
          -- is what the search matches.
          OR COALESCE(jc.due_date, sol.due_date, jwl.due_date)::text ILIKE ${term} ESCAPE '\\'
          OR jc.remarks ILIKE ${term} ESCAPE '\\'
        )`
    : sql``;
  const statusFrag = input.status
    ? sql`AND COALESCE(s.computed_status, 'no_ops') = ${input.status}`
    : sql``;
  const overdueFrag = input.overdue ? sql`AND ${jcOverdueSql()}` : sql``;
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
  // Sort & Filter (ADR-200): the screen's column filters, through the list's
  // own field whitelist (sf-columns.ts).
  const sfFrag = sfWhere(JC_SF_COLUMNS, readSf(input.sf));

  return sql`jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${overdueFrag}
        ${fromFrag}
        ${toFrag}
        ${machineFrag}
        ${operatorFrag}
        ${sfFrag}`;
}

/** GET /job-cards/status-counts — the JC Status dropdown counts (ADR-201):
 *  one query over EVERY card the list's other filters match. */
export async function jcStatusCounts(
  input: JcStatusCountsQuery,
  companyId: string,
  user: AuthContext,
): Promise<JcStatusCountsResponse> {
  return withUserContext(user, async (tx) => {
    const st = sql`COALESCE(s.computed_status, 'no_ops')`;
    const rows = (await tx.execute(sql`
      SELECT
        COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE ${st} = 'open')::int       AS "open",
        COUNT(*) FILTER (WHERE ${st} = 'qc_pending')::int AS "qcPending",
        COUNT(*) FILTER (WHERE ${st} = 'complete')::int   AS "complete",
        COUNT(*) FILTER (WHERE ${st} = 'closed')::int     AS "closed",
        COUNT(*) FILTER (WHERE ${st} = 'no_ops')::int     AS "noOps",
        COUNT(*) FILTER (WHERE ${jcOverdueSql()})::int    AS "overdue"
      FROM public.job_cards jc
      ${JC_LIST_JOINS}
      WHERE ${jcListWhere(companyId, input)}
    `)) as unknown as Array<Record<string, number>>;
    const r = rows[0] ?? {};
    const n = (k: string): number => Number(r[k] ?? 0);
    return {
      all: n('all'),
      byStatus: {
        open: n('open'),
        qc_pending: n('qcPending'),
        complete: n('complete'),
        closed: n('closed'),
        no_ops: n('noOps'),
      },
      overdue: n('overdue'),
    };
  });
}
