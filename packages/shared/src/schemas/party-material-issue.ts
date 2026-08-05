// Party Material Issue shared schemas (ADR-079 — job-work cycle completion).
//
// Issues client-supplied ("party") material to a Job Card for in-house
// machining. Debits the separate party stock (party_materials.stock_qty↓,
// issued_qty↑) — never touches own-stock store_transactions. Numbering:
// IN-PMI-#####.

import { z } from 'zod';

export const partyMaterialIssueSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  issueDate: z.string(),
  jobWorkOrderId: z.string().uuid().nullable(),
  jwCodeText: z.string().nullable(),
  jobCardId: z.string().uuid().nullable(),
  jcCodeText: z.string().nullable(),
  partyMaterialId: z.string().uuid(),
  partyMaterialCodeText: z.string().nullable(),
  partyMaterialName: z.string().nullable(),
  qty: z.number().int().positive(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PartyMaterialIssue = z.infer<typeof partyMaterialIssueSchema>;

export const partyMaterialIssueListItemSchema = partyMaterialIssueSchema.extend({
  /** Live remaining party stock for the material after this issue. */
  materialStockQty: z.number().int().nonnegative().nullable(),
});
export type PartyMaterialIssueListItem = z.infer<typeof partyMaterialIssueListItemSchema>;

export const createPartyMaterialIssueInputSchema = z.object({
  code: z.string().trim().max(40).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderId: z.string().uuid(),
  /** ADR-103: REQUIRED. The issue carries no JWSO-line column, so the job card
   *  is the only thing that says WHICH part the material went to — and the
   *  first-op material gate reads exactly this. While it was optional, a blank
   *  job card made the issue invisible to the gate: material was issued, yet
   *  the operator stayed blocked with no explanation. */
  jobCardId: z.string().uuid(),
  partyMaterialId: z.string().uuid(),
  qty: z.number().int().positive(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreatePartyMaterialIssueInput = z.infer<typeof createPartyMaterialIssueInputSchema>;

export const cancelPartyMaterialIssueInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelPartyMaterialIssueInput = z.infer<typeof cancelPartyMaterialIssueInputSchema>;

export const listPartyMaterialIssuesResponseSchema = z.object({
  items: z.array(partyMaterialIssueListItemSchema),
  total: z.number().int().nonnegative(),
});
export type ListPartyMaterialIssuesResponse = z.infer<
  typeof listPartyMaterialIssuesResponseSchema
>;
