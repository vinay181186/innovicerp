// Purchase Request shared schemas (T-036a).
//
// Single-table per ADR-015 #2 (no separate lines table — current data is
// single-line; promote to header+lines if/when a multi-line PR workflow
// emerges). Mirrors the legacy PR creation flow (`legacy/InnovicERP_v82_12_3
// _DataLossFix_29-04-2026.html` — `addPR()` + plan/outsource cascade) on top
// of the Phase 5 storage layer (purchase_requests, ADR-015).
//
// Three shapes:
//   - read: PurchaseRequest (table row); PurchaseRequestListItem joins
//     vendor_name + jc/op codes for the list view's display columns.
//   - write: createPurchaseRequestInputSchema accepts business fields only.
//     Approval/PO-creation fields (approvedBy/At, poId, poCreatedAt) are NOT
//     in this input — they get set via the service-layer "approve" action and
//     the T-036b PO-creation cascade.
//   - query: list filters (search, status, vendor, jc-op link, date range).

import { z } from 'zod';
import { PR_STATUSES, PR_TYPES } from '../enums/pr-status';

export const prStatusSchema = z.enum(PR_STATUSES);
export const prTypeSchema = z.enum(PR_TYPES);

const codeRegex = /^[A-Za-z0-9._/-]+$/; // legacy prNo allows '-' (e.g. PR-00001)

// ─── Read shapes ───────────────────────────────────────────────────────────

export const purchaseRequestSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  prDate: z.string(), // ISO date
  status: prStatusSchema,
  prType: prTypeSchema.default('standard'),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemName: z.string().nullable(),
  qty: z.number().int().positive(),
  estCost: z.string(), // numeric stored as string
  requiredDate: z.string().nullable(),
  sourceJcOpId: z.string().uuid().nullable(),
  sourceSoLineId: z.string().uuid().nullable(),
  operation: z.string().nullable(),
  remarks: z.string().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  poId: z.string().uuid().nullable(),
  poCreatedAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;

/** Detail read: header + the same vendor/item display joins the list carries.
 *  Per docs/PARITY/linked-display-audit — when an FK is set (vendor_id /
 *  item_id) the read resolves the joined name/code so the UI can render the
 *  real value instead of a "— linked —" placeholder. Without these, consumers
 *  fall back to `vendorCodeText`, which on an OSP-generated PR is the
 *  `(vendor TBD)` sentinel — so a vendor picked later never appears. */
export const purchaseRequestDetailSchema = purchaseRequestSchema.extend({
  vendorName: z.string().nullable(),
  vendorCode: z.string().nullable(), // resolved from vendors master when vendorId set
  itemCode: z.string().nullable(), // resolved from items master when itemId set
  // Source/linked document codes resolved from the FK ids, so the detail page
  // shows real values instead of a '— linked —' placeholder.
  poCode: z.string().nullable(), // resolved from purchase_orders when poId set
  sourceJcCode: z.string().nullable(), // resolved from job_cards via source_jc_op_id
  sourceJcOpSeq: z.number().int().positive().nullable(),
  soCode: z.string().nullable(), // resolved from sales_orders via source_so_line_id
  soLineNo: z.number().int().positive().nullable(),
});
export type PurchaseRequestDetail = z.infer<typeof purchaseRequestDetailSchema>;

/** List row: header + display joins for vendor name, item code/name, and the
 *  source JC op (jc code + op_seq + operation) when set. Mirrors the legacy
 *  PR list columns (`renderPRList()` in the legacy HTML). */
export const purchaseRequestListItemSchema = purchaseRequestSchema.extend({
  vendorName: z.string().nullable(),
  itemCode: z.string().nullable(), // resolved from items master when itemId set
  sourceJcCode: z.string().nullable(),
  sourceJcOpSeq: z.number().int().positive().nullable(),
  poCode: z.string().nullable(), // resolved from purchase_orders when poId set
});
export type PurchaseRequestListItem = z.infer<typeof purchaseRequestListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

const _prInputBase = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen'),
  prDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'prDate must be YYYY-MM-DD'),
  status: prStatusSchema.default('open'),
  /** Defaults to 'standard'; service overrides to 'jw_osp' when sourceJcOpId is set. */
  prType: prTypeSchema.optional(),
  vendorId: z.string().uuid().optional(),
  vendorCodeText: z.string().min(1).max(64).optional(),
  itemId: z.string().uuid().optional(),
  itemCodeText: z.string().min(1).max(64).optional(),
  itemName: z.string().max(255).optional(),
  qty: z.number().int().positive(),
  estCost: z.coerce.number().nonnegative().default(0),
  requiredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'requiredDate must be YYYY-MM-DD')
    .optional(),
  sourceJcOpId: z.string().uuid().optional(),
  sourceSoLineId: z.string().uuid().optional(),
  operation: z.string().max(255).optional(),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — vendor and item each need at least one of (id, codeText) per
 *  ADR-012 #10 fallback pattern; same DB CHECK constraints back this up. */
export const createPurchaseRequestInputSchema = _prInputBase
  .refine((i) => Boolean(i.vendorId) || Boolean(i.vendorCodeText?.trim()), {
    message: 'vendorId or vendorCodeText is required (per ADR-015 vendor CHECK)',
  })
  .refine((i) => Boolean(i.itemId) || Boolean(i.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  });
export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestInputSchema>;

/** UPDATE — every field optional. `code` is omitted (immutable business key,
 *  matches the SO/JW pattern). The XOR-ish vendor / item refines are not
 *  re-applied here because the partial form may legitimately update only
 *  qty or remarks; the DB CHECK constraints will reject any update that
 *  would leave both halves null. */
export const updatePurchaseRequestInputSchema = _prInputBase.partial().omit({ code: true });
export type UpdatePurchaseRequestInput = z.infer<typeof updatePurchaseRequestInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listPurchaseRequestsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / operation / item_name
  status: prStatusSchema.optional(),
  prType: prTypeSchema.optional(),
  vendorId: z.string().uuid().optional(),
  /** Filter to PRs originating from a specific JC op (outsource workflow). */
  sourceJcOpId: z.string().uuid().optional(),
  /** Inclusive lower bound on pr_date (YYYY-MM-DD). */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Inclusive upper bound on pr_date (YYYY-MM-DD). */
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListPurchaseRequestsQuery = z.infer<typeof listPurchaseRequestsQuerySchema>;

export interface ListPurchaseRequestsResponse {
  items: PurchaseRequestListItem[];
  total: number;
  limit: number;
  offset: number;
}
