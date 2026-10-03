// QC Call Register — the incoming-material (GRN line) half of the register
// (ADR-201). The register pages incoming + process calls TOGETHER on the
// server, so it needs the GRN-line rows in the same SQL as the job-card ops.
// These SELECTs mirror incoming-qc/service.ts getIncomingQc (pending lines and
// the inspected-lines feed) column for column — same joins, same row shapes —
// so a row reads the same on Incoming QC and here.

import { type SQL, sql } from 'drizzle-orm';
import type { IncomingQcCompletedRow, IncomingQcPendingRow } from '@innovic/shared';
import { likeEscape } from '../../lib/list-query';

/** Pending qty of a GRN line (received − accepted − rejected). */
export const INC_PENDING_QTY = sql`(l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty)`;

// SO trace for OSP returns: PO line → jc_op → JC → SO line → SO (null for
// raw-material GRNs). The drawing revision is the SO line's, never items.revision.
function incJoins(): SQL {
  return sql`
    FROM public.goods_receipt_note_lines l
    JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
    LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
    LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
    LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines rev_jwl ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = l.item_id`;
}

/** GRN lines received but not fully inspected. */
export function incPendingFrom(companyId: string): SQL {
  return sql`${incJoins()}
    WHERE l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
      AND ${INC_PENDING_QTY} > 0`;
}

/** GRN lines with any QC activity (incl. partially inspected ones). */
export function incCompletedFrom(companyId: string): SQL {
  return sql`${incJoins()}
    LEFT JOIN public.users u ON u.id = l.qc_inspected_by
    WHERE l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
      AND (l.qc_accepted_qty > 0 OR l.qc_rejected_qty > 0)`;
}

const ITEM_CODE = sql`COALESCE(i.code, l.item_code_text)`;
const ITEM_REV = sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`;
const VENDOR = sql`COALESCE(v.name, h.vendor_code_text)`;

export const INC_PENDING_SELECT = sql`
  l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
  h.po_code_text AS "poCode", ${VENDOR} AS "vendorName", so.code AS "soCode",
  so.internal_so_no AS "soInternalNo",
  jc.code AS "jcCode", jco.op_seq AS "opSeq", jco.operation AS "opName",
  ${ITEM_CODE} AS "itemCode", ${ITEM_REV} AS "itemRevision",
  sol.client_po_line_no AS "clientPoLineNo", COALESCE(i.name, l.item_name) AS "itemName",
  l.received_qty AS "receivedQty", ${INC_PENDING_QTY} AS "pendingQty",
  GREATEST(0, (CURRENT_DATE - h.grn_date))::int AS "waitDays"`;

export const INC_COMPLETED_SELECT = sql`
  l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
  l.qc_date AS "qcDate",
  CASE WHEN l.qc_date IS NOT NULL THEN (l.qc_date - h.grn_date)::int ELSE NULL END AS "respDays",
  ${VENDOR} AS "vendorName", ${ITEM_CODE} AS "itemCode", ${ITEM_REV} AS "itemRevision",
  sol.client_po_line_no AS "clientPoLineNo", COALESCE(i.name, l.item_name) AS "itemName",
  l.received_qty AS "receivedQty",
  l.qc_accepted_qty AS "acceptedQty", l.qc_rejected_qty AS "rejectedQty",
  l.qc_remarks AS "qcRemarks", l.updated_at AS "qcAt",
  COALESCE(l.qc_inspected_by_text, u.full_name, u.email) AS "qcInspectedBy",
  l.qc_report_path AS "qcReportPath", l.qc_report_name AS "qcReportName"`;

/** When the line was inspected — the completed register's newest-first key. */
export const INC_DONE_AT = sql`COALESCE(l.updated_at, l.qc_date::timestamptz, h.grn_date::timestamptz)`;

/** `AND (… ILIKE …)` over the texts an incoming row shows. */
export function incSearchWhere(term: string | undefined, pending: boolean): SQL {
  const q = (term ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return sql``;
  const p = `%${likeEscape(q)}%`;
  const cols = [
    sql`h.code`,
    sql`sol.client_po_line_no`,
    ITEM_CODE,
    ITEM_REV,
    sql`COALESCE(i.name, l.item_name)`,
    VENDOR,
    ...(pending ? [sql`h.po_code_text`] : []),
  ];
  return sql`AND (${sql.join(
    cols.map((c) => sql`${c} ILIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v as string | null) ?? null;

export function toIncPendingRow(r: Raw): IncomingQcPendingRow {
  return {
    grnLineId: r['grnLineId'] as string,
    grnId: r['grnId'] as string,
    grnNo: r['grnNo'] as string,
    grnDate: String(r['grnDate']).slice(0, 10),
    poCode: s(r['poCode']),
    vendorName: s(r['vendorName']),
    soCode: s(r['soCode']),
    soInternalNo: s(r['soInternalNo']),
    jcCode: s(r['jcCode']),
    opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
    opName: s(r['opName']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    clientPoLineNo: s(r['clientPoLineNo']),
    itemName: s(r['itemName']),
    receivedQty: Number(r['receivedQty'] ?? 0),
    pendingQty: Number(r['pendingQty'] ?? 0),
    waitDays: Number(r['waitDays'] ?? 0),
  };
}

function dispositionOf(
  accepted: number,
  rejected: number,
  received: number,
): IncomingQcCompletedRow['disposition'] {
  if (received - accepted - rejected > 0) return 'Partial Accept';
  if (accepted > 0 && rejected > 0) return 'Partial Accept';
  if (rejected > 0) return 'Rejected';
  return 'Accepted';
}

export function toIncCompletedRow(r: Raw): IncomingQcCompletedRow {
  const acceptedQty = Number(r['acceptedQty'] ?? 0);
  const rejectedQty = Number(r['rejectedQty'] ?? 0);
  const receivedQty = Number(r['receivedQty'] ?? 0);
  return {
    grnLineId: r['grnLineId'] as string,
    grnId: r['grnId'] as string,
    grnNo: r['grnNo'] as string,
    grnDate: String(r['grnDate']).slice(0, 10),
    qcDate: r['qcDate'] != null ? String(r['qcDate']).slice(0, 10) : null,
    respDays: r['respDays'] != null ? Number(r['respDays']) : null,
    vendorName: s(r['vendorName']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    clientPoLineNo: s(r['clientPoLineNo']),
    itemName: s(r['itemName']),
    receivedQty,
    acceptedQty,
    rejectedQty,
    disposition: dispositionOf(acceptedQty, rejectedQty, receivedQty),
    qcAt: r['qcAt'] != null ? String(r['qcAt']) : null,
    qcInspectedBy: s(r['qcInspectedBy']),
    qcRemarks: s(r['qcRemarks']),
    qcReportPath: s(r['qcReportPath']),
    qcReportName: s(r['qcReportName']),
  };
}
