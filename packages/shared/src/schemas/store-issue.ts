// Store Issue shared schemas (PL-II-1).
//
// Daily-use consumable register. Mirrors legacy renderIssueRegister (HTML
// L23874–23905) + addIssue (L23914). Numbering: ISS-NNNNN.
//
// Write cascades into store_transactions (existing append-only ledger) +
// decrements item.stockQty. Validation: qty must be > 0 and <= current
// stock (checked server-side).
//
// Two read shapes:
//   - StoreIssue (table row)
//   - StoreIssueListItem (+ joins on items for itemCode/itemName)

import { z } from 'zod';

export const STORE_ISSUE_REF_TYPES = [
  'Job Card',
  'SO',
  'Production',
  'Maintenance',
  'Other',
] as const;
export type StoreIssueRefType = (typeof STORE_ISSUE_REF_TYPES)[number];
export const storeIssueRefTypeSchema = z.enum(STORE_ISSUE_REF_TYPES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const storeIssueSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  issueDate: z.string(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemName: z.string(),
  qty: z.number().int().positive(),
  issuedTo: z.string(),
  refType: z.string().nullable(),
  refNo: z.string().nullable(),
  purpose: z.string().nullable(),
  remarks: z.string().nullable(),
  storeTransactionId: z.string().uuid().nullable(),
  /** ADR-189 (0152) — undone by an opposite ledger entry: who / when / why. */
  reversedAt: z.string().nullable().default(null),
  reversedBy: z.string().uuid().nullable().default(null),
  reversalReason: z.string().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type StoreIssue = z.infer<typeof storeIssueSchema>;

export const storeIssueListItemSchema = storeIssueSchema.extend({
  /** Joined item code (from items.code) — falls back to item_code_text. */
  itemCode: z.string().nullable(),
  /** Issued-by user display name (from users.name) for the legacy "Issued By" col. */
  issuedByName: z.string().nullable(),
});
export type StoreIssueListItem = z.infer<typeof storeIssueListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createStoreIssueInputSchema = z.object({
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemId: z.string().uuid(),
  qty: z.number().int().positive(),
  issuedTo: z.string().trim().min(1).max(255),
  refType: storeIssueRefTypeSchema.optional(),
  refNo: z.string().trim().max(64).optional(),
  // ADR-189 — every issue says what the material is for.
  purpose: z.string().trim().min(3, 'Enter the Purpose (at least 3 characters)').max(255),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateStoreIssueInput = z.infer<typeof createStoreIssueInputSchema>;

/** ADR-189 — reversing an issue puts the pieces back with an opposite entry. */
export const STORE_ISSUE_REVERSE_REASON_MIN = 10;
export const reverseStoreIssueInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      STORE_ISSUE_REVERSE_REASON_MIN,
      `Give a reason (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters)`,
    )
    .max(500),
});
export type ReverseStoreIssueInput = z.infer<typeof reverseStoreIssueInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listStoreIssuesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemId: z.string().uuid().optional(),
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
export type ListStoreIssuesQuery = z.infer<typeof listStoreIssuesQuerySchema>;

export interface ListStoreIssuesResponse {
  items: StoreIssueListItem[];
  total: number;
  limit: number;
  offset: number;
}
