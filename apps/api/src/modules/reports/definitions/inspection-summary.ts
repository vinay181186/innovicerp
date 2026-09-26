// Inspection summary (3 stages) — Inspected / Accepted / Rejected per stage
// and item over a date range: Incoming (GRN lines at Incoming QC), In-Process
// and Final Inspection (op_log 'qc' rows; Final = the JC's last live op, the
// qc-history isLastOp rule, ADR-069 / ADR-169). Modelled on ERPNext's
// "Quality Inspection Summary" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { enumFilter, isoDateFilter, likeFilter } from './report-helpers';

const STAGES: Record<string, string> = {
  incoming: 'Incoming',
  in_process: 'In-Process',
  final_inspection: 'Final Inspection',
};

export const inspectionSummaryReport: RegisteredReport = {
  definition: {
    slug: 'inspection-summary',
    title: 'Inspection summary (3 stages)',
    description:
      'Inspected, Accepted and Rejected per stage and item: Incoming QC on GRN lines (by QC Date), In-Process and Final Inspection on job cards (by log date; Final = the last op of the job card).',
    group: 'Quality',
    dept: 'qc',
    filters: [
      { key: 'fromDate', label: 'QC Date From', kind: 'date' },
      { key: 'toDate', label: 'QC Date To', kind: 'date' },
      { key: 'stage', label: 'QC Stage', kind: 'enum', options: Object.keys(STAGES) },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
    ],
    columns: [
      { key: 'stage', label: 'QC Stage', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'inspected_qty', label: 'Inspected', type: 'number' },
      { key: 'accepted_qty', label: 'Accepted', type: 'number' },
      { key: 'rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'reject_pct', label: 'Reject %', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const stageKey = enumFilter(filters['stage'], Object.keys(STAGES));
    const stage = stageKey ? STAGES[stageKey] : undefined;
    const item = likeFilter(filters['item']);

    const grnFrom = fromDate ? sql`AND grl.qc_date >= ${fromDate}::date` : sql``;
    const grnTo = toDate ? sql`AND grl.qc_date <= ${toDate}::date` : sql``;
    const logFrom = fromDate ? sql`AND ol.log_date >= ${fromDate}::date` : sql``;
    const logTo = toDate ? sql`AND ol.log_date <= ${toDate}::date` : sql``;
    const stageFrag = stage ? sql`AND s.stage = ${stage}` : sql``;
    const itemFrag = item
      ? sql`AND (s.item_code ILIKE ${item} OR s.item_name ILIKE ${item})`
      : sql``;

    const result = await tx.execute(sql`
      WITH s AS (
        -- Incoming QC (ADR-189: GRN receives, Incoming QC inspects).
        SELECT
          'Incoming'                                   AS stage,
          COALESCE(it.code, grl.item_code_text, '—')   AS item_code,
          COALESCE(it.name, grl.item_name)             AS item_name,
          grl.qc_accepted_qty                          AS accepted,
          grl.qc_rejected_qty                          AS rejected
        FROM public.goods_receipt_note_lines grl
        JOIN public.goods_receipt_notes grn
          ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
        LEFT JOIN public.items it ON it.id = grl.item_id AND it.deleted_at IS NULL
        WHERE grl.company_id = ${companyId}::uuid
          AND grl.deleted_at IS NULL
          AND grl.qc_date IS NOT NULL
          AND (grl.qc_accepted_qty + grl.qc_rejected_qty) > 0
          ${grnFrom}
          ${grnTo}
        UNION ALL
        -- Job-card QC entries. op_log is append-only (no deleted_at).
        SELECT
          CASE WHEN o.op_seq = (SELECT MAX(lo.op_seq) FROM public.jc_ops lo
                                WHERE lo.job_card_id = jc.id AND lo.deleted_at IS NULL)
               THEN 'Final Inspection' ELSE 'In-Process' END,
          COALESCE(it.code, '—'),
          it.name,
          ol.qty,
          ol.reject_qty
        FROM public.op_log ol
        JOIN public.jc_ops o ON o.id = ol.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
        LEFT JOIN public.items it ON it.id = jc.item_id AND it.deleted_at IS NULL
        WHERE ol.company_id = ${companyId}::uuid
          AND ol.log_type = 'qc'
          ${logFrom}
          ${logTo}
      )
      SELECT
        s.stage,
        s.item_code,
        MAX(s.item_name)                              AS item_name,
        SUM(s.accepted + s.rejected)::int             AS inspected_qty,
        SUM(s.accepted)::int                          AS accepted_qty,
        SUM(s.rejected)::int                          AS rejected_qty,
        CASE WHEN SUM(s.accepted + s.rejected) > 0
             THEN ROUND(100.0 * SUM(s.rejected) / SUM(s.accepted + s.rejected), 1) END AS reject_pct
      FROM s
      WHERE TRUE
        ${stageFrag}
        ${itemFrag}
      GROUP BY s.stage, s.item_code
      ORDER BY CASE s.stage WHEN 'Incoming' THEN 1 WHEN 'In-Process' THEN 2 ELSE 3 END,
               s.item_code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      stage: String(r['stage'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      inspected_qty: Number(r['inspected_qty'] ?? 0),
      accepted_qty: Number(r['accepted_qty'] ?? 0),
      rejected_qty: Number(r['rejected_qty'] ?? 0),
      reject_pct: r['reject_pct'] != null ? Number(r['reject_pct']) : null,
    }));

    return { columns: inspectionSummaryReport.definition.columns, rows };
  },
};
