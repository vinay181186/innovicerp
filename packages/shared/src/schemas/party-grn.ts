// Party Material GRN shared schemas (Store slice 2).
//
// Records client-supplied raw material received against a JW order. Multi-line
// per receipt (one DC from a client may bring multiple materials). Mirrors
// legacy db.partyGrn (renderPartyGRN HTML L24251) + addPartyGRN (L24298).
// Numbering: PGRN-NNNNN.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

// ─── Read shapes ───────────────────────────────────────────────────────────

export const partyGrnLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  partyGrnId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  partyMaterialId: z.string().uuid().nullable(),
  partyMaterialCodeText: z.string(),
  partyMaterialName: z.string().nullable(),
  receivedQty: z.number().int().positive(),
  jwLineNoText: z.string().nullable(),
  // R4 (ADR-194): real FK to the JWSO line (backfilled from jwLineNoText).
  jwLineId: z.string().uuid().nullable(),
  /** POL — the JWSO line's customer PO line number (ADR-236); null on
   *  lines saved before migration 0210. */
  clientPoLineNo: z.string().nullable().default(null),
  // R2 (ADR-194): compulsory incoming QC. Only acceptedQty enters the party
  // store; rejectedQty is recorded with a reason and never becomes stock.
  acceptedQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  rejectReason: z.string().nullable(),
  /** QC Remarks typed at Incoming QC (migration 0232) — any line, deviated or
   *  not. Not the gate-in `remarks` below. Null on lines inspected before. */
  qcRemarks: z.string().nullable().default(null),
  qcBy: z.string().uuid().nullable(),
  /** ADR-203 (owner D4): QC is a SEPARATE step. Null = waiting for Incoming QC;
   *  accepted/rejected are 0 until then and nothing is in the register yet. */
  qcAt: z.string().nullable(),
  /** ADR-203 (owner D3): rejected pieces already sent back on a Customer
   *  Material Return. Held = rejectedQty − rejectedReturnedQty. */
  rejectedReturnedQty: z.number().int().nonnegative().default(0),
  /** Partial Incoming QC (0233): QC Pending Qty = received − accepted −
   *  rejected, computed by the server. 0 = the line is fully inspected. */
  qcPendingQty: z.number().int().nonnegative().default(0),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PartyGrnLine = z.infer<typeof partyGrnLineSchema>;

export const partyGrnSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  grnDate: z.string(),
  jobWorkOrderId: z.string().uuid().nullable(),
  jwCodeText: z.string().nullable(),
  clientId: z.string().uuid().nullable(),
  clientCodeText: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  dcNo: z.string().nullable(),
  remarks: z.string().nullable(),
  receivedByText: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  /** ADR-235 — set when the GRN was cancelled (it stays visible as Cancelled;
   *  deletedAt is stamped too, so every live reader keeps skipping it). */
  cancelReason: z.string().nullable().default(null),
  cancelledAt: z.string().nullable().default(null),
});
export type PartyGrn = z.infer<typeof partyGrnSchema>;

export const partyGrnListItemSchema = partyGrnSchema.extend({
  /** Joined client name (from clients.name) — falls back to client_code_text. */
  clientName: z.string().nullable(),
  /** Σ receivedQty (accepted + rejected + waiting for QC) across all lines. */
  totalReceivedQty: z.number().int().nonnegative(),
  /** ADR-203: Σ acceptedQty across all lines (what entered the register). */
  totalAcceptedQty: z.number().int().nonnegative().default(0),
  /** Lines with QC Pending Qty > 0 (untouched or part-inspected, 0233).
   *  0 = QC done. */
  qcPendingLines: z.number().int().nonnegative().default(0),
  /** Σ QC Pending Qty (received − accepted − rejected) across all lines. */
  totalQcPendingQty: z.number().int().nonnegative().default(0),
  /** Number of line items. */
  linesCount: z.number().int().nonnegative(),
});
export type PartyGrnListItem = z.infer<typeof partyGrnListItemSchema>;

export const partyGrnDetailSchema = partyGrnListItemSchema.extend({
  lines: z.array(partyGrnLineSchema),
});
export type PartyGrnDetail = z.infer<typeof partyGrnDetailSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createPartyGrnLineInputSchema = z.object({
  /** ADR-203: the JWSO line this material is for (real id). The customer
   *  material itself comes from that line (its `<item>-RM` party material) —
   *  it is not picked separately, so it can never mismatch the part. */
  jwLineId: z.string().uuid(),
  receivedQty: z.number().int().positive(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreatePartyGrnLineInput = z.infer<typeof createPartyGrnLineInputSchema>;

/** ADR-203 (owner D4): Incoming QC on a Party GRN — a separate step, gated by
 *  the Incoming QC permission (qc_incoming · entry). Partial QC (0233, owner
 *  2026-10-31): one entry per line with QC Pending Qty > 0; 0 < accepted +
 *  rejected <= QC Pending Qty (the server checks the limit under the JWSO-line
 *  lock); the line's totals ADD UP; a reason when anything is rejected. Only the accepted qty enters the customer-material register;
 *  rejected pieces are HELD until a Customer Material Return sends them back. */
export const partyGrnQcLineInputSchema = z
  .object({
    lineId: z.string().uuid(),
    acceptedQty: z.number().int().nonnegative(),
    rejectedQty: z.number().int().nonnegative(),
    rejectReason: z.string().trim().max(500).optional(),
    /** QC Remarks (migration 0232) — optional on every line. Same length as
     *  the Direct Purchase GRN's qcRemarks. */
    qcRemarks: z.string().trim().max(2000).optional(),
  })
  .refine((l) => l.rejectedQty === 0 || (l.rejectReason?.length ?? 0) > 0, {
    message: 'A deviation reason is required when any quantity is deviated',
    path: ['rejectReason'],
  })
  .refine((l) => l.acceptedQty + l.rejectedQty > 0, {
    message: 'Enter the Accepted and/or Deviated qty',
    path: ['acceptedQty'],
  });
export const partyGrnQcInputSchema = z.object({
  lines: z.array(partyGrnQcLineInputSchema).min(1),
});
export type PartyGrnQcInput = z.infer<typeof partyGrnQcInputSchema>;

export const cancelPartyGrnInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelPartyGrnInput = z.infer<typeof cancelPartyGrnInputSchema>;

export const createPartyGrnInputSchema = z.object({
  grnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderId: z.string().uuid(),
  /** The customer's challan number — required, and not already on another live
   *  Party GRN of the same customer (server check; a cancelled GRN frees it). */
  dcNo: z.string().trim().min(1, 'Customer Challan No. is required.').max(64),
  remarks: z.string().trim().max(500).optional(),
  lines: z.array(createPartyGrnLineInputSchema).min(1),
});
export type CreatePartyGrnInput = z.infer<typeof createPartyGrnInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listPartyGrnQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  jobWorkOrderId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  /** ADR-235 — 'true' adds Cancelled GRNs to the list (the list screen only;
   *  every other reader keeps live GRNs alone). */
  includeCancelled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListPartyGrnQuery = z.infer<typeof listPartyGrnQuerySchema>;

export interface ListPartyGrnResponse {
  items: PartyGrnListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    totalGrns: number;
    totalReceived: number;
    today: number;
  };
}
