// Party Material Master shared schemas (Store slice 1).
//
// Catalogue of raw materials supplied by clients for Job Work orders.
// Distinct from regular `items` master — these belong to the client.
// Mirrors legacy renderPartyMaterial (HTML L24129) + addPartyMaterial
// (L24173) + editPartyMaterial (L24214) + delPartyMaterial (L24233).
// Numbering: PM-NNNN.

import { z } from 'zod';

export const PARTY_MATERIAL_UOMS = ['NOS', 'KG', 'MTR', 'SET', 'LOT'] as const;
export type PartyMaterialUom = (typeof PARTY_MATERIAL_UOMS)[number];
export const partyMaterialUomSchema = z.enum(PARTY_MATERIAL_UOMS);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const partyMaterialSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  material: z.string().nullable(),
  uom: z.string(),
  clientId: z.string().uuid().nullable(),
  clientCodeText: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  stockQty: z.number().int().nonnegative(),
  issuedQty: z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PartyMaterial = z.infer<typeof partyMaterialSchema>;

export const partyMaterialListItemSchema = partyMaterialSchema.extend({
  /** Joined client name (from clients.name) — falls back to client_code_text. */
  clientName: z.string().nullable(),
  /** Joined item code (from items.code) — null when not linked to items master. */
  itemCode: z.string().nullable(),
});
export type PartyMaterialListItem = z.infer<typeof partyMaterialListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createPartyMaterialInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^PM-\d{4,}$/, 'Code must match PM-NNNN'),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  material: z.string().trim().max(100).optional(),
  uom: partyMaterialUomSchema.default('NOS'),
  clientId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
});
export type CreatePartyMaterialInput = z.infer<typeof createPartyMaterialInputSchema>;

export const updatePartyMaterialInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).optional(),
  material: z.string().trim().max(100).optional(),
  uom: partyMaterialUomSchema.optional(),
  clientId: z.string().uuid().optional(),
  itemId: z.string().uuid().nullable().optional(),
});
export type UpdatePartyMaterialInput = z.infer<typeof updatePartyMaterialInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listPartyMaterialsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  clientId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListPartyMaterialsQuery = z.infer<typeof listPartyMaterialsQuerySchema>;

export interface ListPartyMaterialsResponse {
  items: PartyMaterialListItem[];
  total: number;
  limit: number;
  offset: number;
}
