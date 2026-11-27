// SO / JWSO status by day (ADR-325, owner 2026-11-27).
//
// Reports › SO / JWSO Status and the Home menu item of the same name show, per
// day, one SO summary row and one JWSO summary row; a day opens a page with one
// row per SO and one row per JWSO. Today is worked out live; a past day is read
// from the saved copy (so_status_snapshots), written by ONE writer in the API
// every 10 minutes for the current IST day. A day with no saved copy (before
// go-live, or the API was down all day) is `source: 'none'`, never zeros.
//
// Figures are per ORDER, summed over its live lines (§26 — see
// apps/api/src/modules/so-jwso-status/figures.ts for the documents counted and
// the statuses left out). Not Started + Running + Closed = JC Released, always.

import { z } from 'zod';

/** Page right: one View row under Reports in Access Control (Hide page takes it away). */
export const SO_JWSO_STATUS_FORM = 'sojwstatus_view' as const;

/** Longest From→To range one request may ask for. */
export const SO_JWSO_STATUS_MAX_DAYS = 92;

export const ORDER_KINDS = ['SO', 'JWSO'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** The 11 figures, in screen / Excel column order. */
export const orderStatusFiguresSchema = z.object({
  totalLines: z.number().int().nonnegative(),
  totalPlans: z.number().int().nonnegative(),
  totalRc: z.number().int().nonnegative(),
  proReleased: z.number().int().nonnegative(),
  jcReleased: z.number().int().nonnegative(),
  jcNotStarted: z.number().int().nonnegative(),
  jcRunning: z.number().int().nonnegative(),
  jcClosed: z.number().int().nonnegative(),
  proClosed: z.number().int().nonnegative(),
  dispatchQty: z.number().nonnegative(),
  physicalStock: z.number().nonnegative(),
});
export type OrderStatusFigures = z.infer<typeof orderStatusFiguresSchema>;

/** Column headings, keyed like the figures (docs/NAMING.md). */
export const ORDER_STATUS_FIGURE_LABELS: Record<keyof OrderStatusFigures, string> = {
  totalLines: 'Total Lines',
  totalPlans: 'Total Plans',
  totalRc: 'Total RC',
  proReleased: 'PRO Released',
  jcReleased: 'JC Released',
  jcNotStarted: 'JC Not Started',
  jcRunning: 'JC Running',
  jcClosed: 'JC Closed',
  proClosed: 'PRO Closed',
  dispatchQty: 'Dispatch Qty',
  physicalStock: 'Physical Stock',
};
export const ORDER_STATUS_FIGURE_KEYS = Object.keys(
  ORDER_STATUS_FIGURE_LABELS,
) as (keyof OrderStatusFigures)[];

/** One SO or one JWSO on one day. `orderCode` = SO No. (sales_orders.code) or JWSO No. */
export const orderStatusRowSchema = orderStatusFiguresSchema.extend({
  orderKind: z.enum(ORDER_KINDS),
  orderId: z.string().uuid(),
  orderCode: z.string(),
});
export type OrderStatusRow = z.infer<typeof orderStatusRowSchema>;

/** One type's total on one day: Orders + the 11 figures. */
export const orderStatusSummarySchema = orderStatusFiguresSchema.extend({
  orders: z.number().int().nonnegative(),
});
export type OrderStatusSummary = z.infer<typeof orderStatusSummarySchema>;

/** live = today, worked out now; saved = the copy kept for that day; none = no copy exists. */
export const DAY_SOURCES = ['live', 'saved', 'none'] as const;
export type DaySource = (typeof DAY_SOURCES)[number];

// GET /so-jwso-status/days?from&to  (to ≤ today IST, to − from < MAX_DAYS)
export const soJwsoStatusDaysQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: 'From must be on or before To' });
export type SoJwsoStatusDaysQuery = z.infer<typeof soJwsoStatusDaysQuerySchema>;

export const soJwsoStatusDaySchema = z.object({
  date: isoDate,
  source: z.enum(DAY_SOURCES),
  /** When the figures were taken (ISO timestamp); null when source = none. */
  takenAt: z.string().nullable(),
  so: orderStatusSummarySchema.nullable(),
  jwso: orderStatusSummarySchema.nullable(),
});
export type SoJwsoStatusDay = z.infer<typeof soJwsoStatusDaySchema>;

/** Newest day first (ADR-318). */
export const soJwsoStatusDaysResponseSchema = z.object({
  today: isoDate,
  days: z.array(soJwsoStatusDaySchema),
});
export type SoJwsoStatusDaysResponse = z.infer<typeof soJwsoStatusDaysResponseSchema>;

// GET /so-jwso-status/day/:date
export const soJwsoStatusDayParamsSchema = z.object({ date: isoDate });

export const soJwsoStatusDayDetailSchema = z.object({
  date: isoDate,
  today: isoDate,
  source: z.enum(DAY_SOURCES),
  takenAt: z.string().nullable(),
  /** Newest order first (ADR-318). Empty when source = none. */
  soRows: z.array(orderStatusRowSchema),
  jwsoRows: z.array(orderStatusRowSchema),
  soTotal: orderStatusSummarySchema.nullable(),
  jwsoTotal: orderStatusSummarySchema.nullable(),
});
export type SoJwsoStatusDayDetail = z.infer<typeof soJwsoStatusDayDetailSchema>;
