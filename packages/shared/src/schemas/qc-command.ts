// QC Command Center schemas. Backs the 5-tab QC control board
// (legacy renderQCCommandCenter HTML L18613). The analytics read derives
// First-Pass Yield + Rework from per-op QC op_log groups; Pick-Up / Assign
// write to qc_assignments (migration 0040). See docs/PARITY/qc-command-center.md.

import { z } from 'zod';

// ── Top stats strip ──
export interface QcCommandStats {
  pendingOps: number;
  overdue: number;
  oldestAgeDays: number;
  reworkItems: number; // pending ops on attempt > 1
  fpyPct: number; // overall first-pass yield %
}

// ── Queue tab: an enriched pending QC op ──
export interface QcCommandQueueRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string;
  itemCode: string | null;
  /** The customer's drawing revision for this op's part, read off the SO line
   *  the job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision) — the same LEFT JOIN that yields soCode, so
   *  the two are null together on a JW-sourced or standalone card. Null renders
   *  as the bare item code. Never items.revision, a different column about the
   *  item master that would hand an inspector the wrong drawing. */
  itemRevision: string | null;
  /** The customer's PO line number (`POL`) for the SO line behind this row.
   *  Null when there is none. Read-only — typed only on the Sales Order. */
  clientPoLineNo: string | null;
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: string | null;
  soCode: string | null;
  customer: string | null;
  pendingQty: number;
  ageDays: number;
  attemptNo: number; // 1 = first inspection, 2+ = rework
  isOverdue: boolean;
  dueDate: string | null;
  assignedTo: string | null; // inspector name snapshot, null = unassigned
}

// ── First-Pass Yield tab ──
export interface QcFpyGroupRow {
  name: string;
  total: number;
  passed: number;
  pct: number;
}
export interface QcFpyItemRow {
  code: string;
  name: string;
  total: number;
  passed: number;
  pct: number;
}
export interface QcCommandFpy {
  overallPct: number;
  total: number;
  passed: number;
  byOperation: QcFpyGroupRow[];
  byInspector: QcFpyGroupRow[];
  byItem: QcFpyItemRow[]; // lowest FPY first, top 10 (quality hot-spots)
}

// ── Rework tab ──
export interface QcReworkRow {
  jcOpId: string;
  jcCode: string;
  opSeq: number;
  operation: string;
  itemCode: string | null;
  /** The customer's drawing revision for the part being reworked, off the same
   *  SO-line LEFT JOIN as soCode (sales_order_lines.revision). Null together
   *  with soCode when no SO line stands behind the card; null shows the bare
   *  item code. Never items.revision. */
  itemRevision: string | null;
  /** The customer's PO line number (`POL`) for the SO line behind this row.
   *  Null when there is none. Read-only — typed only on the Sales Order. */
  clientPoLineNo: string | null;
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: string | null;
  soCode: string | null;
  attempts: number;
  totalRejected: number;
  firstEntry: string | null;
  lastEntry: string | null;
  daysElapsed: number;
}

// ── Rejection Pareto tab (legacy _qccRenderPareto L18833) — ALL NCs ──
export interface QcParetoRow {
  reason: string; // nc_register.reason_category value
  count: number; // NC count for this reason
  rejectedQty: number; // Σ rejected_qty
  pct: number; // % of total rejected qty
  topItems: string; // top-3 item codes for this reason, comma-joined
}
export interface QcCommandPareto {
  rows: QcParetoRow[]; // sorted by rejectedQty desc (rank order)
  totalCount: number;
  totalQty: number;
}

// ── Inspector Performance tab (legacy _qccRenderInspector L18873) — ALL QC ──
// Avg-Hrs/Inspection intentionally dropped (op_log has no hours column; legacy
// itself flagged it as mobile-entry-dependent).
export interface QcInspectorPerfRow {
  name: string;
  inspections: number; // count of QC op_log entries
  jcs: number; // distinct JCs inspected
  accepted: number; // Σ accepted qty
  rejected: number; // Σ rejected qty
  rejRate: number; // rejected / (accepted+rejected) %
  currentLoad: number; // active qc_assignments for this inspector
}

// ── Assignable inspector (Assign modal options) ──
export interface QcInspectorOption {
  id: string;
  name: string;
  role: string;
}

// ── Paging (ADR-201): every table on the board pages at 25 on the SERVER ──
// One aggregate read still builds every table over ALL rows (the stats strip,
// FPY %, Pareto totals and the counts below are whole-set figures); `limit`
// + the per-table offsets cut each table to the page on screen. No `limit` =
// every row, as before.
export const QC_QUEUE_SORTS = ['age', 'due', 'customer'] as const;
export type QcQueueSort = (typeof QC_QUEUE_SORTS)[number];
const qcOffset = z.coerce.number().int().nonnegative().default(0);
export const qcCommandQuerySchema = z.object({
  /** Queue order: oldest first (default), due date (blank last), customer A→Z. */
  queueSort: z.enum(QC_QUEUE_SORTS).default('age'),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  queueOffset: qcOffset,
  fpyOpOffset: qcOffset,
  fpyInspOffset: qcOffset,
  paretoOffset: qcOffset,
  inspectorOffset: qcOffset,
  reworkOffset: qcOffset,
});
export type QcCommandQuery = z.infer<typeof qcCommandQuerySchema>;
export type QcCommandQueryInput = z.input<typeof qcCommandQuerySchema>;

/** Row count of each table over ALL rows (not the page). */
export interface QcCommandTotals {
  queue: number;
  fpyByOperation: number;
  fpyByInspector: number;
  fpyByItem: number;
  pareto: number;
  inspectorPerf: number;
  rework: number;
}

export interface QcCommandResponse {
  stats: QcCommandStats;
  totals: QcCommandTotals;
  queue: QcCommandQueueRow[];
  fpy: QcCommandFpy;
  rework: QcReworkRow[];
  pareto: QcCommandPareto;
  inspectorPerf: QcInspectorPerfRow[];
  inspectors: QcInspectorOption[];
}

// ── Pick-Up / Assign mutations ──
export const qcPickUpInputSchema = z.object({
  jcOpId: z.string().uuid(),
});
export type QcPickUpInput = z.infer<typeof qcPickUpInputSchema>;

export const qcAssignInputSchema = z.object({
  jcOpId: z.string().uuid(),
  inspectorUserId: z.string().uuid(),
  note: z.string().max(500).optional(),
});
export type QcAssignInput = z.infer<typeof qcAssignInputSchema>;

export interface QcAssignmentResult {
  jcOpId: string;
  inspectorName: string;
}
