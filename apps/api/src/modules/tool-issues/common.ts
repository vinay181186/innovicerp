// Tool Issue — the read model every path shares (ADR-193 phase 4b).
//
// Nothing about a return is stored on the issue except return_status: the
// totals are derived from tool_issue_returns and tool_writeoffs, so a write-off
// decision can never leave a running total out of step.
//
//   Good        = returned good + rejected Damaged (a rejected Damaged goes back
//                 into stock as Good)
//   Damaged     = Damaged write-offs pending or approved
//   Lost        = Lost write-offs pending or approved (a rejected Lost is still
//                 out with the holder)
//   Consumed    = returned consumed (normal wear, no approval)
//   Still Out (stillOutQty) = Qty − Good − Consumed − Damaged − Lost
//   A cancelled issue holds nothing.

import type { ToolIssueListItem, ToolReturnStatus } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { toolIssues } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import { roundQty } from '../../lib/stock-ledger';
import { dateOut, todayIst, tsOut } from '../instruments/common';

export { requireCompany, todayIst } from '../instruments/common';

export const ISSUE_SELECT = sql`
  SELECT ti.id, ti.code, ti.issue_date, ti.expected_return_date, ti.item_id,
         COALESCE(i.code, ti.item_code_text) AS item_code,
         COALESCE(i.name, ti.item_name) AS item_name, i.uom::text AS uom,
         ti.qty, ti.issued_to_operator_id, ti.issued_to, ti.job_card_id, jc.code AS job_card_code,
         ti.purpose, ti.remarks, ti.return_status, ti.cancelled_at, ti.cancel_reason,
         ti.created_at, ti.created_by, u.full_name AS issued_by_name,
         s.serial_nos, s.out_serial_nos,
         COALESCE(r.good, 0) + COALESCE(w.dmg_rejected, 0) AS good_qty,
         COALESCE(w.dmg, 0) AS damaged_qty,
         COALESCE(w.lost, 0) AS lost_qty,
         COALESCE(r.consumed, 0) AS consumed_qty,
         COALESCE(w.pending, 0) AS writeoff_pending_qty,
         CASE WHEN ti.return_status = 'cancelled' THEN 0
              ELSE ti.qty - COALESCE(r.good, 0) - COALESCE(w.dmg_rejected, 0)
                   - COALESCE(r.consumed, 0) - COALESCE(w.dmg, 0) - COALESCE(w.lost, 0)
         END AS still_out_qty
  FROM public.tool_issues ti
  LEFT JOIN public.items i ON i.id = ti.item_id
  LEFT JOIN public.job_cards jc ON jc.id = ti.job_card_id
  LEFT JOIN public.users u ON u.id = ti.created_by
  LEFT JOIN LATERAL (
    SELECT SUM(tr.good_qty) AS good, SUM(tr.consumed_qty) AS consumed
    FROM public.tool_issue_returns tr
    WHERE tr.tool_issue_id = ti.id AND tr.deleted_at IS NULL
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT SUM(w1.qty) FILTER (WHERE w1.kind = 'damaged' AND w1.status <> 'rejected') AS dmg,
           SUM(w1.qty) FILTER (WHERE w1.kind = 'lost' AND w1.status <> 'rejected') AS lost,
           SUM(w1.qty) FILTER (WHERE w1.kind = 'damaged' AND w1.status = 'rejected') AS dmg_rejected,
           SUM(w1.qty) FILTER (WHERE w1.kind IN ('damaged', 'lost') AND w1.status = 'pending') AS pending
    FROM public.tool_writeoffs w1
    WHERE w1.tool_issue_id = ti.id AND w1.deleted_at IS NULL
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(ins.serial_no, ', ' ORDER BY lower(ins.serial_no)) AS serial_nos,
           string_agg(ins.serial_no, ', ' ORDER BY lower(ins.serial_no))
             FILTER (WHERE l.returned_on IS NULL) AS out_serial_nos
    FROM public.tool_issue_instruments l
    JOIN public.instruments ins ON ins.id = l.instrument_id
    WHERE l.tool_issue_id = ti.id AND l.deleted_at IS NULL
  ) s ON true`;

