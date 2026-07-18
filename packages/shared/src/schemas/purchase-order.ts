// Purchase Order shared schemas (T-036b).
//
// Header + lines, mirroring the legacy PO Master / PO form (`legacy/InnovicERP_v82
// _12_3_DataLossFix_29-04-2026.html` — `_getPoBaseData()` line 25717, `addPO()`
// line 25728, `renderPOMaster()`) on top of the Phase 5 storage layer
// (purchase_orders + purchase_order_lines, ADR-015).
//
// Differences from `sales-order.ts`:
//   - Header: `poType` enum, no GST overall (sgst/cgst/igst pcts inline),
//     `taxType` text snapshot, `prCodeText` audit reference, approval fields.
//   - Lines: `rate` numeric, `receivedQty` (mutated by GRN cascade in T-036c),
//     `sourceSoLineId` + `sourceJcOpId` for cost-rollup / outsource workflows,
//     no `clientPoLineNo` / `partName` (use `itemName` snapshot only).
//
// Same write contracts as SO/JW:
//   - Create + update accept `{header, lines}`; service runs both in one tx
//     using the option-C merge semantics.
//   - Header requires `vendorId` OR `vendorCodeText` (ADR-015 vendor CHECK).
//   - Each line requires `itemId` OR `itemCodeText` (ADR-012 #10).
//   - PO requires ≥ 1 line on create.
//
// Plus a third write input — `createPurchaseOrderFromPrInputSchema` — for the
// "Create PO" flow off a PR detail page. Service builds a single-line PO from
// the PR's vendor + item + qty + estCost, sets PR.poId / poCreatedAt /
// status='po_created' atomically. Mirrors legacy `addPO()` line 25728.

import { z } from 'zod';
import { PO_STATUSES } from '../enums/po-status';
import { PO_TYPES } from '../enums/po-type';

export const poTypeSchema = z.enum(PO_TYPES);
export const poStatusSchema = z.enum(PO_STATUSES);

const codeRegex = /^[A-Za-z0-9._/-]+$/;

// ─── Read shapes ───────────────────────────────────────────────────────────

export const purchaseOrderLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  // Live item code joined from items.code when itemId is set; null otherwise.
  // Same pattern as salesOrderLineSchema.itemCode (per ISSUE-005 fix).
  itemCode: z.string().nullable().default(null),
  itemName: z.string(),
  qty: z.number().int().positive(),
  rate: z.string(), // numeric stored as string
  receivedQty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  sourceSoLineId: z.string().uuid().nullable(),
  sourceJcOpId: z.string().uuid().nullable(),
  lineRemarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  poDate: z.string(),
  poType: poTypeSchema,
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string().nullable(),
  status: poStatusSchema,
  dueDate: z.string().nullable(),
  taxType: z.string().nullable(),
  sgstPct: z.string(),
  cgstPct: z.string(),
  igstPct: z.string(),
  prCodeText: z.string().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  approvalRemarks: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderDetailSchema = purchaseOrderSchema.extend({
  // Live vendor name joined from vendors.name when vendorId is set; null
  // otherwise (free-text vendor stays in vendorCodeText). Same pattern as
  // salesOrderLine.itemCode (per ISSUE-005 fix).
  vendorName: z.string().nullable().default(null),
  lines: z.array(purchaseOrderLineSchema),
});
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;

/** List row: header + line aggregates + vendor name join. */
export const purchaseOrderListItemSchema = purchaseOrderSchema.extend({
  vendorName: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  receivedQty: z.number().int().nonnegative(),
});
export type PurchaseOrderListItem = z.infer<typeof purchaseOrderListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const purchaseOrderLineInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    lineNo: z.number().int().positive().optional(),
    itemId: z.string().uuid().optional(),
    itemCodeText: z.string().min(1).max(64).optional(),
    itemName: z.string().min(1).max(255),
    qty: z.number().int().positive(),
    rate: z.coerce.number().nonnegative().default(0),
    receivedQty: z.number().int().nonnegative().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    sourceSoLineId: z.string().uuid().optional(),
    sourceJcOpId: z.string().uuid().optional(),
    lineRemarks: z.string().max(2000).optional(),
  })
  .refine((l) => Boolean(l.itemId) || Boolean(l.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  });
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

