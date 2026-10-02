// Party Stock Ledger shared schemas (migration 0173, ADR-194).
//
// Q6 decision: customer-supplied (party) material is kept in a SEPARATE store at
// ZERO value. It is never company stock (ADR-189) and never touches
// store_transactions. Every party-material movement is one append-only row here:
//   receive  (in)  — accepted qty from a Party GRN line enters the party store
//   issue    (out) — client material issued to a Job Card
//   consume  (out) — booked as consumed against production
//   return   (out) — spare material returned to the customer
//   reversal (in/out) — a compensating entry that undoes a prior movement
// No value column: party material carries no rupee value on our books.

import { z } from 'zod';

export const PARTY_STOCK_MOVEMENTS = ['receive', 'issue', 'consume', 'return', 'reversal'] as const;
export type PartyStockMovement = (typeof PARTY_STOCK_MOVEMENTS)[number];
export const partyStockMovementSchema = z.enum(PARTY_STOCK_MOVEMENTS);

export const partyStockDirectionSchema = z.enum(['in', 'out']);
export type PartyStockDirection = z.infer<typeof partyStockDirectionSchema>;

export const partyStockLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  partyMaterialId: z.string().uuid(),
  jwLineId: z.string().uuid().nullable(),
  movement: partyStockMovementSchema,
  direction: partyStockDirectionSchema,
  qty: z.number().int().positive(),
  balanceAfter: z.number().int(),
  sourceDocType: z.string(),
  sourceDocId: z.string().uuid().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PartyStockLedgerEntry = z.infer<typeof partyStockLedgerEntrySchema>;

export const partyStockLedgerListItemSchema = partyStockLedgerEntrySchema.extend({
  /** Joined party material code + name for display. */
  partyMaterialCode: z.string().nullable(),
  partyMaterialName: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type PartyStockLedgerListItem = z.infer<typeof partyStockLedgerListItemSchema>;

export const listPartyStockLedgerQuerySchema = z.object({
  partyMaterialId: z.string().uuid().optional(),
  jwLineId: z.string().uuid().optional(),
  movement: partyStockMovementSchema.optional(),
  /** ADR-201: the screen's search box, matched on the server over every
   *  column the ledger shows (material, movement, in/out, qty, balance,
   *  source doc, recorded by, date). */
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListPartyStockLedgerQuery = z.infer<typeof listPartyStockLedgerQuerySchema>;

export interface ListPartyStockLedgerResponse {
  items: PartyStockLedgerListItem[];
  total: number;
  limit: number;
  offset: number;
}
