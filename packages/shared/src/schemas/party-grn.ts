// Party Material GRN shared schemas (Store slice 2).
//
// Records client-supplied raw material received against a JW order. Multi-line
// per receipt (one DC from a client may bring multiple materials). Mirrors
// legacy db.partyGrn (renderPartyGRN HTML L24251) + addPartyGRN (L24298).
// Numbering: PGRN-NNNNN.

import { z } from 'zod';

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

export const createPartyGrnLineInputSchema = z.object({
  partyMaterialId: z.string().uuid(),
  receivedQty: z.number().int().positive(),
  jwLineNoText: z.string().trim().max(64).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreatePartyGrnLineInput = z.infer<typeof createPartyGrnLineInputSchema>;

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
