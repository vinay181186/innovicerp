// Tool Issue shared schemas — ADR-193 phase 4b (was PL-TI-1).
//
// A tool goes out to an Operator (picked) and is expected back. Bulk tools
// (drill bits, inserts) go by qty; serial instruments go by picking register
// rows (never by typing a qty). Return: Good goes back to stock; Consumed is
// normal wear (closed, no approval); Damaged / Lost become a write-off the
// Store In-charge approves (not the person who recorded it). Cancel only
// while nothing was returned. Numbering: TIS-NNNNN.

import { z } from 'zod';
import { STORE_ISSUE_REF_TYPES } from './store-issue';

// Kept for older imports (no longer used by the Tool Issue form).
export { STORE_ISSUE_REF_TYPES };

/** issued = nothing back yet · partial · returned = all accounted for ·
 *  cancelled. A pending write-off keeps its qty "out" until decided. */
export const TOOL_RETURN_STATUSES = ['issued', 'partial', 'returned', 'cancelled'] as const;
export type ToolReturnStatus = (typeof TOOL_RETURN_STATUSES)[number];
export const toolReturnStatusSchema = z.enum(TOOL_RETURN_STATUSES);

export const INSTRUMENT_RETURN_CONDITIONS = ['good', 'damaged', 'lost'] as const;
export type InstrumentReturnCondition = (typeof INSTRUMENT_RETURN_CONDITIONS)[number];

export const TOOL_WRITEOFF_KINDS = ['damaged', 'lost', 'scrap'] as const;
export type ToolWriteoffKind = (typeof TOOL_WRITEOFF_KINDS)[number];
export const TOOL_WRITEOFF_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ToolWriteoffStatus = (typeof TOOL_WRITEOFF_STATUSES)[number];

export const TOOL_REASON_MIN = 10;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty0 = z.number().nonnegative().multipleOf(0.001).default(0);
const reason = z
  .string()
  .trim()
  .min(TOOL_REASON_MIN, `Give a reason (at least ${TOOL_REASON_MIN} characters)`)
  .max(500);

// ─── Write inputs ─────────────────────────────────────────────────────────

export const createToolIssueInputSchema = z
  .object({
    issueDate: isoDate,
    expectedReturnDate: isoDate,
    itemId: z.string().uuid(),
    /** Bulk tools only. */
    qty: z.number().positive('Qty must be more than 0').multipleOf(0.001).optional(),
    /** Serial instruments only — the register rows handed out. */
    instrumentIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    operatorId: z.string().uuid().optional(),
    issuedToText: z.string().trim().max(255).optional(),
    jobCardId: z.string().uuid().optional(),
    purpose: z.string().trim().min(3, 'Enter the Purpose (at least 3 characters)').max(255),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.qty != null) !== (v.instrumentIds != null), {
    message: 'Give either a Qty (bulk tool) or the instruments (serial tool)',
    path: ['qty'],
  })
  .refine((v) => !v.instrumentIds || new Set(v.instrumentIds).size === v.instrumentIds.length, {
    message: 'An instrument is picked twice',
    path: ['instrumentIds'],
  })
  .refine((v) => Boolean(v.operatorId) || Boolean(v.issuedToText?.trim()), {
    message: 'Pick who received it (Operator) or type a name',
    path: ['operatorId'],
  })
  .refine((v) => v.expectedReturnDate >= v.issueDate, {
    message: 'Expected Return Date cannot be before the Issue Date',
    path: ['expectedReturnDate'],
  });
export type CreateToolIssueInput = z.infer<typeof createToolIssueInputSchema>;

