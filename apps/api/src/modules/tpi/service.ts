// TPI service (QC Wave 3) — read-only.
//
// GET /tpi — pending TPI ops (QC ops with "TPI" in the operation name +
// qc_pending>0) + completed TPI records (op_log where is_tpi). Mirrors legacy
// renderTPI (HTML L21381). The TPI submit reuses op-entry submitQcLog (isTpi +
// tpi metadata). RLS via base tables. No migration here (0037 added the cols).

import { sql } from 'drizzle-orm';
import type { TpiCompletedRow, TpiPendingRow, TpiResponse } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export async function getTpi(user: AuthContext): Promise<TpiResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // ── Pending TPI ops ──
    const pendingRows = await tx.execute(sql`
      SELECT
        vos.jc_op_id AS "jcOpId", jc.code AS "jcCode", vos.op_seq AS "opSeq",
        so.code AS "soCode", i.code AS "itemCode", jo.operation,
        jc.order_qty AS "orderQty", vos.qc_pending AS "qcPending",
        jo.qc_call_date AS "callDate",
        GREATEST(0, (CURRENT_DATE - COALESCE(jo.qc_call_date, jc.jc_date)))::int AS "waitDays"
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
        AND UPPER(jo.operation) LIKE '%TPI%'
      ORDER BY jc.code, vos.op_seq
    `);
    const pending: TpiPendingRow[] = (
      pendingRows as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      jcOpId: r['jcOpId'] as string,
      jcCode: r['jcCode'] as string,
      opSeq: Number(r['opSeq']),
      soCode: (r['soCode'] as string | null) ?? null,
      itemCode: (r['itemCode'] as string | null) ?? null,
      operation: (r['operation'] as string | null) ?? '',
      orderQty: Number(r['orderQty'] ?? 0),
      qcPending: Number(r['qcPending'] ?? 0),
      callDate: dateLike(r['callDate']),
      waitDays: Number(r['waitDays'] ?? 0),
    }));

    // ── Completed TPI records (op_log where is_tpi) ──
    const compRows = await tx.execute(sql`
      SELECT
        ol.id AS "logId", jc.code AS "jcCode", jo.op_seq AS "opSeq",
        so.code AS "soCode", i.code AS "itemCode", jo.operation,
        ol.qty AS "accepted", ol.reject_qty AS "rejected",
        jo.qc_call_date AS "callDate", ol.log_date AS "attendedDate",
        CASE WHEN jo.qc_call_date IS NOT NULL THEN (ol.log_date - jo.qc_call_date)::int ELSE NULL END AS "respDays",
        ol.tpi_inspector AS "inspector", ol.tpi_organization AS "organization",
        ol.tpi_cert_no AS "certNo",
        ol.qc_report_path AS "qcReportPath", ol.qc_report_name AS "qcReportName"
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id AND jo.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE ol.company_id = ${companyId}::uuid
        AND ol.is_tpi = true
      ORDER BY ol.log_date DESC, ol.id DESC
      LIMIT 200
    `);
    const completed: TpiCompletedRow[] = (
      compRows as unknown as Array<Record<string, unknown>>
    ).map((r) => ({
      logId: r['logId'] as string,
      jcCode: r['jcCode'] as string,
      opSeq: Number(r['opSeq']),
      soCode: (r['soCode'] as string | null) ?? null,
      itemCode: (r['itemCode'] as string | null) ?? null,
      operation: (r['operation'] as string | null) ?? '',
      accepted: Number(r['accepted'] ?? 0),
      rejected: Number(r['rejected'] ?? 0),
      callDate: dateLike(r['callDate']),
      attendedDate: dateLike(r['attendedDate']) ?? '',
      respDays: r['respDays'] != null ? Number(r['respDays']) : null,
      inspector: (r['inspector'] as string | null) ?? null,
      organization: (r['organization'] as string | null) ?? null,
      certNo: (r['certNo'] as string | null) ?? null,
      qcReportPath: (r['qcReportPath'] as string | null) ?? null,
      qcReportName: (r['qcReportName'] as string | null) ?? null,
    }));

    return { pending, completed };
  });
}
