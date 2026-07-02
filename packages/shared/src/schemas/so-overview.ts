// SO Overview — high-level dashboard across all open SOs (PL-2).
//
// Read-only listing per legacy renderSOOverview (HTML L9112). One row per SO
// header with aggregated stage counters + overall status badge + per-line
// alert flags. Click-through to the per-SO drill-down lives at the PL-1
// /sales-orders/:id/status route (registered by the so-status module).
//
// Drives a single endpoint: GET /so-overview?status=<filter?>&search=<q?>.

import { z } from 'zod';
import { SO_STATUSES } from '../enums/so-status';

export const soOverviewQuerySchema = z.object({
  /** Status filter: open / closed / dispatched / cancelled / all (default open). */
  status: z.enum(['open', 'closed', 'dispatched', 'cancelled', 'all']).optional(),
  /** Free-text search across SO code, customer name, client PO number. */
  search: z.string().trim().min(1).max(100).optional(),
});
export type SoOverviewQuery = z.infer<typeof soOverviewQuerySchema>;

export const soOverallStatusEnum = z.enum([
  'not_started',
  'in_progress',
  'on_track',
  'delayed',
  'completed',
  'blocked',
]);
export type SoOverallStatus = z.infer<typeof soOverallStatusEnum>;

export const soOverviewStageCountsSchema = z.object({
  notReleased: z.number().int().nonnegative(),
  inProduction: z.number().int().nonnegative(),
  outsourced: z.number().int().nonnegative(),
  qualityCheck: z.number().int().nonnegative(),
  finished: z.number().int().nonnegative(),
  hold: z.number().int().nonnegative(),
});
export type SoOverviewStageCounts = z.infer<typeof soOverviewStageCountsSchema>;

export const soOverviewAlertsSchema = z.object({
  /** Qty currently sitting at an outsource vendor across all lines. */
  atVendorQty: z.number().int().nonnegative(),
  /** Number of ops awaiting QC across all lines. */
  qcPendingOps: z.number().int().nonnegative(),
  /** Number of lines past their due date and not yet finished. */
  delayedLines: z.number().int().nonnegative(),
});
export type SoOverviewAlerts = z.infer<typeof soOverviewAlertsSchema>;

export const soOverviewRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  soDate: z.string(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  type: z.enum(['component_manufacturing', 'equipment', 'with_material']),
  status: z.enum(SO_STATUSES),
  /** Earliest unfinished line due date (proxy for SO due date). */
  earliestDueDate: z.string().nullable(),
  bomMasterId: z.string().uuid().nullable(),
  /** Equipment SO: partName of the first line. Component SO: null. PL-2b §1.4. */
  equipmentItemName: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalRequiredQty: z.number().int().nonnegative(),
  totalDoneQty: z.number().int().nonnegative(),
  totalBalanceQty: z.number().int().nonnegative(),
  overallPct: z.number().int().min(0).max(100),
  overallStatus: soOverallStatusEnum,
  stageCounts: soOverviewStageCountsSchema,
  alerts: soOverviewAlertsSchema,
});
export type SoOverviewRow = z.infer<typeof soOverviewRowSchema>;

export const soOverviewSummarySchema = z.object({
  soCount: z.number().int().nonnegative(),
  notStartedCount: z.number().int().nonnegative(),
  inProgressCount: z.number().int().nonnegative(),
  onTrackCount: z.number().int().nonnegative(),
  delayedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
});
export type SoOverviewSummary = z.infer<typeof soOverviewSummarySchema>;

export const soOverviewResponseSchema = z.object({
  generatedAt: z.string(),
  /** Echoes the filter back for the UI state. */
  filter: z.object({
    status: z.string(),
    search: z.string().nullable(),
  }),
  summary: soOverviewSummarySchema,
  rows: z.array(soOverviewRowSchema),
});
export type SoOverviewResponse = z.infer<typeof soOverviewResponseSchema>;

// ─── Drill-down response (PL-2b §2 + §4) ─────────────────────────────────

/** Six-state stage label per per-item row. Mirrors LineStage from calc-engine. */
export const soOverviewItemStageEnum = z.enum([
  'not_released',
  'in_production',
  'outsourced',
  'quality_check',
  'finished',
  'hold',
]);
export type SoOverviewItemStage = z.infer<typeof soOverviewItemStageEnum>;

/** Per-item row in the drill view. For Equipment SOs each row is a BOM child;
 *  for Component SOs each row is an SO line. */
export const soOverviewChildRowSchema = z.object({
  /** Stable row id. For Equipment: childItemId. For Component: soLineId. */
  rowId: z.string().uuid(),
  /** Only set for Component drill. */
  lineNo: z.number().int().positive().nullable(),
  clientPoLineNo: z.string().nullable(),
  itemCode: z.string(),
  itemName: z.string(),
  stage: soOverviewItemStageEnum,
  status: soOverallStatusEnum,
  requiredQty: z.number().int().nonnegative(),
  issuedQty: z.number().int().nonnegative(),
  inProductionQty: z.number().int().nonnegative(),
  qcPendingQty: z.number().int().nonnegative(),
  atVendorQty: z.number().int().nonnegative(),
  completedQty: z.number().int().nonnegative(),
  balanceQty: z.number().int().nonnegative(),
  /** Currently-running OR next-up op name. null when no active op. */
  currentOpName: z.string().nullable(),
  /** Machine name if in production. */
  machineName: z.string().nullable(),
  /** Vendor name if outsourced. */
  vendorName: z.string().nullable(),
  /** 'Factory' / 'Vendor' / 'QC'. Drives the Machine/Vendor column rendering. */
  currentLocation: z.enum(['Factory', 'Vendor', 'QC']),
});
export type SoOverviewChildRow = z.infer<typeof soOverviewChildRowSchema>;

export const soOverviewDetailResponseSchema = z.object({
  generatedAt: z.string(),
  so: soOverviewRowSchema,
  /** true when this drill walks BOM children (Equipment + bomMasterId);
   *  false when it walks SO lines (Component / With Material / Equipment-no-BOM). */
  isEquipmentDrill: z.boolean(),
  bomNo: z.string().nullable(),
  bomRev: z.number().int().nullable(),
  childRows: z.array(soOverviewChildRowSchema),
});
export type SoOverviewDetailResponse = z.infer<typeof soOverviewDetailResponseSchema>;
