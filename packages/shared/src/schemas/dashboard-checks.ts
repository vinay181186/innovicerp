// ADR-262 — the new home (owner design 2026-10-31): department checks, the bell
// (per-item read / unread notifications) and the per-user "Lists open as"
// choice. The server computes every figure; the web only lays it out.
//
// A check is one numbered line on a department page ("Plans available for
// production (2)"). Clicking it opens its documents. `count` is the same
// figure as the line, the department badge and the "View all" page.

import { z } from 'zod';
import { dashTextSchema, dashToneSchema } from './dashboard-home';

/** Departments that carry checks, in menu order. Labels come from ACCESS_DEPTS. */
export const DASH_CHECK_DEPTS = ['sales', 'production', 'purchase', 'store', 'planning'] as const;
export const dashCheckDeptSchema = z.enum(DASH_CHECK_DEPTS);
export type DashCheckDept = z.infer<typeof dashCheckDeptSchema>;

/** Letters + underscore only, so a key can name a user_ui_settings row
 *  (`dash_open_<key>`, setting_key regex ^[a-z_]{1,64}$). */
export const DASH_CHECK_KEYS = [
  // Sales — SO + JWSO lines not fully delivered (SO: dispatched_qty, JWSO: returned_qty)
  'sales_overdue', // line due date before today
  'sales_due_week', // due today .. Sunday (IST), not overdue
  'sales_due_month', // due today .. month end (IST), not overdue
  // Production
  'prod_plans_available', // approved Route Card, Pending > 0, no Production Order (plan_to_pro rule)
  'prod_plans_overdue', // same plans, planned_start_date before today
  'prod_due_week', // open / partially closed Production Orders, target_date this week
  'prod_rc_pending', // plans whose Route Card is missing or waiting approval
  // Purchase
  'pur_pr_pending', // approved PR with balance still to order (pr_to_po rule)
  'pur_po_overdue', // PO due date passed, qty still pending (po_overdue rule)
  'pur_po_approval', // PO in draft, waiting approval (po_draft rule)
  // Store
  'store_jwso_grn', // JWSO party material not yet received on a Party GRN
  'store_party_qc', // Party GRN lines waiting for Incoming QC
  'store_po_grn', // PO lines with qty still to receive (all, not only late)
  // Planning
  'plan_so_unplanned', // SO / JWSO lines not fully planned (so_to_plan rule)
  'plan_rc_approval', // Route Cards waiting approval (rc_pending rule)
] as const;
export const dashCheckKeySchema = z.enum(DASH_CHECK_KEYS);
export type DashCheckKey = z.infer<typeof dashCheckKeySchema>;

/** Rows shown under an opened check; the rest are on the "View all" page. */
export const DASH_CHECK_ROW_LIMIT = 8;

export const dashCheckRowSchema = z.object({
  key: z.string(),
  docCode: z.string(),
  docHref: z.string(),
  /** Second column: the parent / reference document (SO No., PRO No., PO No.). */
  refCode: z.string().nullable(),
  refHref: z.string().nullable(),
  /** Customer / vendor / maker shown beside refCode. */
  party: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  qty: z.number().nullable(),
  uom: z.string().nullable(),
  /** YYYY-MM-DD (IST) — the date the check is about (its `dateHead`). */
  checkDate: z.string().nullable(),
  /** e.g. "3 days late", "Due today", "No Route Card". */
  statusLabel: z.string(),
  tone: dashToneSchema,
});
export type DashCheckRow = z.infer<typeof dashCheckRowSchema>;

export const dashCheckSchema = z.object({
  key: dashCheckKeySchema,
  dept: dashCheckDeptSchema,
  /** The owner's wording, e.g. "Plans available for production". */
  label: z.string(),
  count: z.number().int().nonnegative(),
  /** Colour of the count: late (red) / due (orange) / ok (blue). */
  tone: dashToneSchema,
  /** Column names that differ per check: [document, reference, date].
   *  The others are fixed: Sr · Item · Qty · Status. */
  head: z.tuple([z.string(), z.string(), z.string()]),
  /** First DASH_CHECK_ROW_LIMIT rows, late first then oldest. */
  rows: z.array(dashCheckRowSchema),
  /** List page behind "View all". */
  href: z.string(),
});
export type DashCheck = z.infer<typeof dashCheckSchema>;

export const dashCheckDeptBlockSchema = z.object({
  dept: dashCheckDeptSchema,
  /** Sum of the department's check counts — the menu badge. */
  total: z.number().int().nonnegative(),
  checks: z.array(dashCheckSchema),
});
export type DashCheckDeptBlock = z.infer<typeof dashCheckDeptBlockSchema>;

/** GET /dashboard/checks — only departments the caller has a tier in, and
 *  inside them only checks whose "View all" page the caller can open. */
export const dashChecksResponseSchema = z.object({
  depts: z.array(dashCheckDeptBlockSchema),
});
export type DashChecksResponse = z.infer<typeof dashChecksResponseSchema>;

// ── Notifications: the bell (ADR-262) ──
// Same events and rights as ADR-250, over the last NOTIFICATION_DAYS IST days and
// without the "document still open" filter (it is a history). Read state:
//   an explicit notification_reads row wins; otherwise read = event time is on
//   or before the caller's notifications_seen_at ("Mark all as read").

export const NOTIFICATION_DAYS = 30;
export const NOTIFICATION_POPOVER_LIMIT = 6;
export const NOTIFICATION_PAGE_LIMIT = 200;

export const notificationFilterSchema = z.enum(['all', 'unread', 'read']);
export type NotificationFilter = z.infer<typeof notificationFilterSchema>;

export const notificationsQuerySchema = z.object({
  filter: notificationFilterSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_LIMIT).default(NOTIFICATION_POPOVER_LIMIT),
});
export type NotificationsQuery = z.input<typeof notificationsQuerySchema>;

export const notificationItemSchema = z.object({
  /** Stable per event (activity_log id based) — the notification_reads key. */
  key: z.string().max(128),
  ts: z.string(), // ISO of the event
  tone: dashToneSchema,
  /** Who did it, for the initials circle. Null for system events. */
  actorName: z.string().nullable(),
  text: dashTextSchema,
  read: z.boolean(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationsResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  /** Every unread event in the window — the bell badge, whatever the filter. */
  unread: z.number().int().nonnegative(),
  /** Counts for the All / Unread / Read filter chips. */
  total: z.number().int().nonnegative(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

/** POST /dashboard/notifications/read — mark these events read or unread. */
export const markNotificationsReadInputSchema = z.object({
  items: z
    .array(z.object({ key: z.string().min(1).max(128), ts: z.string().datetime({ offset: true }) }))
    .min(1)
    .max(NOTIFICATION_PAGE_LIMIT),
  read: z.boolean(),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInputSchema>;

/** POST /dashboard/notifications/read-all — everything up to `upTo` (the newest
 *  event the caller was shown) becomes read; later events stay unread. */
export const markAllNotificationsReadInputSchema = z.object({
  upTo: z.string().datetime({ offset: true }),
});
export type MarkAllNotificationsReadInput = z.infer<typeof markAllNotificationsReadInputSchema>;
