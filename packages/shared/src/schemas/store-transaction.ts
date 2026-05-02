// Store Transaction shared schemas (T-036d).
//
// Read-only ledger view. store_transactions is append-only per ADR-015 #4 —
// rows are written exclusively by service-layer cascades (today: GRN QC accept
// in T-036c; future: dispatch, JW out/in, manual adjusts). No write input
// schemas — corrections happen via reversing entries.
//
// Two read shapes:
//   - StoreTransactionListItem: ledger row + display joins (item_code,
//     item_name) for the list view.
//   - ItemBalance: per-item current on-hand from v_item_stock, used by the
//     items master "Stock" badge and the Stock history card.

import { z } from 'zod';
import { STORE_TXN_SOURCE_TYPES } from '../enums/store-txn-source-type';
import { STORE_TXN_TYPES } from '../enums/store-txn-type';

export const storeTxnTypeSchema = z.enum(STORE_TXN_TYPES);
export const storeTxnSourceTypeSchema = z.enum(STORE_TXN_SOURCE_TYPES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const storeTransactionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  txnDate: z.string(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  txnType: storeTxnTypeSchema,
  qty: z.number().int().nonnegative(),
  sourceType: storeTxnSourceTypeSchema,
  sourceRef: z.string(),
  stockBefore: z.number().int(),
  stockAfter: z.number().int(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type StoreTransaction = z.infer<typeof storeTransactionSchema>;

/** List row: ledger fields + display joins for the item master. */
export const storeTransactionListItemSchema = storeTransactionSchema.extend({
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
});
export type StoreTransactionListItem = z.infer<typeof storeTransactionListItemSchema>;

/** Per-item current on-hand snapshot from v_item_stock. */
export interface ItemBalance {
  itemId: string;
  onHand: number;
}

// ─── Query filters ─────────────────────────────────────────────────────────

export const listStoreTransactionsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches source_ref / remarks
  itemId: z.string().uuid().optional(),
  txnType: storeTxnTypeSchema.optional(),
  sourceType: storeTxnSourceTypeSchema.optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListStoreTransactionsQuery = z.infer<typeof listStoreTransactionsQuerySchema>;

export interface ListStoreTransactionsResponse {
  items: StoreTransactionListItem[];
  total: number;
  limit: number;
  offset: number;
}
