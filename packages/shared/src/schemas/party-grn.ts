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
  // R2 (ADR-194): compulsory incoming QC. Only acceptedQty enters the party
  // store; rejectedQty is recorded with a reason and never becomes stock.
  acceptedQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  rejectReason: z.string().nullable(),
  qcBy: z.string().uuid().nullable(),
  /** ADR-203 (owner D4): QC is a SEPARATE step. Null = waiting for Incoming QC;
   *  accepted/rejected are 0 until then and nothing is in the register yet. */
  qcAt: z.string().nullable(),
  /** ADR-203 (owner D3): rejected pieces already sent back on a Customer
   *  Material Return. Held = rejectedQty − rejectedReturnedQty. */
  rejectedReturnedQty: z.number().int().nonnegative().default(0),
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
});
export type PartyGrn = z.infer<typeof partyGrnSchema>;

export const partyGrnListItemSchema = partyGrnSchema.extend({
  /** Joined client name (from clients.name) — falls back to client_code_text. */
  clientName: z.string().nullable(),
  /** Σ receivedQty (accepted + rejected + waiting for QC) across all lines. */
  totalReceivedQty: z.number().int().nonnegative(),
  /** ADR-203: Σ acceptedQty across all lines (what entered the register). */
  totalAcceptedQty: z.number().int().nonnegative().default(0),
  /** ADR-203: lines still waiting for Incoming QC. 0 = QC done. */
  qcPendingLines: z.number().int().nonnegative().default(0),
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
 *  the Incoming QC permission (qc_incoming · entry). One entry per line still
 *  waiting; accepted + rejected must equal received; a reason when anything is
 *  rejected. Only the accepted qty enters the customer-material register;
 *  rejected pieces are HELD until a Customer Material Return sends them back. */
export const partyGrnQcLineInputSchema = z
  .object({
    lineId: z.string().uuid(),
    acceptedQty: z.number().int().nonnegative(),
    rejectedQty: z.number().int().nonnegative(),
    rejectReason: z.string().trim().max(500).optional(),
  })
  .refine((l) => l.rejectedQty === 0 || (l.rejectReason?.length ?? 0) > 0, {
    message: 'A deviation reason is required when any quantity is deviated',
    path: ['rejectReason'],
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
  dcNo: z.string().trim().max(64).optional(),
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
