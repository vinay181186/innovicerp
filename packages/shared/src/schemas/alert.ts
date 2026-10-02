// Alerts engine shared shapes (T-041d, ADR-024).
//
// Each alert is a server-defined rule (TS function backed by hand-written
// SQL) that returns a record list. The dashboard is poll-and-display: the
// frontend asks for "all active alerts", server runs them in parallel,
// returns counts + drill-down records. Mirrors legacy `_runAlerts` (legacy
// HTML L22314).
//
// Two endpoints under /alerts:
//   GET /alerts                      → run all active alerts visible to caller
//   GET /alerts/:code                → drill-down (one alert's full records)
//   GET /alerts/config               → definition list with per-company override merged
//   PUT /alerts/config/:code         → admin-only on/off toggle (upsert alert_config)
//
// `alert_config` table (Phase A) stores ONLY the per-company override of
// `defaultActive`; rule definitions live in code under
// apps/api/src/modules/alerts/definitions/.
//
// Phase B layers in alert_subscriptions + alert_deliveries for push email
// delivery. Wire types for those land in this file when Phase B ships.

import { z } from 'zod';

// Department buckets — drives the dashboard's per-dept summary cards and
// the role-visibility filter. Mirrors legacy `_defaultAlerts[].dept` set;
// `tasks` left out because all task-related alerts (AL-017) are deferred
// per ADR-024 carve-out.
export const alertDeptSchema = z.enum(['sales', 'purchase', 'store', 'design', 'production', 'qc']);
export type AlertDept = z.infer<typeof alertDeptSchema>;

export const alertColumnTypeSchema = z.enum(['text', 'number', 'date']);
export type AlertColumnType = z.infer<typeof alertColumnTypeSchema>;

export const alertColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: alertColumnTypeSchema,
});
export type AlertColumn = z.infer<typeof alertColumnSchema>;

export const alertDefinitionSchema = z.object({
  /** Stable code used in the URL path + as the override key (e.g. `AL-001`). */
  code: z.string(),
  dept: alertDeptSchema,
  name: z.string(),
  description: z.string(),
  /** Drill-down columns rendered when the user clicks the alert row. */
  columns: z.array(alertColumnSchema),
  /** Default on/off if no `alert_config` override exists for this company. */
  defaultActive: z.boolean(),
});
export type AlertDefinition = z.infer<typeof alertDefinitionSchema>;

/** Free-form record shape — drill-down values vary per rule. Every record
 *  also carries `navPage` (ADR-190): the page its document opens on, built
 *  server-side by docNavPage (e.g. `/purchase-orders/<id>`). It is not a
 *  column — render cells from `columns`, and use navPage as the row's link. */
export const alertRowSchema = z.record(z.union([z.string(), z.number(), z.null()]));
export type AlertRow = z.infer<typeof alertRowSchema>;

export const alertResultSchema = z.object({
  code: z.string(),
  dept: alertDeptSchema,
  name: z.string(),
  count: z.number().int().nonnegative(),
  records: z.array(alertRowSchema),
  /** ISO-8601 timestamp when the rule was evaluated. */
  generatedAt: z.string(),
});
export type AlertResult = z.infer<typeof alertResultSchema>;

export const listAlertsResponseSchema = z.object({
  generatedAt: z.string(),
  /** Count-only summaries (no `records` for low-overhead polling). The
   *  drill-down endpoint /alerts/:code returns the full record list. */
  alerts: z.array(
    z.object({
      code: z.string(),
      dept: alertDeptSchema,
      name: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});
export type ListAlertsResponse = z.infer<typeof listAlertsResponseSchema>;

export const runAlertResponseSchema = z.object({
  alert: alertResultSchema,
  columns: z.array(alertColumnSchema),
});
export type RunAlertResponse = z.infer<typeof runAlertResponseSchema>;

export const alertConfigEntrySchema = z.object({
  code: z.string(),
  dept: alertDeptSchema,
  name: z.string(),
  description: z.string(),
  defaultActive: z.boolean(),
  /** The effective state — registry default merged with `alert_config` override. */
  active: z.boolean(),
  /** Whether the company has an explicit override row for this code. */
  isOverridden: z.boolean(),
});
export type AlertConfigEntry = z.infer<typeof alertConfigEntrySchema>;

export const listAlertConfigResponseSchema = z.object({
  entries: z.array(alertConfigEntrySchema),
});
export type ListAlertConfigResponse = z.infer<typeof listAlertConfigResponseSchema>;

export const setAlertActiveInputSchema = z.object({
  active: z.boolean(),
});
export type SetAlertActiveInput = z.infer<typeof setAlertActiveInputSchema>;

// ─── Phase B: subscriptions + deliveries (T-041d slice 6) ────────────────
// Per-user opt-in to email digest delivery for an alert code. v1 ships
// `email` as the only channel; the wire shape leaves room to add `slack` /
// `sms` later without a breaking change.

export const alertChannelSchema = z.enum(['email']);
export type AlertChannel = z.infer<typeof alertChannelSchema>;

export const alertSubscriptionEntrySchema = z.object({
  code: z.string(),
  channel: alertChannelSchema,
  /** ISO-8601 timestamp this subscription row was created. */
  subscribedAt: z.string(),
});
export type AlertSubscriptionEntry = z.infer<typeof alertSubscriptionEntrySchema>;

export const listAlertSubscriptionsResponseSchema = z.object({
  /** The current user's subscriptions. Admin/manager get a separate
   *  endpoint to view other users' subscriptions if needed. */
  subscriptions: z.array(alertSubscriptionEntrySchema),
});
export type ListAlertSubscriptionsResponse = z.infer<typeof listAlertSubscriptionsResponseSchema>;

export const setAlertSubscriptionInputSchema = z.object({
  /** When true, ensure a subscription row exists; when false, remove it.
   *  Channel defaults to 'email' if omitted (the only channel today). */
  subscribed: z.boolean(),
  channel: alertChannelSchema.optional(),
});
export type SetAlertSubscriptionInput = z.infer<typeof setAlertSubscriptionInputSchema>;

// ─── Paged dashboard + drill (ADR-201, 25 rows a page) ───────────────────
// A query-string flag: "true" / "1" → true, anything else → false.
const queryFlag = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());

/** GET /alerts — the dashboard's search / "show zero" filter and page run on
 *  the server. No `limit` → every alert (the home widgets ask that way). */
export const listAlertsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  showZero: queryFlag.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListAlertsQuery = z.input<typeof listAlertsQuerySchema>;

/** The paged dashboard answer: the page of alerts plus the summary worked out
 *  over EVERY active alert (per-department record counts + the grand total) and
 *  `total` = alerts matching the search / filter (for the pager). */
export const listAlertsPageResponseSchema = listAlertsResponseSchema.extend({
  total: z.number().int().nonnegative(),
  totalRecords: z.number().int().nonnegative(),
  byDept: z.record(z.number().int().nonnegative()),
});
export type ListAlertsPageResponse = z.infer<typeof listAlertsPageResponseSchema>;

/** GET /alerts/:code — the drill's records are paged; `alert.count` stays the
 *  full record count. No `limit` → every record. */
export const runAlertQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type RunAlertQuery = z.input<typeof runAlertQuerySchema>;
