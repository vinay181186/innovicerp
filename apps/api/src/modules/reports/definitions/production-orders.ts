// Production Orders (ADR-170) — one row per Production Order (IN-PRO-#####)
// with the live state of the Job Card it built. Pattern: list + status enum
// filter (open-po-ageing). Open orders first so the ones still waiting to be
// closed sit at the top, then newest first.
//
// The PO row stores the plan / SO / item / JC codes as text snapshots at
// creation (a PO is a document; those codes are never renamed). Progress is
// NOT stored on the PO — `jc_status` is read live off v_jc_status and
// `finished_qty` is the JC's last live op the same way the JC list computes
// `lastOpCompletedQty` (job-cards/service.ts): the QC-accepted qty for a QC /
// qc_required op, else the completed qty. `credited_qty` is what Close
// actually booked to stock (null until closed).

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

// ADR-182 added 'short_closed' — an order stopped at any stage. Blank picks
// every status, so the filter is only about narrowing to one of these.
// ADR-185: 'partially_closed' was missing, so a partly credited order could
// not be picked out here although the Production Orders list shows it.
const STATUS_OPTIONS = ['open', 'partially_closed', 'closed', 'short_closed'] as const;

export const productionOrdersReport: RegisteredReport = {
  definition: {
    slug: 'production-orders',
    title: 'Production Orders',
    description:
      'Every Production Order with its plan, SO/JWSO, item, the Job Card it built, the live JC status and finished qty, and — once closed — the qty credited to stock. Open orders first, then newest.',
    group: 'Production',
    dept: 'production',
    filters: [
      {
        key: 'status',
        label: 'Production Order Status',
        kind: 'enum',
        options: [...STATUS_OPTIONS],
      },
    ],
    columns: [
      { key: 'po_code', label: 'Production Order No', type: 'text' },
      { key: 'plan_code', label: 'Plan No.', type: 'text' },
      { key: 'so_code', label: 'SO / JWSO No.', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'target_date', label: 'Target Date', type: 'date' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'jc_status', label: 'JC Status', type: 'text' },
      { key: 'finished_qty', label: 'Completed', type: 'number' },
      { key: 'status', label: 'Production Order Status', type: 'text' },
      { key: 'closed_at', label: 'Closed Date', type: 'datetime' },
      { key: 'credited_qty', label: 'Credited Qty', type: 'number' },
      // ADR-185 — the lost pieces the order detail states (finish / short close).
      { key: 'lost_qty', label: 'Lost Qty', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const statusFilter = filters['status'];
    // Blank (or anything not in the enum) = all statuses.
    const statusFrag =
      statusFilter && (STATUS_OPTIONS as readonly string[]).includes(statusFilter)
        ? sql`AND po.status = ${statusFilter}`
        : sql``;

    const result = await tx.execute(sql`
      SELECT
        po.code AS po_code,
        po.plan_code_text AS plan_code,
        po.so_code_text AS so_code,
        po.item_code_text AS item_code,
        po.item_name_text AS item_name,
        po.order_qty::int AS order_qty,
        po.target_date,
        po.jc_code_text AS jc_code,
        COALESCE(s.computed_status, 'no_ops')::text AS jc_status,
        COALESCE((
          SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                      THEN vos.qc_accepted_qty ELSE vos.completed_qty END
          FROM public.v_jc_op_status vos
          WHERE vos.job_card_id = po.job_card_id
          ORDER BY vos.op_seq DESC LIMIT 1
        ), 0)::int AS finished_qty,
        po.status,
        to_char(po.closed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS closed_at,
        po.credited_qty::int AS credited_qty,
        po.lost_qty::int AS lost_qty
      FROM public.production_orders po
      LEFT JOIN public.v_jc_status s ON s.job_card_id = po.job_card_id
      WHERE po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL
        ${statusFrag}
      ORDER BY (po.status = 'open') DESC, po.created_at DESC, po.code DESC
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      po_code: String(r['po_code'] ?? ''),
      plan_code: String(r['plan_code'] ?? ''),
      so_code: (r['so_code'] as string | null) ?? null,
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      order_qty: Number(r['order_qty'] ?? 0),
      target_date:
        r['target_date'] instanceof Date
          ? r['target_date'].toISOString().slice(0, 10)
          : String(r['target_date'] ?? ''),
      jc_code: String(r['jc_code'] ?? ''),
      jc_status: String(r['jc_status'] ?? 'no_ops'),
      finished_qty: Number(r['finished_qty'] ?? 0),
      status: String(r['status'] ?? ''),
      closed_at: (r['closed_at'] as string | null) ?? null,
      credited_qty: r['credited_qty'] != null ? Number(r['credited_qty']) : null,
      lost_qty: r['lost_qty'] != null ? Number(r['lost_qty']) : null,
    }));

    return { columns: productionOrdersReport.definition.columns, rows };
  },
};
