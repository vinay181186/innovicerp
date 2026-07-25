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
  jobCardId: z.string().uuid().optional(),
  partyMaterialId: z.string().uuid(),
  qty: z.number().int().positive(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreatePartyMaterialIssueInput = z.infer<typeof createPartyMaterialIssueInputSchema>;

export const listPartyMaterialIssuesResponseSchema = z.object({
  items: z.array(partyMaterialIssueListItemSchema),
  total: z.number().int().nonnegative(),
});
export type ListPartyMaterialIssuesResponse = z.infer<
  typeof listPartyMaterialIssuesResponseSchema
>;
