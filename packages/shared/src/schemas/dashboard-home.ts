// Dashboard (home landing page) shared schemas + UI registries. Mirror of
// legacy renderHome (HTML L2486) and its sub-views. Distinct from dashboard.ts
// (the role-filtered KPI tiles) and production-dashboard (renderDashboard).
//
// ADR-250: one per-person home for every user (blocks gated by the caller's
// rights), plus the Widgets and Customize views. Everything is computed
// server-side; the web renders the returned payload.

import { z } from 'zod';
import { approvalInboxResponseSchema } from './approval-config';

// ── Op rows (Running Ops board + the home ops lists) ──
export const runningOpRowSchema = z.object({
  jcCode: z.string(),
  /** WHAT is being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemCode: z.string().nullable().default(null),
  /** The customer's drawing revision behind that card, read live off the SO line
   *  it was raised against (job_cards.source_so_line_id ->
   *  sales_order_lines.revision) and rendered beside the code as `CODE/REV`.
   *  Never items.revision, which describes the item master and would misname the
   *  drawing being worked to. Null on a JW-sourced or standalone card, which
   *  then shows the bare code. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  opSeq: z.number().int(),
  operation: z.string(),
  machine: z.string().nullable(),
  elapsedMin: z.number().int(),
  completed: z.number().int(),
  orderQty: z.number().int(),
});
export type RunningOpRow = z.infer<typeof runningOpRowSchema>;

export const readyOpRowSchema = z.object({
  jcCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  machine: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for the job card this op belongs to
   *  (job_cards.source_so_line_id → sales_order_lines.revision). The operator
   *  is the person who most needs it, so it rides alongside the item code on
   *  this tile. Null on a JW-sourced or standalone card — there is no customer
   *  drawing behind it — and null shows the bare code, never a bare slash. It
   *  is not items.revision, which is a different column about the item. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  available: z.number().int(),
  dueDate: z.string().nullable(),
  isOverdue: z.boolean(),
});
export type ReadyOpRow = z.infer<typeof readyOpRowSchema>;

// ── Per-person home (ADR-250) ──
// ONE home for every user; each block is present only when the caller holds
// the right its action needs (effectiveFormPerms / canOpenPage on the server).
// Replaces the admin / operator / specialist layouts (ADR-044).
//
// Document numbers never travel inside free text: text is a list of parts, and
// a `code` part carries the page that opens it. The web renders every code
// through <ActionLink fallback="text"> (ADR-234) — a link when the caller may
// open that page, plain text when not. The server always sends the href.

export const dashTextPartSchema = z.union([
  z.object({ text: z.string() }),
  z.object({ code: z.string(), href: z.string() }),
]);
export type DashTextPart = z.infer<typeof dashTextPartSchema>;
export const dashTextSchema = z.array(dashTextPartSchema);
export type DashText = z.infer<typeof dashTextSchema>;

/** late = red, due = orange (today / waiting), ok = green, none = no colour. */
export const dashToneSchema = z.enum(['late', 'due', 'ok', 'none']);
export type DashTone = z.infer<typeof dashToneSchema>;

/** One symbol in a row's action column. The server sends only actions the
 *  caller holds the right for; the web still wraps each in <ActionLink>.
 *  `href` opens a page; `taskFor` (remind) creates a linked task via the
 *  existing POST /tasks. */
export const dashActionKindSchema = z.enum(['create', 'open', 'inspect', 'start', 'remind']);
export type DashActionKind = z.infer<typeof dashActionKindSchema>;
export const dashActionSchema = z.object({
  kind: dashActionKindSchema,
  /** Words for the hover title / screen reader, e.g. "Create JW PO". */
  label: z.string(),
  href: z.string().nullable(),
  /** remind only: who the task goes to (the person holding the next step),
   *  and the document it links to. */
  taskFor: z
    .object({
      userId: z.string().uuid(),
      linkedRefType: z.string(),
      linkedRefId: z.string().uuid(),
      linkedRefDisplay: z.string(),
      linkedRefNavPage: z.string(),
    })
    .nullable()
    .default(null),
});
export type DashAction = z.infer<typeof dashActionSchema>;

export const dashRowSchema = z.object({
  key: z.string(),
  docCode: z.string(),
  docHref: z.string(),
  /** Second line under the number: party, next step, who holds it. */
  sub: dashTextSchema,
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  qty: z.number().nullable(),
  uom: z.string().nullable(),
  /** The status cell, e.g. "6 days", "due 25-Oct", "1 day late". */
  statusLabel: z.string(),
  tone: dashToneSchema,
  /** Raised / received / assigned by the caller — the "Mine" switch keeps these. */
  mine: z.boolean(),
  /** ₹ before GST; null when the caller has no price right on that page. */
  amount: z.number().nullable(),
  actions: z.array(dashActionSchema),
});
export type DashRow = z.infer<typeof dashRowSchema>;

export const dashListKeySchema = z.enum([
  'pr_to_po', // approved PR, balance still to order → po_create.entry
  'po_to_dc', // approved job-work / outsource PO, qty not yet sent → ospdc_create.entry
  'grn_qc', // purchase GRN + party GRN lines waiting for Incoming QC → qc_incoming.entry
  'so_to_plan', // SO / JWSO lines not fully planned → plan_create.entry
  'plan_to_pro', // plan ready for a Production Order → prodorder_create.entry
  'ops_ready', // job-card ops ready to run ("Ready for You") → op_entry.entry
  'ops_running', // ops started and still running, elapsed time → op_entry.entry
  'jc_running', // open job cards, late first → jc_create.view
  'po_overdue', // PO delivery past due → po_create.view
  'bom_pending', // equipment SO waiting for a BOM → bom_create.entry
  'capa_mine', // CAPA where the caller is responsible → capa_create.edit
  'qc_report_missing', // ADR-252 QC entries saved without their report → qcdocs_upload.entry
]);
export type DashListKey = z.infer<typeof dashListKeySchema>;

export const dashListSchema = z.object({
  key: dashListKeySchema,
  title: z.string(),
  /** Department the list belongs to — orders blocks (main dept first). */
  dept: z.string(),
  /** Column headers: [document, item, qty, status]. */
  head: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  /** Every matching row — the same figure as the cue and the target page. */
  total: z.number().int().nonnegative(),
  /** First page (25), late first then oldest. */
  rows: z.array(dashRowSchema),
  /** Page with the full list. */
  href: z.string(),
});
export type DashList = z.infer<typeof dashListSchema>;

export const dashCueSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  sub: z.string(),
  tone: dashToneSchema,
  href: z.string().nullable(),
});
export type DashCue = z.infer<typeof dashCueSchema>;

