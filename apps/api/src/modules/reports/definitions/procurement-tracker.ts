// Procurement tracker — one row per Purchase Request, following it to the PO
// raised from it and the first GRN received against that PO line, with the
// days each hop took and the PO value of the PR's own line(s).
// Modelled on ERPNext's "Procurement Tracker" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell as dateOrNull, enumFilter, isoDateFilter } from './report-helpers';

const PR_TYPES = ['standard', 'jw_osp', 'service'];
const PR_STATUSES = ['open', 'approved', 'po_created', 'cancelled'];

export const procurementTrackerReport: RegisteredReport = {
  definition: {
    slug: 'procurement-tracker',
    title: 'Procurement tracker (PR → PO → GRN)',
    description:
      'Each Purchase Request with the PO raised from it and the first GRN against that PO line, the days each step took, the Est. Cost and the PO Value of the PR’s line. Cancelled POs are ignored.',
    group: 'Purchase',
    dept: 'purchase',
    showsMoney: true,
    filters: [
      { key: 'fromDate', label: 'PR Date From', kind: 'date' },
      { key: 'toDate', label: 'PR Date To', kind: 'date' },
      { key: 'prType', label: 'PR Type', kind: 'enum', options: PR_TYPES },
      { key: 'status', label: 'PR Status', kind: 'enum', options: PR_STATUSES },
    ],
    columns: [
      { key: 'pr_code', label: 'PR No.', type: 'text' },
      { key: 'pr_date', label: 'PR Date', type: 'date' },
      { key: 'pr_type', label: 'PR Type', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'pr_qty', label: 'PR Qty', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'approved_on', label: 'Approved On', type: 'date' },
      { key: 'po_code', label: 'PO No.', type: 'text' },
      { key: 'po_date', label: 'PO Date', type: 'date' },
      { key: 'grn_code', label: 'GRN No.', type: 'text' },
      { key: 'grn_date', label: 'GRN Date', type: 'date' },
      { key: 'days_pr_to_po', label: 'Days PR → PO', type: 'number' },
      { key: 'days_po_to_grn', label: 'Days PO → GRN', type: 'number' },
      { key: 'est_cost', label: 'Est. Cost', type: 'number' },
      { key: 'po_value', label: 'PO Value', type: 'number' },
      { key: 'pr_status', label: 'PR Status', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const prType = enumFilter(filters['prType'], PR_TYPES);
    const status = enumFilter(filters['status'], PR_STATUSES);

    const fromFrag = fromDate ? sql`AND pr.pr_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND pr.pr_date <= ${toDate}::date` : sql``;
    const typeFrag = prType ? sql`AND pr.pr_type = ${prType}::pr_type` : sql``;
    const statusFrag = status ? sql`AND pr.status = ${status}::pr_status` : sql``;

    // The PR → PO link is purchase_order_lines.source_pr_id (ADR-152). The
    // three legacy PRs with a header po_id but no linked line (see
    // purchase-requests/service.ts deriveOrderedQty) fall back to po_id, with
    // the GRN matched on the PR's item.
    const result = await tx.execute(sql`
      SELECT
        pr.code                                        AS pr_code,
        pr.pr_date                                     AS pr_date,
        pr.pr_type::text                               AS pr_type,
        COALESCE(it.code, pr.item_code_text, '—')      AS item_code,
        COALESCE(it.name, pr.item_name)                AS item_name,
        pr.qty                                         AS pr_qty,
        pr.required_date                               AS due_date,
        to_char(pr.approved_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS approved_on,
        COALESCE(pl.po_code, lpo.code)                 AS po_code,
        COALESCE(pl.po_date, lpo.po_date)              AS po_date,
        COALESCE(g.grn_code, lg.grn_code)              AS grn_code,
        COALESCE(g.grn_date, lg.grn_date)              AS grn_date,
        (COALESCE(pl.po_date, lpo.po_date) - pr.pr_date)::int AS days_pr_to_po,
        (COALESCE(g.grn_date, lg.grn_date) - COALESCE(pl.po_date, lpo.po_date))::int AS days_po_to_grn,
        pr.est_cost::numeric                           AS est_cost,
        pv.po_value                                    AS po_value,
        pr.status::text                                AS pr_status
      FROM public.purchase_requests pr
      LEFT JOIN public.items it ON it.id = pr.item_id AND it.deleted_at IS NULL
      -- First live PO line raised from this PR.
      LEFT JOIN LATERAL (
        SELECT pol.id AS pol_id, po.code AS po_code, po.po_date
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po
          ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
        WHERE pol.source_pr_id = pr.id
          AND pol.deleted_at IS NULL
          AND po.status <> 'cancelled'
        ORDER BY po.po_date, po.code, pol.line_no
        LIMIT 1
      ) pl ON TRUE
      -- Value of every live PO line raised from this PR.
      LEFT JOIN LATERAL (
        SELECT SUM(pol.qty * pol.rate)::numeric(14, 2) AS po_value
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po
          ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
        WHERE pol.source_pr_id = pr.id
          AND pol.deleted_at IS NULL
          AND po.status <> 'cancelled'
      ) pv ON TRUE
      -- First GRN against the PR's PO line(s).
      LEFT JOIN LATERAL (
        SELECT grn.code AS grn_code, grn.grn_date
        FROM public.goods_receipt_note_lines grl
        JOIN public.goods_receipt_notes grn
          ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
        JOIN public.purchase_order_lines pol
          ON pol.id = grl.purchase_order_line_id AND pol.deleted_at IS NULL
        WHERE pol.source_pr_id = pr.id
          AND grl.deleted_at IS NULL
        ORDER BY grn.grn_date, grn.code
        LIMIT 1
      ) g ON TRUE
      -- Legacy header link, used only when no PO line points at the PR.
      LEFT JOIN public.purchase_orders lpo
        ON pl.pol_id IS NULL AND lpo.id = pr.po_id
       AND lpo.deleted_at IS NULL AND lpo.status <> 'cancelled'
      LEFT JOIN LATERAL (
        SELECT grn.code AS grn_code, grn.grn_date
        FROM public.goods_receipt_note_lines grl
        JOIN public.goods_receipt_notes grn
          ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
        JOIN public.purchase_order_lines pol
          ON pol.id = grl.purchase_order_line_id AND pol.deleted_at IS NULL
        WHERE lpo.id IS NOT NULL
          AND pol.purchase_order_id = lpo.id
          AND grl.deleted_at IS NULL
          AND (pr.item_id IS NULL OR grl.item_id = pr.item_id)
        ORDER BY grn.grn_date, grn.code
        LIMIT 1
      ) lg ON TRUE
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${typeFrag}
        ${statusFrag}
      ORDER BY pr.pr_date DESC, pr.code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      pr_code: String(r['pr_code'] ?? ''),
      pr_date: dateOrNull(r['pr_date']),
      pr_type: String(r['pr_type'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      pr_qty: Number(r['pr_qty'] ?? 0),
      due_date: dateOrNull(r['due_date']),
      approved_on: dateOrNull(r['approved_on']),
      po_code: (r['po_code'] as string | null) ?? null,
      po_date: dateOrNull(r['po_date']),
      grn_code: (r['grn_code'] as string | null) ?? null,
      grn_date: dateOrNull(r['grn_date']),
      days_pr_to_po: r['days_pr_to_po'] != null ? Number(r['days_pr_to_po']) : null,
      days_po_to_grn: r['days_po_to_grn'] != null ? Number(r['days_po_to_grn']) : null,
      est_cost: Number(r['est_cost'] ?? 0),
      po_value: r['po_value'] != null ? Number(r['po_value']) : null,
      pr_status: String(r['pr_status'] ?? ''),
    }));

    return { columns: procurementTrackerReport.definition.columns, rows };
  },
};
