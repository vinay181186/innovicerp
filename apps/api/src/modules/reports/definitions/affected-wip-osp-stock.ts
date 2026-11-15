// ADR-292 report 3 — where an Item + Drawing Rev sits right now: work in
// progress per operation (with any hold on the operation), pieces at an OSP
// vendor, and stock on hand per Rev. The list an Engineering Change is judged
// against.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { likeFilter, numCell, REPORT_ROW_CAP, textCell, type SqlRow } from './report-helpers';

const HOLD_LABELS: Record<string, string> = {
  ecr: 'Engineering Change',
  rev_not_released: 'Rev not released',
  manual: 'Manual',
};

export const affectedWipOspStockReport: RegisteredReport = {
  definition: {
    slug: 'affected-wip-osp-stock',
    title: 'Affected WIP / OSP / Stock by Drawing Rev',
    description:
      'Per Item + Drawing Rev: work in progress by operation (with hold status and reason), pieces at the OSP vendor, and stock on hand.',
    group: 'Production',
    dept: 'production',
    filters: [{ key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' }],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'drawing_rev', label: 'Drawing Rev', type: 'text' },
      { key: 'found_at', label: 'Found At', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'hold_status', label: 'Hold Status', type: 'text' },
      { key: 'hold_reason', label: 'Hold Reason', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const item = likeFilter(filters['item']);
    const itemFrag = item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``;
    const result = await tx.execute(sql`
      SELECT x.item_code, x.item_name, x.drawing_rev, x.found_at, x.jc_code, x.op_seq,
             x.operation, x.vendor_name, x.qty, x.hold_kind, x.hold_reason
        FROM (
        SELECT i.code AS item_code, i.name AS item_name, ir.rev AS drawing_rev,
               'WIP' AS found_at, jc.code AS jc_code, o.op_seq, o.operation,
               NULL::text AS vendor_name,
               GREATEST(0, v.input_avail - v.completed_qty - v.at_vendor_qty)::float8 AS qty,
               o.hold_kind, o.hold_reason, 1 AS sort_key
          FROM public.v_jc_op_status v
          JOIN public.jc_ops o ON o.id = v.jc_op_id AND o.deleted_at IS NULL
          JOIN public.job_cards jc ON jc.id = v.job_card_id AND jc.deleted_at IS NULL
          JOIN public.v_jc_status js ON js.job_card_id = jc.id
          JOIN public.items i ON i.id = jc.item_id
          LEFT JOIN public.item_revisions ir ON ir.id = jc.item_revision_id
         WHERE v.company_id = ${companyId}::uuid
           AND js.computed_status NOT IN ('complete', 'closed')
           AND v.computed_status <> 'complete'
           AND (v.input_avail - v.completed_qty - v.at_vendor_qty > 0 OR o.hold_kind IS NOT NULL)
           ${itemFrag}
        UNION ALL
        SELECT i.code, i.name, ir.rev, 'At Vendor', w.jc_code, w.op_seq, w.operation,
               w.vendor_name, w.at_vendor_qty::float8, o.hold_kind, o.hold_reason, 2
          FROM public.v_osp_wip w
          JOIN public.jc_ops o ON o.id = w.jc_op_id AND o.deleted_at IS NULL
          JOIN public.job_cards jc ON jc.id = o.job_card_id
          JOIN public.items i ON i.id = jc.item_id
          LEFT JOIN public.item_revisions ir ON ir.id = jc.item_revision_id
         WHERE w.company_id = ${companyId}::uuid AND w.at_vendor_qty > 0
           ${itemFrag}
        UNION ALL
        SELECT i.code, i.name, ir.rev, 'In Stock', NULL, NULL, NULL, NULL,
               b.on_hand_qty::float8, NULL, NULL, 3
          FROM public.item_rev_stock_balances b
          JOIN public.items i ON i.id = b.item_id
          LEFT JOIN public.item_revisions ir ON ir.id = b.item_revision_id
         WHERE b.company_id = ${companyId}::uuid AND b.on_hand_qty > 0
           AND i.procurement_type::text = 'make'
           ${itemFrag}
      ) x
      ORDER BY x.item_code, x.drawing_rev NULLS FIRST, x.sort_key, x.jc_code, x.op_seq
      LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => ({
      item_code: textCell(r['item_code']),
      item_name: textCell(r['item_name']),
      drawing_rev: textCell(r['drawing_rev']),
      found_at: textCell(r['found_at']),
      jc_code: textCell(r['jc_code']),
      op_seq: r['op_seq'] == null ? null : numCell(r['op_seq']),
      operation: textCell(r['operation']),
      vendor_name: textCell(r['vendor_name']),
      qty: numCell(r['qty']),
      hold_status: r['hold_kind']
        ? `On hold — ${HOLD_LABELS[String(r['hold_kind'])] ?? String(r['hold_kind'])}`
        : r['found_at'] === 'In Stock'
          ? null
          : 'Not held',
      hold_reason: textCell(r['hold_reason']),
    }));
    return { columns: affectedWipOspStockReport.definition.columns, rows };
  },
};
