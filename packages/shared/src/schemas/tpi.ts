// TPI (Third Party Inspection) read shapes (QC Wave 3).
//
// Mirrors legacy renderTPI (HTML L21381). TPI ops = QC ops whose operation
// name contains "TPI". Read-only here; the submit reuses op-entry submitQcLog
// with isTpi + tpi metadata (persisted on op_log, migration 0037).

import { z } from 'zod';

export const tpiPendingRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for the part awaiting third-party
   *  inspection, read off the SO line the job card was raised against
   *  (job_cards.source_so_line_id → sales_order_lines.revision). Null when the
   *  card has no SO behind it (JW-sourced or standalone, or an SO line since
   *  deleted), and null must show as the bare item code. It is deliberately
   *  NOT items.revision, which describes the item master — a TPI inspector
   *  given the wrong drawing revision is the exact failure this field exists
   *  to prevent. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  operation: z.string(),
  orderQty: z.number().int(),
  qcPending: z.number().int().nonnegative(),
  callDate: z.string().nullable(),
  waitDays: z.number().int().nonnegative(),
});
export type TpiPendingRow = z.infer<typeof tpiPendingRowSchema>;

export const tpiCompletedRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision the inspection was carried out against,
   *  read off the SO line behind the job card (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null for JW-sourced and standalone cards,
   *  which render the bare item code. Never items.revision. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  operation: z.string(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  callDate: z.string().nullable(),
  attendedDate: z.string(),
  respDays: z.number().int().nullable(),
  inspector: z.string().nullable(),
  organization: z.string().nullable(),
  certNo: z.string().nullable(),
  // QC report attachment (migration 0043) — Storage path + file name for the
  // TPI report (legacy _tpiAttachReport, HTML L21492).
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
});
export type TpiCompletedRow = z.infer<typeof tpiCompletedRowSchema>;

export const tpiResponseSchema = z.object({
  pending: z.array(tpiPendingRowSchema),
  completed: z.array(tpiCompletedRowSchema),
});
export type TpiResponse = z.infer<typeof tpiResponseSchema>;
