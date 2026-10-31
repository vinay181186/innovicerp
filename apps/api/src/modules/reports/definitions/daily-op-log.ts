// Daily op-log report — flat list of op_log rows in a date range, with
// resolved jc code, op_seq, operation, operator name. Pattern: simple list
// with date-range filter.

import { opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { OP_LOG_QC_REMARKS } from '../../../lib/op-log-qc-remarks';
import type { RegisteredReport } from '../registry';
import { polSql } from '../../../lib/pol';
import { dateCell, REPORT_ROW_CAP, textCell } from './report-helpers';

export const dailyOpLogReport: RegisteredReport = {
  definition: {
    slug: 'daily-op-log',
    title: 'Daily op log',
    description:
      'Time-stamped completion records by JC + op + operator over a date range. Mirrors the legacy op-log audit view.',
    group: 'Production',
    dept: 'production',
    filters: [
      { key: 'fromDate', label: 'Log Date From', kind: 'date' },
      { key: 'toDate', label: 'Log Date To', kind: 'date' },
    ],
    columns: [
      // ADR-261 — the six lead columns first. SO No. is whichever order the
      // JC came from (SO line, else JWSO line); Created On is the log row's
      // own created_at (India day); the drawing rev rides in Item Code.
      { key: 'log_no', label: 'Log No.', type: 'text' },
      { key: 'log_date', label: 'Log Date', type: 'date' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'log_type', label: 'Log Type', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'operator_name', label: 'Operator', type: 'text' },
      { key: 'qty', label: 'Completed', type: 'number' },
      { key: 'reject_qty', label: 'Deviated', type: 'number' },
      { key: 'shift', label: 'Shift', type: 'text' },
      // NAMING.md: op QC remarks are "QC Remarks" — filled on QC rows only,
      // blank on a reversal row (lib/op-log-qc-remarks).
      { key: 'qc_remarks', label: 'QC Remarks', type: 'text' },
    ],
    // ADR-190 — jc_code opens the document; jc_id is not a column.
    rowLink: { column: 'jc_code', route: '/job-cards/$id', idKey: 'jc_id' },
  },
  async run({ tx, companyId, filters }) {
    const fromFrag = filters['fromDate']
      ? sql`AND ol.log_date >= ${filters['fromDate']}::date`
      : sql``;
    const toFrag = filters['toDate'] ? sql`AND ol.log_date <= ${filters['toDate']}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        jc.id AS jc_id,
        COALESCE(so.code, jwo.code) AS so_code,
        so.internal_so_no AS so_internal_no,
        ${polSql('sol', 'jwl')} AS client_po_line_no,
        (ol.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
        -- CODE/REV: the customer's drawing rev (SO line, else JW line).
        (it.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
        it.name AS item_name,
        ol.log_date,
        ol.log_no,
        ol.log_type,
        jc.code AS jc_code,
        jo.op_seq,
        jo.operation,
        ol.operator_name,
        ol.qty,
        ol.reject_qty,
        ol.shift,
        CASE WHEN ol.log_type = 'qc' THEN ${OP_LOG_QC_REMARKS} END AS qc_remarks
      FROM public.op_log ol
      JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id
      -- LEFT, never inner: work logged against a JW-sourced or standalone JC
      -- has no SO line behind it, and this is the shop-floor audit trail —
      -- every logged op has to stay visible.
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      LEFT JOIN public.items it ON it.id = jc.item_id
      WHERE ol.company_id = ${companyId}::uuid
        ${fromFrag}
        ${toFrag}
      ORDER BY ol.log_date DESC, ol.log_no DESC
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      jc_id: String(r['jc_id'] ?? ''),
      so_code: textCell(r['so_code']),
      so_internal_no: textCell(r['so_internal_no']),
      client_po_line_no: textCell(r['client_po_line_no']),
      created_on: dateCell(r['created_on']),
      item_code: String(r['item_code'] ?? ''),
      item_name: textCell(r['item_name']),
      log_date:
        r['log_date'] instanceof Date
          ? r['log_date'].toISOString().slice(0, 10)
          : String(r['log_date']),
      log_no: (r['log_no'] as string) ?? '',
      log_type: (r['log_type'] as string) ?? '',
      jc_code: (r['jc_code'] as string) ?? '',
      // display rule — see opSrNo in @innovic/shared
      op_seq: r['op_seq'] != null ? opSrNo(Number(r['op_seq'])) : 0,
      operation: (r['operation'] as string) ?? '',
      operator_name: (r['operator_name'] as string | null) ?? null,
      qty: r['qty'] != null ? Number(r['qty']) : 0,
      reject_qty: r['reject_qty'] != null ? Number(r['reject_qty']) : 0,
      shift: (r['shift'] as string) ?? '',
      qc_remarks: (r['qc_remarks'] as string | null) ?? null,
    }));

    return { columns: dailyOpLogReport.definition.columns, rows };
  },
};
