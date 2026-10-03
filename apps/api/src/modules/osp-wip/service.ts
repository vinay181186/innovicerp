// OSP At-Vendor / WIP register service (read-only).
//
// Reads v_osp_wip (migration 0064) — one row per outsource jc_op reconciling
// order_qty into accepted / at_vendor / not_sent buckets, all derived from
// documents already created (JC op counters + outward-DC receipt lines).
// Nothing here mutates state.

import { sql } from 'drizzle-orm';
import type { ListOspWipQuery, ListOspWipResponse, OspWipRow } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { OSP_WIP_SF_COLUMNS } from './sf-columns';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

interface WipRawRow {
  jc_op_id: string;
  job_card_id: string;
  jc_code: string;
  op_seq: number;
  operation: string | null;
  outsource_status: string | null;
  item_id: string | null;
  item_code: string | null;
  item_revision: string | null;
  client_po_line_no: string | null;
  item_name: string | null;
  so_code: string | null;
  so_internal_no: string | null;
  vendor_name: string | null;
  vendor_code: string | null;
  order_qty: number;
  sent_qty: number;
  returned_qty: number;
  rejected_qty: number;
  accepted_qty: number;
  at_vendor_qty: number;
  not_sent_qty: number;
  in_qc_qty: number;
  ready_to_send_qty: number;
}