export const dashTodoRowSchema = z.object({
  taskId: z.string().uuid(),
  taskCode: z.string(),
  title: z.string(),
  ref: z.object({ code: z.string(), href: z.string() }).nullable(),
  dueDate: z.string().nullable(), // YYYY-MM-DD (IST)
  unread: z.boolean(),
});
export type DashTodoRow = z.infer<typeof dashTodoRowSchema>;

export const dashDoneRowSchema = z.object({
  ts: z.string(), // ISO; shown as IST hh:mm
  action: z.string(), // activity_log.action
  text: dashTextSchema,
});
export type DashDoneRow = z.infer<typeof dashDoneRowSchema>;

export const dashNoteSchema = z.object({
  key: z.string(),
  ts: z.string(), // ISO of the event
  tone: dashToneSchema,
  text: dashTextSchema,
  /** After the caller's last "seen" time. */
  unseen: z.boolean(),
});
export type DashNote = z.infer<typeof dashNoteSchema>;

export const homeResponseSchema = z.object({
  userName: z.string(),
  role: z.string(),
  dateLabel: z.string(),
  greetingPart: z.string(), // morning | afternoon | evening
  isAdmin: z.boolean(),
  /** Access Control main department, or the derived fallback (highest tier,
   *  then the fixed order) used to put that department's blocks first. */
  mainDept: z.string().nullable(),
  headline: dashTextSchema,
  cues: z.array(dashCueSchema),
  /** Null when the caller holds no Approve tick → the block is not shown.
   *  Same rows and rules as GET /approvals/inbox (one source). */
  approvals: approvalInboxResponseSchema.nullable(),
  /** Documents the caller raised that are waiting for someone else's approval. */
  sentForApproval: z.array(dashRowSchema),
  lists: z.array(dashListSchema),
  /** The caller's own documents whose next step is someone else's (first 25). */
  waiting: z.array(dashRowSchema),
  /** Every waiting document — the cue figure. */
  waitingTotal: z.number().int().nonnegative(),
  todo: z.object({
    late: z.array(dashTodoRowSchema),
    today: z.array(dashTodoRowSchema),
    planned: z.array(dashTodoRowSchema),
  }),
  /** Newest 50 per day; the totals count every entry of that IST day. */
  done: z.object({
    today: z.array(dashDoneRowSchema),
    yesterday: z.array(dashDoneRowSchema),
    todayTotal: z.number().int().nonnegative(),
    yesterdayTotal: z.number().int().nonnegative(),
  }),
  /** Dashboard-only notifications (no email). Empty for Full Access admins. */
  notifications: z.object({
    items: z.array(dashNoteSchema),
    unseen: z.number().int().nonnegative(),
    seenAt: z.string().nullable(),
  }),
  quickLinks: z.array(z.string()), // page keys the user can see (after access + selection)
});
export type HomeResponse = z.infer<typeof homeResponseSchema>;

