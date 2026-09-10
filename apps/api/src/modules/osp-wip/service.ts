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
  item_name: string | null;
  so_code: string | null;
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
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (w.jc_code ILIKE ${term} OR w.item_code ILIKE ${term} OR w.item_name ILIKE ${term} OR w.so_code ILIKE ${term} OR w.vendor_name ILIKE ${term})`
      : sql``;

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
        sol.revision::text AS item_revision
      FROM public.v_osp_wip w
      LEFT JOIN public.job_cards jc ON jc.id = w.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      WHERE w.company_id = ${companyId}::uuid
        ${searchFrag}
      ORDER BY w.at_vendor_qty DESC, w.not_sent_qty DESC, w.jc_code ASC, w.op_seq ASC
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
      itemName: r.item_name,
      soCode: r.so_code,
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

    // Summary always reflects ALL outsource ops (tiles are whole-register
    // counts; clicking a tile sets the filter — mirrors store-inventory).
    const summary = {
      totalOps: rows.length,
      opsAtVendor: rows.filter((r) => r.atVendorQty > 0).length,
      atVendorQty: rows.reduce((s, r) => s + r.atVendorQty, 0),
      notSentQty: rows.reduce((s, r) => s + r.notSentQty, 0),
      sentQty: rows.reduce((s, r) => s + r.sentQty, 0),
      readyToSendQty: rows.reduce((s, r) => s + r.readyToSendQty, 0),
    };

    const filteredRows =
      input.filter === 'at_vendor'
        ? rows.filter((r) => r.atVendorQty > 0)
        : input.filter === 'not_sent'
          ? rows.filter((r) => r.notSentQty > 0)
          : input.filter === 'ready_to_send'
            ? rows.filter((r) => r.readyToSendQty > 0)
            : rows;

    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows: filteredRows,
      summary,
    };
  });
}
