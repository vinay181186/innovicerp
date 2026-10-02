// QC History read shapes (QC Wave 2).
//
// Mirrors legacy renderQCHistory (HTML L23531): pending QC ops + completed QC
// log entries + tracking stats. Read-only over op_log (log_type='qc') +
// v_jc_op_status. No migration.

import { z } from 'zod';
import type { IncomingQcCompletedRow, IncomingQcPendingRow } from './incoming-qc';
import { sfRawParamSchema } from './list-query';

export const qcHistoryPendingRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for this op's part, read off the SO line
   *  the job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null whenever the card has no SO behind it —
   *  a JW-sourced or standalone card, or an SO line since deleted — and null
   *  must render as the bare item code, never as a dangling slash. It is never
   *  items.revision, a different column about the item master: showing that to
   *  an inspector would be a plausible-looking lie about which drawing to
   *  check against. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  /** True when this QC op is the job card's LAST live op — the terminal QC
   *  gate that credits finished stock (ADR-069). The QC Call Register's stage
   *  strip files these under "Final Inspection" and every other process QC
   *  under "In-Process" (ADR-169). Defaulted so older API builds still parse. */
  isLastOp: z.boolean().default(false),
  operation: z.string(),
  orderQty: z.number().int(),
  completed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcRejected: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  pendSince: z.string().nullable(),
  overdue: z.boolean(),
  // Legacy renderQCDashboard L4135/L4140: client PO line tag + QC call date.
  clientPoLineNo: z.string().nullable(),
  qcCallDate: z.string().nullable(),
  /** The inspector this call is assigned to on QC Command (qc_assignments,
   *  0040) — the same name and field QC Command's queue shows. Null =
   *  unassigned. ADR-190. */
  assignedTo: z.string().nullable().default(null),
});
export type QcHistoryPendingRow = z.infer<typeof qcHistoryPendingRowSchema>;

