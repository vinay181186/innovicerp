// Live Operations board reads (running_ops). The ONE SELECT + row mapping is
// shared by listRunningOps (the full live list other screens read) and
// listRunningOpsPage (the board's two paged tables, ADR-201).

import type { ListRunningOpsPageQuery, RunningOp } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

export const RUNNING_OPS_SELECT = sql`
      SELECT
        r.id,
        r.jc_op_id          AS "jcOpId",
        -- The card's id alongside its code, so the Live Operations board's JC
        -- column can link straight at /job-cards/$id. The row used to carry the
        -- code only, which named a job card the board had no way to open. Never
        -- null: job_cards is joined INNER on jc_ops.job_card_id, a NOT NULL column.
        jc.id               AS "jobCardId",
        jc.code             AS "jobCardCode",
        -- What is actually being made. A board that shows only a JC code forces
        -- the reader to look the part up on another screen before they can act.
        i.code              AS "itemCode",
        i.name              AS "itemName",
        -- The CUSTOMER's drawing revision, off the SO line this card was raised
        -- against -- not items.revision, which is a different column describing
        -- the item master and would misname the drawing on the machine. The sol
        -- join below is a LEFT JOIN, so a JW-sourced or standalone card comes
        -- back null and renders as the bare code; that is common here and is the
        -- correct answer, not a gap to fill.
        --
        -- ::text on purpose: the contract types this as a string, but a database
        -- without migration 0119 still holds an integer here and would hand the
        -- board a number. The cast is a no-op once 0119 is applied.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
        -- POL = the line number printed on the CUSTOMER's own purchase order,
        -- off the same SO line as the revision above. SO side only: a job-work
        -- line has no customer PO, so JW-sourced cards are correctly null.
        sol.client_po_line_no AS "clientPoLineNo",
        o.op_seq            AS "opSeq",
        o.operation,
        r.machine_id        AS "machineId",
        m.code              AS "machineCode",
        -- The PLAN beside the ACTUAL above (ADR-164): the op's own machine, or
        -- its text snapshot when no FK resolved -- never the 'QC' type label.
        COALESCE(pm.code, NULLIF(o.machine_code_text, 'QC')) AS "plannedMachineCode",
        r.is_osp            AS "isOsp",
        r.operator_id       AS "operatorId",
        r.operator_name     AS "operatorName",
        -- ADR-197 — the logged-in user who pressed Start, beside the operator
        -- on the floor (untyped extra; the web types it locally).
        COALESCE(su.full_name, su.email) AS "startedByName",
        r.start_date        AS "startDate",
        r.start_time::text  AS "startTime",
        r.shift,
        r.status,
        r.ended_at          AS "endedAt",
        -- The live cap the Stop box shows ("you can log up to N"). Joined, not
        -- fetched per row: one query for the whole board.
        COALESCE(s.available, 0)::int AS "availableQty"
      FROM public.running_ops r
      JOIN public.jc_ops o    ON o.id = r.jc_op_id
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      -- LEFT, although job_cards.item_id is NOT NULL: this is a live board and
      -- an unresolvable item must never silently drop a running session off it.
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines rev_jwl
        ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = r.machine_id
      LEFT JOIN public.machines pm ON pm.id = o.machine_id
      LEFT JOIN public.users su ON su.id = r.created_by
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = r.jc_op_id
`;

export function toRunningOp(r: Record<string, unknown>): RunningOp {
  return {
    ...r,
    opSeq: Number(r['opSeq']),
    availableQty: Number(r['availableQty'] ?? 0),
    // Pinned to null rather than left to the spread: the contract types these
    // three as `string | null`, and a row that resolved no item or no SO line
    // must arrive as an explicit null, never as an absent key.
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemRevision: (r['itemRevision'] as string | null) ?? null,
    clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    plannedMachineCode: (r['plannedMachineCode'] as string | null) ?? null,
    startedByName: (r['startedByName'] as string | null) ?? null,
    startDate:
      r['startDate'] instanceof Date
        ? (r['startDate'] as Date).toISOString().slice(0, 10)
        : String(r['startDate']),
    endedAt:
      r['endedAt'] instanceof Date
        ? (r['endedAt'] as Date).toISOString()
        : (r['endedAt'] as string | null),
  } as unknown as RunningOp;
}

/** Sort & Filter (ADR-200) — the board's columns, as RUNNING_OPS_SELECT shows them. */
export const RUNNING_OPS_SF_COLUMNS: SfColumnMap = {
  jobCardCode: { sql: sql`jc.code`, type: 'text' },
  opSeq: { sql: sql`o.op_seq`, type: 'num' },
  operation: { sql: sql`o.operation`, type: 'text' },
  itemCode: {
    sql: sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`i.name`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  machineCode: { sql: sql`m.code`, type: 'text' },
  plannedMachineCode: {
    sql: sql`COALESCE(pm.code, NULLIF(o.machine_code_text, 'QC'))`,
    type: 'text',
  },
  operatorName: { sql: sql`r.operator_name`, type: 'text' },
  startDate: { sql: sql`r.start_date`, type: 'date' },
  endedAt: { sql: sql`(r.ended_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  status: { sql: sql`r.status`, type: 'list' },
};

/**
 * One page of the board (ADR-201): `running` = live sessions, `recent` = every
 * finished / cancelled one. Newest first, r.id last so paging never repeats a
 * row; `total` uses the same where as the page.
 */
export async function listRunningOpsPage(
  input: ListRunningOpsPageQuery,
  user: AuthContext,
): Promise<{ items: RunningOp[]; total: number }> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sf = readSf(input.sf);
  const viewFrag =
    input.view === 'running'
      ? sql`AND r.status = 'running'::running_op_status`
      : sql`AND r.status <> 'running'::running_op_status`;
  const where = sql`WHERE r.company_id = ${companyId}::uuid ${viewFrag} ${sfWhere(RUNNING_OPS_SF_COLUMNS, sf)}`;
  // Same newest-first order the board always had (by start), r.id last.
  const orderBy = sfOrderBy(
    RUNNING_OPS_SF_COLUMNS,
    sf,
    sql`r.start_date DESC, r.start_time DESC, r.id DESC`,
  );
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      ${RUNNING_OPS_SELECT}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const cnt = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM (${RUNNING_OPS_SELECT} ${where}) t
    `)) as unknown as Array<{ total: number }>;
    return { items: rows.map(toRunningOp), total: Number(cnt[0]?.total ?? 0) };
  });
}
