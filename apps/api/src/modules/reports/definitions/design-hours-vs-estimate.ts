// Design hours vs estimate — one row per Design Tracker entry: Estimated
// Hours against the hours booked to it on the Design Work Log (ADR-188:
// rows logged against the tracker), the variance and % of estimate used.
// Modelled on ERPNext's "Project wise Stock Tracking" / Timesheet vs estimate ("Project Summary") report.

import { DESIGN_TRACKER_STATUSES } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { enumFilter, likeFilter, numCell, type SqlRow, textCell } from './report-helpers';

export const designHoursVsEstimateReport: RegisteredReport = {
  definition: {
    slug: 'design-hours-vs-estimate',
    title: 'Design hours vs estimate',
    description:
      'Every Design Tracker entry: Estimated Hours, Booked Hours (Design Work Log rows logged against it), Variance (Booked minus Estimated; above 0 = over estimate) and % Used. Biggest overrun first.',
    group: 'Design',
    dept: 'design',
    filters: [
      { key: 'designer', label: 'Designer', kind: 'text', placeholder: 'Designer name' },
      {
        key: 'status',
        label: 'Design Status',
        kind: 'enum',
        options: [...DESIGN_TRACKER_STATUSES],
      },
    ],
    columns: [
      { key: 'tracker_code', label: 'DSN No.', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'designer', label: 'Designer', type: 'text' },
      { key: 'status', label: 'Design Status', type: 'text' },
      { key: 'estimated_hours', label: 'Estimated Hours', type: 'number' },
      { key: 'booked_hours', label: 'Booked Hours', type: 'number' },
      { key: 'variance_hours', label: 'Variance (Hours)', type: 'number' },
      { key: 'pct_used', label: '% Used', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const designer = likeFilter(filters['designer']);
    const status = enumFilter(filters['status'], DESIGN_TRACKER_STATUSES);

    const designerFrag = designer ? sql`AND dt.designer ILIKE ${designer}` : sql``;
    const statusFrag = status ? sql`AND dt.status = ${status}` : sql``;

    const result = await tx.execute(sql`
      SELECT
        dt.code                                      AS tracker_code,
        COALESCE(so.code, dt.so_code_text)           AS so_code,
        COALESCE(it.code, dt.item_code_text, '—')    AS item_code,
        dt.designer                                  AS designer,
        dt.status                                    AS status,
        dt.estimated_hours::float                    AS estimated_hours,
        bk.booked::float                             AS booked_hours,
        (bk.booked - dt.estimated_hours)::float      AS variance_hours,
        CASE WHEN dt.estimated_hours > 0
             THEN ROUND(bk.booked * 100.0 / dt.estimated_hours, 1)::float
             ELSE NULL
        END                                          AS pct_used
      FROM public.design_tracker dt
      LEFT JOIN public.sales_orders so
        ON so.id = dt.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.items it
        ON it.id = dt.item_id AND it.deleted_at IS NULL
      CROSS JOIN LATERAL (
        -- ADR-188 — same figure as the Design Tracker list's Total Hours.
        SELECT COALESCE(SUM(wl.hours), 0)::numeric AS booked
        FROM public.design_work_log wl
        WHERE wl.design_tracker_id = dt.id AND wl.deleted_at IS NULL
      ) bk
      WHERE dt.company_id = ${companyId}::uuid
        AND dt.deleted_at IS NULL
        ${designerFrag}
        ${statusFrag}
      ORDER BY (bk.booked - dt.estimated_hours) DESC, dt.code DESC
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      tracker_code: String(r['tracker_code'] ?? ''),
      so_code: textCell(r['so_code']),
      item_code: String(r['item_code'] ?? ''),
      designer: String(r['designer'] ?? ''),
      status: String(r['status'] ?? ''),
      estimated_hours: numCell(r['estimated_hours']),
      booked_hours: numCell(r['booked_hours']),
      variance_hours: numCell(r['variance_hours']),
      pct_used: r['pct_used'] == null ? null : numCell(r['pct_used']),
    }));

    return { columns: designHoursVsEstimateReport.definition.columns, rows };
  },
};