export const qcHistoryLogRowSchema = z.object({
  logId: z.string().uuid(),
  /** The card the log belongs to, so a completed row can open the JC status
   *  page directly (ADR-169). Nullable + defaulted so older API builds parse. */
  jobCardId: z.string().uuid().nullable().default(null),
  jcCode: z.string(),
  opSeq: z.number().int(),
  /** True when this QC op is the job card's LAST live op — the terminal QC
   *  gate that credits finished stock (ADR-069). The QC Call Register's stage
   *  strip files these under "Final Inspection" and every other process QC
   *  under "In-Process" (ADR-169). Defaulted so older API builds still parse. */
  isLastOp: z.boolean().default(false),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for the inspected part, read off the SO
   *  line the job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null on a JW-sourced or standalone card, and
   *  null renders as the bare item code. Never items.revision — that column
   *  describes the item master and would put the wrong drawing revision in
   *  front of whoever reads the QC log back. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to, shown beside the item code on every downstream document (user rule,
   *  2026-09-23). Null when no SO line sits behind the row. Read-only — the
   *  Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  operation: z.string(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  logDate: z.string(),
  /** ISO timestamp the QC log was recorded (for time-ordering the completed feed). */
  loggedAt: z.string(),
  shift: z.string().nullable(),
  inspector: z.string().nullable(),
  remarks: z.string().nullable(),
  // Legacy renderQCDashboard L4215/L4198: completion log no (mono) + the op's
  // QC call date so the card can show Called → Attended — Response: N days.
  logNo: z.string(),
  qcCallDate: z.string().nullable(),
  // QC report attachment (migration 0043) — Storage path + file name when the
  // inspector attached a report (legacy L4216 📎 download link).
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
});
export type QcHistoryLogRow = z.infer<typeof qcHistoryLogRowSchema>;

export const qcHistoryStatsSchema = z.object({
  pendingOps: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  totalEntries: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
});
export type QcHistoryStats = z.infer<typeof qcHistoryStatsSchema>;

export const qcHistoryResponseSchema = z.object({
  stats: qcHistoryStatsSchema,
  pending: z.array(qcHistoryPendingRowSchema),
  logs: z.array(qcHistoryLogRowSchema),
});
export type QcHistoryResponse = z.infer<typeof qcHistoryResponseSchema>;

// ── Paged lists (ADR-201) ──────────────────────────────────────────────────
// QC History shows 25 rows per page on each table; search, the date range and
// Sort & Filter run on the SERVER over every row, and the totals come back with
// the page. GET /qc-history (the whole feed above) stays for older callers.

const qcSearchParam = z.string().trim().max(100).optional();
const ymdParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
const limitParam = z.coerce.number().int().positive().max(200).default(50);
const offsetParam = z.coerce.number().int().nonnegative().default(0);

/** GET /qc-history/pending — QC Pending ops, one page. */
export const listQcPendingQuerySchema = z.object({
  /** JC, SO, POL, item code / revision / name, operation. */
  search: qcSearchParam,
  sf: sfRawParamSchema,
  limit: limitParam,
  offset: offsetParam,
});
export type ListQcPendingQuery = z.infer<typeof listQcPendingQuerySchema>;

/** GET /qc-history/logs — completed QC entries, one page (no 500-row cap). */
export const listQcLogsQuerySchema = z.object({
  search: qcSearchParam,
  /** QC date range (log_date), inclusive. */
  dateFrom: ymdParam,
  dateTo: ymdParam,
  sf: sfRawParamSchema,
  limit: limitParam,
  offset: offsetParam,
});
export type ListQcLogsQuery = z.infer<typeof listQcLogsQuerySchema>;

export interface QcPendingListResponse {
  items: QcHistoryPendingRow[];
  total: number;
}
export interface QcLogsListResponse {
  items: QcHistoryLogRow[];
  total: number;
}

// ── QC Call Register (ADR-201) ─────────────────────────────────────────────
// One register of incoming (GRN line) calls and process (job-card op) calls,
// paged 25 at a time on the server. Pending: incoming calls first (oldest GRN
// first), then process calls (latest QC call first). Completed: both kinds
// interleaved, newest inspection first.

export const QC_REGISTER_STAGES = ['incoming', 'inprocess', 'final'] as const;
export type QcRegisterStage = (typeof QC_REGISTER_STAGES)[number];

export const qcRegisterQuerySchema = z.object({
  view: z.enum(['pending', 'completed']).default('pending'),
  /** Omitted = every stage. */
  stage: z.enum(QC_REGISTER_STAGES).optional(),
  search: qcSearchParam,
  /** 'true' = only the pending process calls QC Command assigned to the caller. */
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** One pending process call (the Inspect popup / ?op= deep link). */
  jcOpId: z.string().uuid().optional(),
  /** One pending incoming call (the Inspect popup / ?line= deep link). */
  grnLineId: z.string().uuid().optional(),
  limit: limitParam,
  offset: offsetParam,
});
export type QcRegisterQuery = z.input<typeof qcRegisterQuerySchema>;

export type QcRegisterPendingItem =
  | { kind: 'op'; row: QcHistoryPendingRow }
  | { kind: 'inc'; row: IncomingQcPendingRow };
export type QcRegisterCompletedItem =
  | { kind: 'op'; row: QcHistoryLogRow }
  | { kind: 'inc'; row: IncomingQcCompletedRow };

export interface QcRegisterStageSummary {
  /** Open calls in this stage. */
  pendingCount: number;
  /** Σ pending pieces over this stage's open calls. */
  pcsPending: number;
  /** Completed entries in this stage. */
  doneCount: number;
}

/** Whole-register figures (not narrowed by search / stage / Mine). */
export interface QcRegisterSummary {
  stages: Record<QcRegisterStage, QcRegisterStageSummary>;
  pendingCount: number;
  completeCount: number;
  pcsPending: number;
}

export interface QcRegisterResponse<T = QcRegisterPendingItem | QcRegisterCompletedItem> {
  items: T[];
  /** Rows matching view + stage + search + Mine (all pages). */
  total: number;
  summary: QcRegisterSummary;
}
