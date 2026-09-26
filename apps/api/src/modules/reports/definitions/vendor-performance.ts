// Vendor performance scorecard — per vendor, over POs dated in a range: how
// many lines were received, how many on time (the GRN that completes the line
// qty on or before the Due Date), average lateness, and Incoming QC reject
// rates split between bought material and OSP work. Modelled on ERPNext's "Supplier Scorecard".

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { isoDateFilter } from './report-helpers';

export const vendorPerformanceReport: RegisteredReport = {
  definition: {
    slug: 'vendor-performance',
    title: 'Vendor performance scorecard',
    description:
      'Per vendor, for POs dated in the range (default: last 180 days; draft and cancelled POs left out): lines received, On-Time % (judged on the GRN that completes the line; an incomplete line past its Due Date counts late), Avg Days Late, and Incoming QC reject % for material POs and for OSP (job-work / service) POs.',
    group: 'Purchase',
    dept: 'purchase',
    filters: [
      { key: 'fromDate', label: 'PO Date From', kind: 'date' },
      { key: 'toDate', label: 'PO Date To', kind: 'date' },
    ],
    columns: [
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'po_count', label: 'POs', type: 'number' },
      { key: 'line_count', label: 'PO Lines', type: 'number' },
      { key: 'lines_received', label: 'Lines Received', type: 'number' },
      { key: 'on_time_lines', label: 'On-Time Lines', type: 'number' },
      { key: 'on_time_pct', label: 'On-Time %', type: 'number' },
      { key: 'avg_days_late', label: 'Avg Days Late', type: 'number' },
      { key: 'inspected_qty', label: 'Inspected', type: 'number' },
      { key: 'rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'reject_pct', label: 'Reject %', type: 'number' },
      { key: 'osp_returned_qty', label: 'OSP Returned', type: 'number' },
      { key: 'osp_rejected_qty', label: 'OSP Rejected', type: 'number' },
      { key: 'osp_reject_pct', label: 'OSP Reject %', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);

    const fromFrag = fromDate
      ? sql`AND po.po_date >= ${fromDate}::date`
      : sql`AND po.po_date >= CURRENT_DATE - 180`;
    const toFrag = toDate ? sql`AND po.po_date <= ${toDate}::date` : sql``;

    // OSP = the PO types that send our material out (packages/shared
    // poSendsMaterialOut: job_work, service). Their returns come back through
    // the DC receipt's auto-GRN (ADR-182) and are inspected at Incoming QC
    // (ADR-189), so both lanes read goods_receipt_note_lines.
    //
    // On-time is judged on the GRN that COMPLETES the line (first GRN date at
    // which cumulative received >= line qty). A line not yet complete is late
    // once its Due Date has passed (measured to today, or to the short-close
    // date if the PO was stopped); not complete and not yet due → not judged.
    const result = await tx.execute(sql`
      WITH lines AS (
        SELECT
          po.id                                          AS po_id,
          COALESCE(v.id::text, po.vendor_code_text, '—') AS vendor_key,
          COALESCE(v.name, po.vendor_code_text, '—')     AS vendor_name,
          (po.po_type IN ('job_work', 'service'))        AS is_osp,
          COALESCE(pol.due_date, po.due_date)            AS due_date,
          g.first_grn_date,
          gc.complete_date,
          COALESCE((po.short_closed_at AT TIME ZONE 'Asia/Kolkata')::date, CURRENT_DATE)
                                                         AS open_until,
          COALESCE(g.received, 0)                        AS received,
          COALESCE(g.accepted, 0)                        AS accepted,
          COALESCE(g.rejected, 0)                        AS rejected
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po
          ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
        LEFT JOIN public.vendors v ON v.id = po.vendor_id AND v.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT MIN(grn.grn_date)         AS first_grn_date,
                 SUM(grl.received_qty)     AS received,
                 SUM(grl.qc_accepted_qty)  AS accepted,
                 SUM(grl.qc_rejected_qty)  AS rejected
          FROM public.goods_receipt_note_lines grl
          JOIN public.goods_receipt_notes grn
            ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
          WHERE grl.purchase_order_line_id = pol.id
            AND grl.deleted_at IS NULL
        ) g ON TRUE
        LEFT JOIN LATERAL (
          SELECT MIN(c.grn_date) AS complete_date
          FROM (
            SELECT grn.grn_date,
                   SUM(grl.received_qty) OVER (
                     ORDER BY grn.grn_date, grn.code, grl.line_no
                     ROWS UNBOUNDED PRECEDING
                   ) AS cum_received
            FROM public.goods_receipt_note_lines grl
            JOIN public.goods_receipt_notes grn
              ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
            WHERE grl.purchase_order_line_id = pol.id
              AND grl.deleted_at IS NULL
          ) c
          WHERE c.cum_received >= pol.qty
        ) gc ON TRUE
        WHERE pol.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL
          AND po.status NOT IN ('draft', 'cancelled')
          ${fromFrag}
          ${toFrag}
      ), judged AS (
        SELECT
          l.po_id, l.vendor_key, l.vendor_name, l.is_osp, l.first_grn_date,
          l.received, l.accepted, l.rejected,
          CASE
            WHEN l.due_date IS NULL THEN NULL
            WHEN l.complete_date IS NOT NULL THEN l.complete_date - l.due_date
            WHEN l.open_until > l.due_date THEN l.open_until - l.due_date
            ELSE NULL
          END AS days_late
        FROM lines l
      ), per_vendor AS (
        SELECT
          vendor_name,
          COUNT(DISTINCT po_id)::int                                         AS po_count,
          COUNT(*)::int                                                      AS line_count,
          COUNT(*) FILTER (WHERE first_grn_date IS NOT NULL)::int            AS lines_received,
          COUNT(*) FILTER (WHERE days_late IS NOT NULL)::int                 AS lines_judged,
          COUNT(*) FILTER (WHERE days_late <= 0)::int                        AS on_time_lines,
          AVG(days_late) FILTER (WHERE days_late > 0)                        AS avg_days_late,
          SUM(accepted + rejected) FILTER (WHERE NOT is_osp)::int            AS inspected_qty,
          SUM(rejected) FILTER (WHERE NOT is_osp)::int                       AS rejected_qty,
          SUM(received) FILTER (WHERE is_osp)::int                           AS osp_returned_qty,
          SUM(rejected) FILTER (WHERE is_osp)::int                           AS osp_rejected_qty,
          SUM(accepted + rejected) FILTER (WHERE is_osp)::int                AS osp_inspected_qty
        FROM judged
        GROUP BY vendor_key, vendor_name
      )
      SELECT
        vendor_name, po_count, line_count, lines_received, on_time_lines,
        CASE WHEN lines_judged > 0
             THEN ROUND(100.0 * on_time_lines / lines_judged, 1) END           AS on_time_pct,
        ROUND(avg_days_late::numeric, 1)                                          AS avg_days_late,
        COALESCE(inspected_qty, 0)                                                AS inspected_qty,
        COALESCE(rejected_qty, 0)                                                 AS rejected_qty,
        CASE WHEN COALESCE(inspected_qty, 0) > 0
             THEN ROUND(100.0 * rejected_qty / inspected_qty, 1) END             AS reject_pct,
        COALESCE(osp_returned_qty, 0)                                             AS osp_returned_qty,
        COALESCE(osp_rejected_qty, 0)                                             AS osp_rejected_qty,
        CASE WHEN COALESCE(osp_inspected_qty, 0) > 0
             THEN ROUND(100.0 * osp_rejected_qty / osp_inspected_qty, 1) END     AS osp_reject_pct
      FROM per_vendor
      ORDER BY vendor_name
      LIMIT 2000
    `);

    const num = (v: unknown): number | null => (v != null ? Number(v) : null);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      vendor_name: String(r['vendor_name'] ?? ''),
      po_count: Number(r['po_count'] ?? 0),
      line_count: Number(r['line_count'] ?? 0),
      lines_received: Number(r['lines_received'] ?? 0),
      on_time_lines: Number(r['on_time_lines'] ?? 0),
      on_time_pct: num(r['on_time_pct']),
      avg_days_late: num(r['avg_days_late']),
      inspected_qty: Number(r['inspected_qty'] ?? 0),
      rejected_qty: Number(r['rejected_qty'] ?? 0),
      reject_pct: num(r['reject_pct']),
      osp_returned_qty: Number(r['osp_returned_qty'] ?? 0),
      osp_rejected_qty: Number(r['osp_rejected_qty'] ?? 0),
      osp_reject_pct: num(r['osp_reject_pct']),
    }));

    return { columns: vendorPerformanceReport.definition.columns, rows };
  },
};