const q = (v: unknown): number => roundQty(Number(v ?? 0));

export function toListItem(r: Record<string, unknown>, today = todayIst()): ToolIssueListItem {
  const status = r['return_status'] as ToolReturnStatus;
  const expected = dateOut(r['expected_return_date']);
  const stillOut = q(r['still_out_qty']);
  return {
    id: String(r['id']),
    code: String(r['code']),
    issueDate: dateOut(r['issue_date']) ?? '',
    expectedReturnDate: expected,
    itemId: (r['item_id'] as string | null) ?? null,
    itemCode: (r['item_code'] as string | null) ?? null,
    itemName: (r['item_name'] as string | null) ?? null,
    uom: (r['uom'] as string | null) ?? null,
    qty: q(r['qty']),
    serialNos: (r['serial_nos'] as string | null) ?? null,
    operatorId: (r['issued_to_operator_id'] as string | null) ?? null,
    issuedTo: String(r['issued_to'] ?? ''),
    jobCardId: (r['job_card_id'] as string | null) ?? null,
    jobCardCode: (r['job_card_code'] as string | null) ?? null,
    purpose: (r['purpose'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    returnStatus: status,
    goodQty: q(r['good_qty']),
    damagedQty: q(r['damaged_qty']),
    lostQty: q(r['lost_qty']),
    consumedQty: q(r['consumed_qty']),
    writeoffPendingQty: q(r['writeoff_pending_qty']),
    stillOutQty: stillOut,
    isOverdue: status !== 'cancelled' && stillOut > 0 && expected !== null && expected < today,
    cancelledAt: r['cancelled_at'] != null ? tsOut(r['cancelled_at']) : null,
    cancelReason: (r['cancel_reason'] as string | null) ?? null,
    issuedByName: (r['issued_by_name'] as string | null) ?? null,
    createdAt: tsOut(r['created_at']),
  };
}

/** One issue with its derived totals (inside the caller's transaction). */
export async function readIssue(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<ToolIssueListItem> {
  const rows = (await tx.execute(sql`
    ${ISSUE_SELECT}
    WHERE ti.id = ${id}::uuid AND ti.company_id = ${companyId}::uuid AND ti.deleted_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) throw new NotFoundError('Tool Issue not found. Refresh the page.');
  return toListItem(rows[0]);
}

/** Lock the issue header FOR UPDATE (every return / cancel / decision). */
export async function lockIssue(tx: DbTransaction, companyId: string, id: string) {
  const rows = (await tx.execute(sql`
    SELECT id, code, issue_date, item_id, item_code_text, qty, issued_to, return_status
    FROM public.tool_issues
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new NotFoundError('Tool Issue not found. Refresh the page.');
  return {
    id: String(r['id']),
    code: String(r['code']),
    issueDate: dateOut(r['issue_date']) ?? '',
    itemId: (r['item_id'] as string | null) ?? null,
    itemCodeText: (r['item_code_text'] as string | null) ?? null,
    qty: q(r['qty']),
    issuedTo: String(r['issued_to'] ?? ''),
    returnStatus: r['return_status'] as ToolReturnStatus,
  };
}

/** returned = nothing out and nothing waiting; issued = nothing accounted yet. */
export async function refreshReturnStatus(
  tx: DbTransaction,
  companyId: string,
  id: string,
  userId: string,
): Promise<ToolIssueListItem> {
  const t = await readIssue(tx, companyId, id);
  if (t.returnStatus === 'cancelled') return t;
  const accounted = roundQty(t.goodQty + t.consumedQty + t.damagedQty + t.lostQty);
  const next: ToolReturnStatus =
    t.stillOutQty <= 0 && t.writeoffPendingQty <= 0
      ? 'returned'
      : accounted <= 0
        ? 'issued'
        : 'partial';
  if (next !== t.returnStatus) {
    await tx
      .update(toolIssues)
      .set({ returnStatus: next, updatedAt: new Date(), updatedBy: userId })
      .where(eq(toolIssues.id, id));
    return { ...t, returnStatus: next };
  }
  return t;
}
