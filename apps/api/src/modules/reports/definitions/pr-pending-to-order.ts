// PR pending to order — Purchase Requests with qty still to be put on a PO:
// PR Qty less what sits on live PO lines (a short-closed PO counts only what it
// received — ADR-152 / ADR-189), not balance-closed, not cancelled. Oldest
// first. Modelled on ERPNext's "Requested Items To Be Ordered" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell as dateOrNull, enumFilter, isoDateFilter, likeFilter } from './report-helpers';

const PR_TYPES = ['standard', 'jw_osp', 'service'];

export const prPendingToOrderReport: RegisteredReport = {
  definition: {
    slug: 'pr-pending-to-order',
    title: 'PR pending to order',
    description:
      'Purchase Requests with qty not yet on a PO (a short-closed PO gives its un-received qty back). Balance-closed and cancelled PRs are left out. Sorted by Days Pending, oldest first.',
    group: 'Purchase',
    dept: 'purchase',
    filters: [
      { key: 'fromDate', label: 'PR Date From', kind: 'date' },
      { key: 'toDate', label: 'PR Date To', kind: 'date' },
      { key: 'prType', label: 'PR Type', kind: 'enum', options: PR_TYPES },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
    ],
    columns: [
      { key: 'pr_code', label: 'PR No.', type: 'text' },
      { key: 'pr_date', label: 'PR Date', type: 'date' },
      { key: 'pr_type', label: 'PR Type', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'pr_qty', label: 'PR Qty', type: 'number' },
      { key: 'ordered_qty', label: 'Ordered', type: 'number' },
      { key: 'pending_qty', label: 'Pending', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_pending', label: 'Days Pending', type: 'number' },
      { key: 'approved', label: 'Approved', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const prType = enumFilter(filters['prType'], PR_TYPES);
    const item = likeFilter(filters['item']);

    const fromFrag = fromDate ? sql`AND pr.pr_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND pr.pr_date <= ${toDate}::date` : sql``;
    const typeFrag = prType ? sql`AND pr.pr_type = ${prType}::pr_type` : sql``;
    const itemFrag = item
      ? sql`AND (it.code ILIKE ${item} OR it.name ILIKE ${item}
                 OR pr.item_code_text ILIKE ${item} OR pr.item_name ILIKE ${item})`
      : sql``;

    // ordered_qty mirrors purchase-requests/service.ts orderedQtySql (not
    // exported): live PO lines from this PR, a short-closed PO counting only its
    // received qty; a legacy PR with a header po_id and no linked line counts
    // as fully ordered.
    const result = await tx.execute(sql`
      SELECT
        x.pr_code, x.pr_date, x.pr_type, x.item_code, x.item_name, x.pr_qty,
        x.ordered_qty, x.due_date, x.days_pending, x.approved, x.so_code, x.jc_code,
        (x.pr_qty - x.ordered_qty)::int AS pending_qty
      FROM (
        SELECT
          pr.code                                        AS pr_code,
          pr.pr_date                                     AS pr_date,
          pr.pr_type::text                               AS pr_type,
          COALESCE(it.code, pr.item_code_text, '—')      AS item_code,
          COALESCE(it.name, pr.item_name)                AS item_name,
          pr.qty                                         AS pr_qty,
          (CASE
            WHEN pr.po_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM public.purchase_order_lines l0
              WHERE l0.source_pr_id = pr.id AND l0.deleted_at IS NULL
            ) THEN pr.qty
            ELSE (
              SELECT COALESCE(SUM(CASE WHEN p2.short_closed_at IS NOT NULL
                                       THEN COALESCE(pol.received_qty, 0) ELSE pol.qty END), 0)
              FROM public.purchase_order_lines pol
              JOIN public.purchase_orders p2 ON p2.id = pol.purchase_order_id
              WHERE pol.source_pr_id = pr.id
                AND pol.deleted_at IS NULL
                AND p2.deleted_at IS NULL
                AND p2.status <> 'cancelled'
            )
          END)::int                                      AS ordered_qty,
          pr.required_date                               AS due_date,
          (CURRENT_DATE - pr.pr_date)::int               AS days_pending,
          CASE WHEN pr.approved_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS approved,
          so.code                                        AS so_code,
          jc.code                                        AS jc_code
        FROM public.purchase_requests pr
        LEFT JOIN public.items it ON it.id = pr.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.sales_order_lines sol
          ON sol.id = pr.source_so_line_id AND sol.deleted_at IS NULL
        LEFT JOIN public.sales_orders so
          ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.jc_ops jo
          ON jo.id = pr.source_jc_op_id AND jo.deleted_at IS NULL
        LEFT JOIN public.job_cards jc
          ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
        WHERE pr.company_id = ${companyId}::uuid
          AND pr.deleted_at IS NULL
          AND pr.balance_closed_at IS NULL
          AND pr.status <> 'cancelled'
          ${fromFrag}
          ${toFrag}
          ${typeFrag}
          ${itemFrag}
      ) x
      WHERE x.pr_qty - x.ordered_qty > 0
      ORDER BY x.days_pending DESC, x.pr_code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      pr_code: String(r['pr_code'] ?? ''),
      pr_date: dateOrNull(r['pr_date']),
      pr_type: String(r['pr_type'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      pr_qty: Number(r['pr_qty'] ?? 0),
      ordered_qty: Number(r['ordered_qty'] ?? 0),
      pending_qty: Number(r['pending_qty'] ?? 0),
      due_date: dateOrNull(r['due_date']),
      days_pending: Number(r['days_pending'] ?? 0),
      approved: String(r['approved'] ?? ''),
      so_code: (r['so_code'] as string | null) ?? null,
      jc_code: (r['jc_code'] as string | null) ?? null,
    }));

    return { columns: prPendingToOrderReport.definition.columns, rows };
  },
};
