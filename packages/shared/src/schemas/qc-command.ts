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
  soCode: string | null;
  attempts: number;
  totalRejected: number;
  firstEntry: string | null;
  lastEntry: string | null;
  daysElapsed: number;
}

// ── Assignable inspector (Assign modal options) ──
export interface QcInspectorOption {
  id: string;
  name: string;
  role: string;
}

export interface QcCommandResponse {
  stats: QcCommandStats;
  queue: QcCommandQueueRow[];
  fpy: QcCommandFpy;
  rework: QcReworkRow[];
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
