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
  qcAt: z.string().nullable(),
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
  /** Aggregate sum of receivedQty across all lines. */
  totalReceivedQty: z.number().int().nonnegative(),
  /** Number of line items. */
  linesCount: z.number().int().nonnegative(),
});
export type PartyGrnListItem = z.infer<typeof partyGrnListItemSchema>;

export const partyGrnDetailSchema = partyGrnListItemSchema.extend({
  lines: z.array(partyGrnLineSchema),
});
export type PartyGrnDetail = z.infer<typeof partyGrnDetailSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createPartyGrnLineInputSchema = z
  .object({
    partyMaterialId: z.string().uuid(),
    receivedQty: z.number().int().positive(),
    /** ADR-102: REQUIRED. Which JWSO line this material is for. Every downstream
     *  check keys off it — the order-qty cap here, and the first-op material gate
     *  in op-entry. While it was optional, leaving it blank silently disabled
     *  both. The service additionally verifies the line exists on that JWSO. */
    jwLineNoText: z.string().trim().min(1).max(64),
    /** R2 (ADR-194): incoming QC is COMPULSORY on every party GRN line — the
     *  receiver must split the received qty into accepted + rejected here.
     *  acceptedQty + rejectedQty must equal receivedQty; only acceptedQty
     *  enters the party store. A reason is required when anything is rejected. */
    acceptedQty: z.number().int().nonnegative(),
    rejectedQty: z.number().int().nonnegative().default(0),
    rejectReason: z.string().trim().max(500).optional(),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine((l) => l.acceptedQty + l.rejectedQty === l.receivedQty, {
    message: 'Accepted + Rejected must equal Received',
    path: ['acceptedQty'],
  })
  .refine((l) => l.rejectedQty === 0 || (l.rejectReason?.length ?? 0) > 0, {
    message: 'A reject reason is required when any quantity is rejected',
    path: ['rejectReason'],
  });
export type CreatePartyGrnLineInput = z.infer<typeof createPartyGrnLineInputSchema>;

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
