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
        w.accepted_qty, w.at_vendor_qty, w.not_sent_qty
      FROM public.v_osp_wip w
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
    }));

    // Summary always reflects ALL outsource ops (tiles are whole-register
    // counts; clicking a tile sets the filter — mirrors store-inventory).
    const summary = {
      totalOps: rows.length,
      opsAtVendor: rows.filter((r) => r.atVendorQty > 0).length,
      atVendorQty: rows.reduce((s, r) => s + r.atVendorQty, 0),
      notSentQty: rows.reduce((s, r) => s + r.notSentQty, 0),
      sentQty: rows.reduce((s, r) => s + r.sentQty, 0),
    };

    const filteredRows =
      input.filter === 'at_vendor'
        ? rows.filter((r) => r.atVendorQty > 0)
        : input.filter === 'not_sent'
          ? rows.filter((r) => r.notSentQty > 0)
          : rows;

    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows: filteredRows,
      summary,
    };
  });
}