const _poHeaderInputBase = z.object({
  // Optional: the server auto-generates the next IN-PO-##### when omitted
  // (document-number override — blank = auto). A caller may still pass a code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen')
    .optional(),
  poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'poDate must be YYYY-MM-DD'),
  poType: poTypeSchema.default('standard'),
  vendorId: z.string().uuid().optional(),
  vendorCodeText: z.string().min(1).max(64).optional(),
  status: poStatusSchema.default('draft'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .optional(),
  taxType: z.string().max(32).optional(),
  sgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
  cgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
  igstPct: z.coerce.number().nonnegative().max(99.99).default(0),
  prCodeText: z.string().max(64).optional(),
  approvalRemarks: z.string().max(2000).optional(),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — `{header, lines}`. Header + ≥ 1 line; service runs both in tx. */
export const createPurchaseOrderInputSchema = z.object({
  header: _poHeaderInputBase.refine(
    (h) => Boolean(h.vendorId) || Boolean(h.vendorCodeText?.trim()),
    { message: 'vendorId or vendorCodeText is required (per ADR-015 vendor CHECK)' },
  ),
  lines: z.array(purchaseOrderLineInputSchema).min(1, 'At least one line is required'),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderInputSchema>;

/** UPDATE — same shape; lines optional (option C merge). `code` immutable. */
export const updatePurchaseOrderInputSchema = z.object({
  header: _poHeaderInputBase.partial().omit({ code: true }),
  lines: z.array(purchaseOrderLineInputSchema).optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderInputSchema>;

/** "Create PO from PR" — single-line PO derived from a PR row. The service
 *  loads the PR, blocks if it's already converted (status='po_created') or
 *  cancelled, builds vendor + line from the PR's fields, runs PO + line
 *  inserts AND PR update (poId / poCreatedAt / status='po_created') in one tx.
 *  Mirrors legacy `addPO()` line 25728 — single PR → single-line PO. */
export const createPurchaseOrderFromPrInputSchema = z.object({
  prId: z.string().uuid(),
  /** Header overrides — caller supplies the PO code (auto-suggested from
   *  legacy `IN-JWPO-NNNNN` series in UI) and any tax/date adjustments. */
  header: z.object({
    // Optional — blank means the server auto-generates the next PO code, same as
    // the main create-PO path (the shared DocNumberInput reports empty as valid).
    code: z.string().min(1).max(64).regex(codeRegex).optional(),
    poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'poDate must be YYYY-MM-DD'),
    poType: poTypeSchema.default('job_work'), // outsource PRs default to job_work
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    taxType: z.string().max(32).optional(),
    sgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    cgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    igstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    remarks: z.string().max(2000).optional(),
  }),
});
export type CreatePurchaseOrderFromPrInput = z.infer<typeof createPurchaseOrderFromPrInputSchema>;

/** "Create JW PO from N PRs" — Outsource Jobs page batch action.
 *  Mirror of legacy `_ospCreatePO` L27131. Clubs N OSP PRs (typically
 *  same vendor, possibly cross-SO) into a single PO header with one
 *  line per PR. Each PR's status flips to 'po_created'. */
export const createPurchaseOrderFromPrBatchInputSchema = z.object({
  prIds: z.array(z.string().uuid()).min(1).max(50),
  vendorId: z.string().uuid(),
  header: z.object({
    code: z.string().min(1).max(64).regex(codeRegex),
    poDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'poDate must be YYYY-MM-DD'),
    poType: poTypeSchema.default('job_work'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD').optional(),
    taxType: z.string().max(32).optional(),
    sgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    cgstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    igstPct: z.coerce.number().nonnegative().max(99.99).default(0),
    remarks: z.string().max(2000).optional(),
  }),
  /** Per-PR rate override (₹/unit). Falls back to PR.estCost if omitted. */
  rateOverrides: z.record(z.coerce.number().nonnegative()).optional(),
});
export type CreatePurchaseOrderFromPrBatchInput = z.infer<
  typeof createPurchaseOrderFromPrBatchInputSchema
>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listPurchaseOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / pr_code_text / vendor_code_text
  status: poStatusSchema.optional(),
  poType: poTypeSchema.optional(),
  vendorId: z.string().uuid().optional(),
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
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

export interface ListPurchaseOrdersResponse {
  items: PurchaseOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}
