// Dashboard (home landing page) shared schemas + UI registries. Mirror of
// legacy renderHome (HTML L2486) and its sub-views. Distinct from dashboard.ts
// (the role-filtered KPI tiles) and production-dashboard (renderDashboard).
//
// The home is role-aware: admin / operator / specialist layouts, plus Alerts
// (reuses /alerts), Widgets, and Customize views. Everything is computed
// server-side; the web renders the returned payload.

import { z } from 'zod';

// ── Work List (My Work) item — legacy _buildWorkList L3196 ──
export const workListSeveritySchema = z.enum(['critical', 'warn', 'info']);
export type WorkListSeverity = z.infer<typeof workListSeveritySchema>;

export const workListItemSchema = z.object({
  key: z.string(),
  dept: z.string(),
  severity: workListSeveritySchema,
  icon: z.string(),
  title: z.string(),
  detail: z.string(),
  age: z.number().int(), // days
  actionLabel: z.string(),
  navPage: z.string(), // our route path
});
export type WorkListItem = z.infer<typeof workListItemSchema>;

// ── Needs Attention (admin) — legacy L2630 ──
export const attnItemSchema = z.object({
  icon: z.string(),
  label: z.string(),
  navPage: z.string(),
  severity: workListSeveritySchema,
});
export type AttnItem = z.infer<typeof attnItemSchema>;

// ── Operator layout rows ──
export const runningOpRowSchema = z.object({
  jcCode: z.string(),
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
  available: z.number().int(),
  dueDate: z.string().nullable(),
  isOverdue: z.boolean(),
});
export type ReadyOpRow = z.infer<typeof readyOpRowSchema>;

// ── Specialist layout ──
export const specialistKpiSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  sub: z.string(),
  color: z.string(),
  navPage: z.string(),
});
export type SpecialistKpi = z.infer<typeof specialistKpiSchema>;

export const specialistPanelRowSchema = z.object({
  cells: z.array(z.string()),
  navPage: z.string(),
});
export type SpecialistPanelRow = z.infer<typeof specialistPanelRowSchema>;

export const specialistPanelSchema = z.object({
  title: z.string(),
  titleColor: z.string().nullable(),
  headers: z.array(z.string()),
  rows: z.array(specialistPanelRowSchema),
  emptyText: z.string(),
});
export type SpecialistPanel = z.infer<typeof specialistPanelSchema>;

// ── Home response ──
export const homeLayoutSchema = z.enum(['admin', 'operator', 'specialist']);
export type HomeLayout = z.infer<typeof homeLayoutSchema>;

export const adminKpisSchema = z.object({
  activeSOs: z.number().int(),
  overdueSOs: z.number().int(),
  dueThisWeekSOs: z.number().int(),
  openJCs: z.number().int(),
  overdueJCs: z.number().int(),
  machsRunning: z.number().int(),
  machsTotal: z.number().int(),
  todayOutputQty: z.number().int(),
});
export type AdminKpis = z.infer<typeof adminKpisSchema>;

export const homeTodaySchema = z.object({
  grnReceived: z.number().int(),
  dispatches: z.number().int(),
  opsRunning: z.number().int(),
  opsCompleted: z.number().int(),
});
export type HomeToday = z.infer<typeof homeTodaySchema>;

export const homeOperatorSchema = z.object({
  myOutputQty: z.number().int(),
  myEntries: z.number().int(),
  readyCount: z.number().int(),
  allRunningCount: z.number().int(),
  running: z.array(runningOpRowSchema),
  ready: z.array(readyOpRowSchema),
});
export type HomeOperator = z.infer<typeof homeOperatorSchema>;

export const homeSpecialistSchema = z.object({
  dept: z.string(),
  kpis: z.array(specialistKpiSchema),
  panels: z.array(specialistPanelSchema),
});
export type HomeSpecialist = z.infer<typeof homeSpecialistSchema>;

export const homeResponseSchema = z.object({
  userName: z.string(),
  role: z.string(),
  dateLabel: z.string(),
  greetingPart: z.string(), // morning | afternoon | evening
  layout: homeLayoutSchema,
  primaryDept: z.string().nullable(),
  isAdmin: z.boolean(),
  workList: z.array(workListItemSchema),
  kpis: adminKpisSchema.nullable(),
  today: homeTodaySchema.nullable(),
  needsAttention: z.array(attnItemSchema).nullable(),
  operator: homeOperatorSchema.nullable(),
  specialist: homeSpecialistSchema.nullable(),
  quickLinks: z.array(z.string()), // page keys the user can see (after access + selection)
});
export type HomeResponse = z.infer<typeof homeResponseSchema>;

// ── Widgets (Widgets view) ──
export const widgetStatSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  tone: z.string().nullable(),
});
export const widgetBarSchema = z.object({ label: z.string(), pct: z.number().int(), tone: z.string() });
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
