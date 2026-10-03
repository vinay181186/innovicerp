// QC History — the shared SQL pieces of the pending-ops and QC-log feeds
// (ADR-201): FROM + base WHERE, the SELECT lists, the search clause and the
// row mappers. One copy serves the paged lists, their counts, the QC Call
// Register and the old whole-feed GET /qc-history, so a row reads the same
// everywhere and a page's total is counted over the very rows it pages.

import { type SQL, sql } from 'drizzle-orm';
import type { QcHistoryLogRow, QcHistoryPendingRow } from '@innovic/shared';
import { likeEscape } from '../../lib/list-query';

export function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Last 'complete' log date of the op — the Pending Since column. */
export const PEND_SINCE = sql`(SELECT MAX(ol.log_date) FROM public.op_log ol
  WHERE ol.jc_op_id = vos.jc_op_id AND ol.log_type = 'complete')`;

// Terminal QC gate (ADR-069): the op is the job card's LAST live op. Same
// criterion as op-entry/qc-stock-cascade.ts tryApplyQcStockCascade.
export const PEND_IS_LAST = sql`(vos.op_seq = (SELECT MAX(lo.op_seq) FROM public.jc_ops lo
  WHERE lo.job_card_id = jc.id AND lo.deleted_at IS NULL))`;
export const LOG_IS_LAST = sql`(jo.op_seq = (SELECT MAX(lo.op_seq) FROM public.jc_ops lo
  WHERE lo.job_card_id = jc.id AND lo.deleted_at IS NULL))`;

/** CODE/REV exactly as the Item Code cell prints it (itemCodeWithRev). */
export const ITEM_CODE_REV = sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`;

/** Pending QC ops: FROM … WHERE (company + qc op + something waiting). */
export function pendingFrom(companyId: string): SQL {
  return sql`
    FROM public.v_jc_op_status vos
    JOIN public.jc_ops jo ON jo.id = vos.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = vos.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = jc.item_id
    LEFT JOIN public.sales_order_lines sol
      ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines rev_jwl
      ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    LEFT JOIN public.sales_orders so
      ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    -- QC Command's active assignment (one per op, unique partial index).
    LEFT JOIN public.qc_assignments qa
      ON qa.jc_op_id = vos.jc_op_id AND qa.company_id = vos.company_id
     AND qa.deleted_at IS NULL
    WHERE vos.company_id = ${companyId}::uuid
      AND (vos.qc_required OR vos.op_type = 'qc')
      AND vos.qc_pending > 0`;
}

// The customer's drawing revision is read live off the SO line the card was
// raised against (never items.revision), cast to text so a pre-0119 database
// cannot hand the UI a number. POL is the CUSTOMER's PO line (never our line).
export const PENDING_SELECT = sql`
  vos.jc_op_id AS "jcOpId", jc.id AS "jobCardId", jc.code AS "jcCode",
  vos.op_seq AS "opSeq", so.code AS "soCode", so.internal_so_no AS "soInternalNo",
  i.code AS "itemCode",
  COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
  i.name AS "itemName", ${PEND_IS_LAST} AS "isLastOp",
  jo.operation, jc.order_qty AS "orderQty",
  vos.completed_qty AS "completed", vos.qc_accepted_qty AS "qcAccepted",
  vos.qc_rejected_qty AS "qcRejected", vos.qc_pending AS "qcPending",
  sol.client_po_line_no AS "clientPoLineNo", jo.qc_call_date AS "qcCallDate",
  ${PEND_SINCE} AS "pendSince", qa.inspector_name AS "assignedTo"`;

/** Paging order: latest QC call first, then card + op, then the op id. */
export const PENDING_ORDER = sql`jo.qc_call_date DESC NULLS LAST, jc.code, vos.op_seq, vos.jc_op_id`;

/** Completed QC log entries: FROM … WHERE (company + QC logs). */
export function logsFrom(companyId: string): SQL {
  return sql`
    FROM public.op_log ol
    JOIN public.jc_ops jo ON jo.id = ol.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = jc.item_id
    LEFT JOIN public.sales_order_lines sol
      ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines rev_jwl
      ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    LEFT JOIN public.sales_orders so
      ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    WHERE ol.company_id = ${companyId}::uuid
      AND ol.log_type = 'qc'`;
}

export const LOGS_SELECT = sql`
  ol.id AS "logId", jc.id AS "jobCardId", jc.code AS "jcCode", jo.op_seq AS "opSeq",
  so.code AS "soCode", so.internal_so_no AS "soInternalNo", i.code AS "itemCode",
  COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
  sol.client_po_line_no AS "clientPoLineNo", i.name AS "itemName",
  ${LOG_IS_LAST} AS "isLastOp", jo.operation,
  ol.qty AS "accepted", ol.reject_qty AS "rejected",
  ol.log_date AS "logDate", ol.created_at AS "loggedAt", ol.shift,
  ol.operator_name AS "inspector", ol.remarks,
  ol.log_no AS "logNo", jo.qc_call_date AS "qcCallDate",
  ol.qc_report_path AS "qcReportPath", ol.qc_report_name AS "qcReportName"`;

export const LOGS_ORDER = sql`ol.log_date DESC, ol.id DESC`;

/**
 * `AND (… ILIKE …)` over every text the row shows: JC, SO, POL, item code,
 * drawing revision, item name, operation. Empty term → empty fragment.
 */
export function opSearchWhere(term: string | undefined): SQL {
  const q = (term ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return sql``;
  const p = `%${likeEscape(q)}%`;
  const cols = [
    sql`jc.code`,
    sql`so.code`,
    // ADR-207: the SO's Internal SO No. finds its rows too.
    sql`so.internal_so_no`,
    sql`sol.client_po_line_no`,
    sql`i.code`,
    sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`,
    sql`${ITEM_CODE_REV}`,
    sql`i.name`,
    sql`jo.operation`,
  ];
  return sql`AND (${sql.join(
    cols.map((c) => sql`${c} ILIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v as string | null) ?? null;