export async function listOspWip(
  input: ListOspWipQuery,
  user: AuthContext,
): Promise<ListOspWipResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? // POL (sol.client_po_line_no) is now a column on this register, so the
        // box must find it. sol is the SO-line join the FROM below makes.
        sql`AND (w.jc_code ILIKE ${term} ESCAPE '\\' OR w.item_code ILIKE ${term} ESCAPE '\\'
          OR w.item_name ILIKE ${term} ESCAPE '\\' OR w.so_code ILIKE ${term} ESCAPE '\\'
          OR w.vendor_name ILIKE ${term} ESCAPE '\\' OR sol.client_po_line_no ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\')`
      : sql``;
    // Sort & Filter (ADR-200): the register's column filters + sort.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(OSP_WIP_SF_COLUMNS, sf);
    const bucketFrag =
      input.filter === 'at_vendor'
        ? sql`AND w.at_vendor_qty > 0`
        : input.filter === 'not_sent'
          ? sql`AND w.not_sent_qty > 0`
          : input.filter === 'ready_to_send'
            ? sql`AND w.ready_to_send_qty > 0`
            : sql``;
    const fromFrag = sql`
      FROM public.v_osp_wip w
      LEFT JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      -- ADR-207: the Internal SO No., live off the SAME SO the view's so_code
      -- comes from (jc.source_so_line_id), joined here so the view is unchanged.
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines rev_jwl
        ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
      WHERE w.company_id = ${companyId}::uuid
        ${searchFrag}
        ${sfFrag}`;
    // Ends on the op id so paging (ADR-201) never skips or repeats a row.
    const orderBy = sfOrderBy(
      OSP_WIP_SF_COLUMNS,
      sf,
      sql`w.at_vendor_qty DESC, w.not_sent_qty DESC, w.jc_code ASC, w.op_seq ASC, w.jc_op_id ASC`,
    );
    const pageFrag =
      input.limit !== undefined ? sql`LIMIT ${input.limit} OFFSET ${input.offset}` : sql``;

    const result = (await tx.execute(sql`
      SELECT
        w.jc_op_id, w.job_card_id, w.jc_code, w.op_seq, w.operation, w.outsource_status,
        w.item_id, w.item_code, w.item_name, w.so_code, w.vendor_name, w.vendor_code,
        w.order_qty, w.sent_qty, w.returned_qty, w.rejected_qty,
        w.accepted_qty, w.at_vendor_qty, w.not_sent_qty, w.in_qc_qty,
        w.ready_to_send_qty,
        -- The customer's drawing revision. v_osp_wip resolves so_code through
        -- jc.source_so_line_id but does not carry the revision column, and
        -- widening the view would need a migration, so the two hops are made
        -- here instead off the job_card_id the view does expose. Both hops are
        -- LEFT JOINs: an op on a JW-sourced or standalone card must still come
        -- back, with a null revision. It is never items.revision, which
        -- describes the item master and means something else.
        --
        -- Cast to text on purpose: the contract types this as a string, and the
        -- column is only text on a database that has had migration 0119. On one
        -- that has not it is still the old integer and would arrive here as a
        -- number wearing a string type.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS item_revision,
        -- POL = the line number printed on the CUSTOMER's own purchase order,
        -- off the same SO line the revision above is read from. SO side only:
        -- a job-work line has no customer PO, so JW-sourced ops are correctly
        -- null. Never sol.line_no, which is OUR line number.
        sol.client_po_line_no AS client_po_line_no,
        so.internal_so_no AS so_internal_no
      ${fromFrag}
        ${bucketFrag}
      ORDER BY ${orderBy}
      ${pageFrag}
    `)) as unknown as WipRawRow[];

    const rows: OspWipRow[] = result.map((r) => ({
      jcOpId: r.jc_op_id,
      jobCardId: r.job_card_id,
      jcCode: r.jc_code,
      opSeq: Number(r.op_seq),
      operation: r.operation,
      outsourceStatus: r.outsource_status,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemRevision: r.item_revision,
      clientPoLineNo: r.client_po_line_no,
      itemName: r.item_name,
      soCode: r.so_code,
      soInternalNo: r.so_internal_no,
      vendorName: r.vendor_name,
      vendorCode: r.vendor_code,
      orderQty: Number(r.order_qty),
      sentQty: Number(r.sent_qty),
      returnedQty: Number(r.returned_qty),
      rejectedQty: Number(r.rejected_qty),
      acceptedQty: Number(r.accepted_qty),
      atVendorQty: Number(r.at_vendor_qty),
      notSentQty: Number(r.not_sent_qty),
      inQcQty: Number(r.in_qc_qty),
      // What may actually leave today (0110). notSentQty above is the ORDER
      // balance and over-states this whenever the shop floor has not yet
      // cleared the whole order into the op.
      readyToSendQty: Number(r.ready_to_send_qty),
    }));

    // Bucket figures for the dropdown + tile: every op matching the search and
    // Sort & Filter (NOT the bucket — picking a bucket must not change its own
    // count), summed in SQL over all rows, not over the page. `total` counts
    // the rows the page is cut from (bucket included).
    const [agg] = (await tx.execute(sql`
      SELECT
        count(*)::int AS total_ops,
        count(*) FILTER (WHERE w.at_vendor_qty > 0)::int AS ops_at_vendor,
        COALESCE(sum(w.at_vendor_qty), 0)::int AS at_vendor_qty,
        COALESCE(sum(w.not_sent_qty), 0)::int AS not_sent_qty,
        COALESCE(sum(w.sent_qty), 0)::int AS sent_qty,
        COALESCE(sum(w.ready_to_send_qty), 0)::int AS ready_to_send_qty,
        count(*) FILTER (WHERE TRUE ${bucketFrag})::int AS total
      ${fromFrag}
    `)) as unknown as Array<{
      total_ops: number;
      ops_at_vendor: number;
      at_vendor_qty: number;
      not_sent_qty: number;
      sent_qty: number;
      ready_to_send_qty: number;
      total: number;
    }>;
    const summary = {
      totalOps: Number(agg?.total_ops ?? 0),
      opsAtVendor: Number(agg?.ops_at_vendor ?? 0),
      atVendorQty: Number(agg?.at_vendor_qty ?? 0),
      notSentQty: Number(agg?.not_sent_qty ?? 0),
      sentQty: Number(agg?.sent_qty ?? 0),
      readyToSendQty: Number(agg?.ready_to_send_qty ?? 0),
    };

    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows,
      total: Number(agg?.total ?? 0),
      summary,
    };
  });
}