// GET /dashboard/home?scope= — the My department / Mine switch. The server
// applies it to every list and to the totals, so a count always equals its list.
export const homeScopeSchema = z.enum(['dept', 'mine']);
export type HomeScope = z.infer<typeof homeScopeSchema>;
export const homeQuerySchema = z.object({ scope: homeScopeSchema.default('dept') });
export type HomeQuery = z.input<typeof homeQuerySchema>;

// POST /dashboard/notifications/seen — moves the caller's "seen" time forward
// (never back: the server keeps the later of the stored and the sent time).
export const markNotificationsSeenInputSchema = z.object({ seenAt: z.string().datetime() });
export type MarkNotificationsSeenInput = z.infer<typeof markNotificationsSeenInputSchema>;

// ── Widgets (Widgets view) ──
export const widgetStatSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  tone: z.string().nullable(),
});
export const widgetBarSchema = z.object({
  label: z.string(),
  pct: z.number().int(),
  tone: z.string(),
});
export const widgetRowSchema = z.object({ left: z.string(), mid: z.string(), right: z.string() });
export const widgetDataSchema = z.object({
  key: z.string(),
  label: z.string(),
  icon: z.string(),
  color: z.string(),
  dept: z.string().nullable(),
  navPage: z.string(),
  emptyText: z.string().nullable(),
  stats: z.array(widgetStatSchema),
  bars: z.array(widgetBarSchema),
  rows: z.array(widgetRowSchema),
});
export type WidgetData = z.infer<typeof widgetDataSchema>;
export const listWidgetsResponseSchema = z.object({ widgets: z.array(widgetDataSchema) });
export type ListWidgetsResponse = z.infer<typeof listWidgetsResponseSchema>;

// ── Config (Customize) ──
export const dashboardConfigSchema = z.object({
  widgets: z.array(z.string()).nullable(), // ordered widget keys; null = all
  quickLinks: z.array(z.string()).nullable(), // page keys; null = all accessible
});
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export const saveDashboardConfigInputSchema = z.object({
  widgets: z.array(z.string().max(64)).max(64),
  quickLinks: z.array(z.string().max(64)).max(128),
});
export type SaveDashboardConfigInput = z.infer<typeof saveDashboardConfigInputSchema>;

// Registry entry metadata (so the Customize chooser can render labels/access).
export const registryWidgetSchema = z.object({
  key: z.string(),
  label: z.string(),
  desc: z.string(),
  icon: z.string(),
  color: z.string(),
  dept: z.string().nullable(),
  navPage: z.string(),
  hasAccess: z.boolean(),
});
export const registryQuickLinkSchema = z.object({
  page: z.string(),
  label: z.string(),
  icon: z.string(),
  color: z.string(),
  dept: z.string().nullable(),
  hasAccess: z.boolean(),
});
export const dashboardConfigScreenSchema = z.object({
  config: dashboardConfigSchema,
  widgets: z.array(registryWidgetSchema),
  quickLinks: z.array(registryQuickLinkSchema),
});
export type DashboardConfigScreen = z.infer<typeof dashboardConfigScreenSchema>;
export type RegistryWidget = z.infer<typeof registryWidgetSchema>;
export type RegistryQuickLink = z.infer<typeof registryQuickLinkSchema>;