export function toPendingRow(r: Raw, today: string): QcHistoryPendingRow {
  const pendSince = r['pendSince'] != null ? dateLike(r['pendSince']) : null;
  return {
    jcOpId: r['jcOpId'] as string,
    jobCardId: r['jobCardId'] as string,
    jcCode: r['jcCode'] as string,
    opSeq: Number(r['opSeq']),
    soCode: s(r['soCode']),
    soInternalNo: s(r['soInternalNo']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    itemName: s(r['itemName']),
    isLastOp: Boolean(r['isLastOp']),
    operation: s(r['operation']) ?? '',
    orderQty: Number(r['orderQty'] ?? 0),
    completed: Number(r['completed'] ?? 0),
    qcAccepted: Number(r['qcAccepted'] ?? 0),
    qcRejected: Number(r['qcRejected'] ?? 0),
    qcPending: Number(r['qcPending'] ?? 0),
    pendSince,
    overdue: pendSince !== null && pendSince < today,
    clientPoLineNo: s(r['clientPoLineNo']),
    qcCallDate: r['qcCallDate'] != null ? dateLike(r['qcCallDate']) : null,
    assignedTo: s(r['assignedTo']),
  };
}

export function toLogRow(r: Raw): QcHistoryLogRow {
  return {
    logId: r['logId'] as string,
    jobCardId: s(r['jobCardId']),
    jcCode: r['jcCode'] as string,
    opSeq: Number(r['opSeq']),
    soCode: s(r['soCode']),
    soInternalNo: s(r['soInternalNo']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    clientPoLineNo: s(r['clientPoLineNo']),
    itemName: s(r['itemName']),
    isLastOp: Boolean(r['isLastOp']),
    operation: s(r['operation']) ?? '',
    accepted: Number(r['accepted'] ?? 0),
    rejected: Number(r['rejected'] ?? 0),
    logDate: dateLike(r['logDate']),
    loggedAt: r['loggedAt'] != null ? String(r['loggedAt']) : dateLike(r['logDate']),
    shift: s(r['shift']),
    inspector: s(r['inspector']),
    remarks: s(r['remarks']),
    logNo: s(r['logNo']) ?? '',
    qcCallDate: r['qcCallDate'] != null ? dateLike(r['qcCallDate']) : null,
    qcReportPath: s(r['qcReportPath']),
    qcReportName: s(r['qcReportName']),
  };
}

/** Today as the overdue test has always read it (UTC calendar date). */
export function overdueToday(): string {
  return new Date().toISOString().slice(0, 10);
}
