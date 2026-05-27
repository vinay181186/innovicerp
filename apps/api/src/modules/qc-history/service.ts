// QC History service (QC Wave 2) — read-only.
//
// GET /qc-history — pending QC ops + completed QC log entries + tracking stats.
// Mirrors legacy renderQCHistory (HTML L23531). Raw SQL over v_jc_op_status +
// op_log (log_type='qc'). RLS via base tables. No migration.

import { sql } from 'drizzle-orm';
import type {
  QcHistoryLogRow,
  QcHistoryPendingRow,
  QcHistoryResponse,
  QcHistoryStats,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export async function getQcHistory(user: AuthContext): Promise<QcHistoryResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // ── Pending QC ops ──
    const pendingRows = await tx.execute(sql`
      SELECT
        vos.jc_op_id AS "jcOpId", jc.id AS "jobCardId", jc.code AS "jcCode",
        vos.op_seq AS "opSeq", so.code AS "soCode", i.code AS "itemCode",
        jo.operation, jc.order_qty AS "orderQty",
        vos.completed_qty AS "completed", vos.qc_accepted_qty AS "qcAccepted",
        vos.qc_rejected_qty AS "qcRejected", vos.qc_pending AS "qcPending",
        jc.client_po_line_no AS "clientPoLineNo", jo.qc_call_date AS "qcCallDate",
        (SELECT MAX(ol.log_date) FROM public.op_log ol
          WHERE ol.jc_op_id = vos.jc_op_id AND ol.log_type = 'complete') AS "pendSince"
      FROM public.v_jc_op_status vos
      JOIN public.jc_ops jo ON jo.id = vos.jc_op_id AND jo.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = vos.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE vos.company_id = ${companyId}::uuid
        AND (vos.qc_required OR vos.op_type = 'qc')
        AND vos.qc_pending > 0
      ORDER BY jc.code, vos.op_seq
    `);
    const today = new Date().toISOString().slice(0, 10);
    const pending: QcHistoryPendingRow[] = (
      pendingRows as unknown as Array<Record<string, unknown>>
    ).map((r) => {
      const pendSince = r['pendSince'] != null ? dateLike(r['pendSince']) : null;
      return {
        jcOpId: r['jcOpId'] as string,
        jobCardId: r['jobCardId'] as string,
        jcCode: r['jcCode'] as string,
        opSeq: Number(r['opSeq']),
        soCode: (r['soCode'] as string | null) ?? null,
        itemCode: (r['itemCode'] as string | null) ?? null,
        operation: (r['operation'] as string | null) ?? '',
        orderQty: Number(r['orderQty'] ?? 0),
        completed: Number(r['completed'] ?? 0),
        qcAccepted: Number(r['qcAccepted'] ?? 0),
        qcRejected: Number(r['qcRejected'] ?? 0),
        qcPending: Number(r['qcPending'] ?? 0),
        pendSince,
        overdue: pendSince !== null && pendSince < today,
        clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
        qcCallDate: r['qcCallDate'] != null ? dateLike(r['qcCallDate']) : null,
      };
    });

    // ── Completed QC log entries (last 500) ──
    const logRows = await tx.execute(sql`
      SELECT
        ol.id AS "logId", jc.code AS "jcCode", jo.op_seq AS "opSeq",
        so.code AS "soCode", i.code AS "itemCode", jo.operation,
        ol.qty AS "accepted", ol.reject_qty AS "rejected",
        ol.log_date AS "logDate", ol.shift, ol.operator_name AS "inspector", ol.remarks,
        ol.log_no AS "logNo", jo.qc_call_date AS "qcCallDate"
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id AND jo.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE ol.company_id = ${companyId}::uuid
        AND ol.log_type = 'qc'
      ORDER BY ol.log_date DESC, ol.id DESC
      LIMIT 500
    `);
    const logs: QcHistoryLogRow[] = (logRows as unknown as Array<Record<string, unknown>>).map(
      (r) => ({
        logId: r['logId'] as string,
        jcCode: r['jcCode'] as string,
        opSeq: Number(r['opSeq']),
        soCode: (r['soCode'] as string | null) ?? null,
        itemCode: (r['itemCode'] as string | null) ?? null,
        operation: (r['operation'] as string | null) ?? '',
        accepted: Number(r['accepted'] ?? 0),
        rejected: Number(r['rejected'] ?? 0),
        logDate: dateLike(r['logDate']),
        shift: (r['shift'] as string | null) ?? null,
        inspector: (r['inspector'] as string | null) ?? null,
        remarks: (r['remarks'] as string | null) ?? null,
        logNo: (r['logNo'] as string | null) ?? '',
        qcCallDate: r['qcCallDate'] != null ? dateLike(r['qcCallDate']) : null,
      }),
    );

    // ── Stats ──
    const statRows = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS "totalEntries",
        COUNT(*) FILTER (WHERE log_date = CURRENT_DATE)::int AS "today"
      FROM public.op_log
      WHERE company_id = ${companyId}::uuid AND log_type = 'qc'
    `);
    const s = (statRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const stats: QcHistoryStats = {
      pendingOps: pending.length,
      overdue: pending.filter((p) => p.overdue).length,
      totalEntries: Number(s['totalEntries'] ?? 0),
      today: Number(s['today'] ?? 0),
    };

    return { stats, pending, logs };
  });
}
