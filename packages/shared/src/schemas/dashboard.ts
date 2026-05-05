// Dashboard KPI shapes (T-041c).
//
// 5 fixed tiles backed by simple aggregate counts. Each tile is clickable;
// the `route` field tells the frontend where to drill in. Future tiles can
// be added without breaking the response shape — `tiles` is an array.
//
// Endpoint: GET /dashboard/kpis (read-only, any role).

import { z } from 'zod';

export const dashboardTileKindSchema = z.enum([
  'open_sales_orders',
  'open_purchase_orders',
  'jc_ops_awaiting_qc',
  'ncs_pending_dispose',
  'grn_lines_pending_qc',
  // T-043 follow-on — role-coverage tiles for procurement + operator/qc.
  'prs_pending_conversion',
  'ops_in_progress',
]);
export type DashboardTileKind = z.infer<typeof dashboardTileKindSchema>;

export const dashboardTileSeveritySchema = z.enum(['info', 'warning', 'danger', 'ok']);
export type DashboardTileSeverity = z.infer<typeof dashboardTileSeveritySchema>;

export const dashboardTileSchema = z.object({
  kind: dashboardTileKindSchema,
  title: z.string(),
  /** Primary number rendered large on the tile. */
  count: z.number().int().nonnegative(),
  /** Optional secondary metric (e.g. sum of rejected qty). Stringified
   *  numeric to preserve numeric(12,2) precision; null when not relevant. */
  secondary: z
    .object({
      label: z.string(),
      value: z.string(),
    })
    .nullable(),
  /** Severity drives the colour. `ok` is green (everything caught up);
   *  `info` is neutral; `warning` is amber; `danger` is red. The service
   *  picks based on count + age thresholds where applicable. */
  severity: dashboardTileSeveritySchema,
  /** Frontend route the tile drills into when clicked. */
  route: z.string(),
  /** Optional human-readable note (legacy ageing windows, source caveats). */
  hint: z.string().nullable(),
});
export type DashboardTile = z.infer<typeof dashboardTileSchema>;

export const dashboardKpisResponseSchema = z.object({
  generatedAt: z.string(),
  tiles: z.array(dashboardTileSchema),
});
export type DashboardKpisResponse = z.infer<typeof dashboardKpisResponseSchema>;