/** Return of a BULK tool: split into good / damaged / lost / consumed. */
export const recordToolReturnInputSchema = z
  .object({
    returnDate: isoDate,
    goodQty: qty0,
    damagedQty: qty0,
    lostQty: qty0,
    consumedQty: qty0,
    /** Required when damaged or lost > 0. */
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.goodQty + v.damagedQty + v.lostQty + v.consumedQty > 0, {
    message: 'Enter at least one of Good / Damaged / Lost / Consumed',
  })
  .refine(
    (v) => v.damagedQty + v.lostQty === 0 || (v.reason?.trim().length ?? 0) >= TOOL_REASON_MIN,
    {
      message: `Damaged or Lost needs a reason (at least ${TOOL_REASON_MIN} characters)`,
      path: ['reason'],
    },
  );
export type RecordToolReturnInput = z.infer<typeof recordToolReturnInputSchema>;

/** Return of SERIAL instruments: one condition per instrument. */
export const returnInstrumentsInputSchema = z
  .object({
    returnDate: isoDate,
    instruments: z
      .array(
        z.object({
          instrumentId: z.string().uuid(),
          condition: z.enum(INSTRUMENT_RETURN_CONDITIONS),
        }),
      )
      .min(1)
      .max(100),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) =>
      v.instruments.every((i) => i.condition === 'good') ||
      (v.reason?.trim().length ?? 0) >= TOOL_REASON_MIN,
    {
      message: `Damaged or Lost needs a reason (at least ${TOOL_REASON_MIN} characters)`,
      path: ['reason'],
    },
  );
export type ReturnInstrumentsInput = z.infer<typeof returnInstrumentsInputSchema>;

export const cancelToolIssueInputSchema = z.object({ reason });
export type CancelToolIssueInput = z.infer<typeof cancelToolIssueInputSchema>;

export const decideToolWriteoffInputSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  remarks: z.string().trim().max(500).optional(),
});
export type DecideToolWriteoffInput = z.infer<typeof decideToolWriteoffInputSchema>;

// ─── Read shapes ───────────────────────────────────────────────────────────

export interface ToolIssueInstrumentRow {
  instrumentId: string;
  serialNo: string;
  returnedOn: string | null;
  returnCondition: InstrumentReturnCondition | null;
}

export interface ToolIssueReturnRow {
  id: string;
  returnDate: string;
  goodQty: number;
  damagedQty: number;
  lostQty: number;
  consumedQty: number;
  reason: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface ToolIssueListItem {
  id: string;
  code: string;
  issueDate: string;
  expectedReturnDate: string | null;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  uom: string | null;
  qty: number;
  /** Serial tools: the instrument serials on this issue (comma list). */
  serialNos: string | null;
  operatorId: string | null;
  issuedTo: string;
  jobCardId: string | null;
  jobCardCode: string | null;
  purpose: string | null;
  remarks: string | null;
  returnStatus: ToolReturnStatus;
  goodQty: number;
  damagedQty: number;
  lostQty: number;
  consumedQty: number;
  /** Damaged + Lost waiting for a write-off decision. */
  writeoffPendingQty: number;
  /** Still with the holder: qty − good − consumed − approved write-offs − pending write-offs. */
  stillOutQty: number;
  /** Not fully back and expectedReturnDate < today (IST). */
  isOverdue: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  issuedByName: string | null;
  createdAt: string;
}

export interface ToolIssueDetail extends ToolIssueListItem {
  instruments: ToolIssueInstrumentRow[];
  returns: ToolIssueReturnRow[];
}

// Kept for older imports.
export type ToolIssue = ToolIssueDetail;

export interface ToolWriteoffRow {
  id: string;
  kind: ToolWriteoffKind;
  status: ToolWriteoffStatus;
  itemId: string;
  itemCode: string;
  itemName: string | null;
  instrumentId: string | null;
  serialNo: string | null;
  toolIssueId: string | null;
  toolIssueCode: string | null;
  holder: string | null;
  qty: number;
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
  /** The requester cannot decide their own write-off. */
  requestedBy: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionRemarks: string | null;
}

export interface ToolHolderRow {
  holder: string;
  operatorId: string | null;
  itemCode: string;
  itemName: string | null;
  toolIssueId: string;
  toolIssueCode: string;
  stillOutQty: number;
  serialNos: string | null;
  expectedReturnDate: string | null;
  isOverdue: boolean;
}

// ─── Query filters ────────────────────────────────────────────────────────

export const listToolIssuesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | out (issued + partial) | overdue | returned | cancelled */
  filter: z.enum(['all', 'out', 'overdue', 'returned', 'cancelled']).default('all'),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListToolIssuesQuery = z.infer<typeof listToolIssuesQuerySchema>;

export const toolIssueSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  writeoffsPending: z.number().int().nonnegative(),
});
export type ToolIssueSummary = z.infer<typeof toolIssueSummarySchema>;

export interface ListToolIssuesResponse {
  items: ToolIssueListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: ToolIssueSummary;
}

export const listToolWriteoffsQuerySchema = z.object({
  status: z.enum(TOOL_WRITEOFF_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListToolWriteoffsQuery = z.infer<typeof listToolWriteoffsQuerySchema>;

export interface ListToolWriteoffsResponse {
  items: ToolWriteoffRow[];
  total: number;
}
