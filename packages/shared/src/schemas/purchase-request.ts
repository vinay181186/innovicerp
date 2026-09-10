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
  estCost: z.string().nullable(), // numeric stored as string; NULL when prices hidden
  requiredDate: z.string().nullable(),
  sourceJcOpId: z.string().uuid().nullable(),
  sourceSoLineId: z.string().uuid().nullable(),
  operation: z.string().nullable(),
  remarks: z.string().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  /** DEPRECATED as the source of truth (ADR-152). Holds ONE purchase order, so
   *  it cannot describe a PR covered by several. Still written for now and still
   *  populated on the three pre-0103 PRs, which is what keeps them closed — see
   *  `orderedQty` below. Read `purchaseOrders` for the real list. */
  poId: z.string().uuid().nullable(),
  poCreatedAt: z.string().nullable(),
  /** How much of `qty` is actually on a live purchase order — the sum of
   *  purchase_order_lines.qty where source_pr_id is this PR, ignoring deleted
   *  lines and CANCELLED POs. Cancelling a PO therefore returns its quantity
   *  here on its own, with no status to keep in sync (ADR-152, gap 2).
   *
   *  LEGACY RULE: a PR with a header `poId` but NO linked lines predates
   *  migration 0103, which deliberately did not backfill. Those three PRs report
   *  their full `qty` as ordered so they stay closed and can never be offered
   *  for a second PO. */
  orderedQty: z.number().int().nonnegative(),
  /** `qty` minus `orderedQty`, less anything short-closed. What may still be
   *  ordered. Deliberately a plain int, not nonnegative: if a PR is somehow
   *  over-ordered the balance goes negative and the screen says so, rather than
   *  clamping to 0 and hiding it. */
  balanceQty: z.number().int(),
  /** Set when the buyer SHORT-CLOSES the remainder: "we ordered 10 of 100 and
   *  the rest is not coming" (migration 0117, ADR-152 gap 6). Deliberately not
   *  the same as editing `qty` down — the PR still records that 100 was asked
   *  for, because that is what happened, and separately that the rest was
   *  abandoned and why. While this is set `balanceQty` reports 0 and the PR
   *  drops out of the PO form's picker. */
  balanceClosedAt: z.string().nullable(),
  balanceClosedBy: z.string().uuid().nullable(),
  balanceClosedReason: z.string().nullable(),
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
  /** Told, not inferred. `false` means the server stripped money it may not
   *  send; absent means money is present. Clients must branch on this rather
   *  than probing a money field for null — a null money field also means "no
   *  value yet", and probing it hid the money columns from users fully
   *  entitled to see them. Optional because the write-back paths (create /
   *  update / approve) return this shape without passing the money gate, and
   *  they always carry real figures. */
  priceVisible: z.boolean().optional(),
  vendorName: z.string().nullable(),
  vendorCode: z.string().nullable(), // resolved from vendors master when vendorId set
  /** Address line + city + state + pincode, comma-joined, blanks skipped.
   *  Null when the vendor is free text only, or the master has no address. */
  vendorAddress: z.string().nullable(),
  itemCode: z.string().nullable(), // resolved from items master when itemId set
  /** The customer's drawing revision, read live off the SO line this PR was
   *  raised against (purchase_requests.source_so_line_id →
   *  sales_order_lines.revision). Displayed as `CODE/REV` beside the item code
   *  so a buyer ordering material for an order is looking at the same revision
   *  the shop floor is making.
   *
   *  Null is correct and common: a PR raised for stock, for a JC operation with
   *  no SO behind it, or against an SO line since deleted (the FK is ON DELETE
   *  SET NULL). Null renders as the bare item code — never a trailing slash,
   *  and never `items.revision`, which is a different column about the item
   *  itself and would put a plausible-looking wrong revision on the document. */
  itemRevision: z.string().nullable().default(null),
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
  /** Told, not inferred. `false` means the server stripped money it may not
   *  send; absent means money is present. See the note on the detail shape. */
  priceVisible: z.boolean().optional(),
  vendorName: z.string().nullable(),
  itemCode: z.string().nullable(), // resolved from items master when itemId set
  /** The customer's drawing revision off the SO line behind this PR — same
   *  source, same rules, same `CODE/REV` rendering as the detail shape above.
   *  Null whenever the PR has no live SO line behind it, which is the majority
   *  of a stores-driven PR list. */
  itemRevision: z.string().nullable().default(null),
  sourceJcCode: z.string().nullable(),
  sourceJcOpSeq: z.number().int().positive().nullable(),
  poCode: z.string().nullable(), // resolved from purchase_orders when poId set
  // Resolved from sales_orders via source_so_line_id, so the list "SO / JC"
  // column shows the real SO for an SO-sourced PR instead of a dash.
  soCode: z.string().nullable(),
  soLineNo: z.number().int().positive().nullable(),
});
export type PurchaseRequestListItem = z.infer<typeof purchaseRequestListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

const _prInputBase = z.object({
  // Optional — blank means the server auto-generates the next IN-PR-##### (T23).
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen')
    .optional(),
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
// `status` is omitted alongside `code`/`prType`: status is immutable on a raw
// edit and only advances through the approve / reject / create-PO service
// actions (mirrors updateJobCard / updatePurchaseOrder). This keeps the edit
// form from ever skipping the approvedBy/approvedAt stamp.
export const updatePurchaseRequestInputSchema = _prInputBase
  .partial()
  .omit({ code: true, prType: true, status: true });
export type UpdatePurchaseRequestInput = z.infer<typeof updatePurchaseRequestInputSchema>;

/** SHORT-CLOSE the balance — stop expecting the unordered remainder.
 *
 *  Allowed only while some quantity is still outstanding; closing an untouched
 *  PR is a rejection, and closing a fully-ordered one is a no-op. The reason is
 *  required and the database enforces it too (0117 CHECK), because in six months
 *  "why did we not buy the other 90?" is the only question anyone asks. */
export const closePurchaseRequestBalanceInputSchema = z.object({
  reason: z.string().min(1, 'A reason is required to close the balance').max(2000),
});
export type ClosePurchaseRequestBalanceInput = z.infer<
  typeof closePurchaseRequestBalanceInputSchema
>;

/** REJECT — a non-empty reason is required (stored in remarks on the PR since
 *  it has no dedicated rejection column). Mirrors the PO reject input. */
export const rejectPurchaseRequestInputSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required').max(2000),
});
export type RejectPurchaseRequestInput = z.infer<typeof rejectPurchaseRequestInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listPurchaseRequestsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / operation / item_name
  status: prStatusSchema.optional(),
  prType: prTypeSchema.optional(),
  vendorId: z.string().uuid().optional(),
  /** Filter to PRs originating from a specific JC op (outsource workflow). */
  sourceJcOpId: z.string().uuid().optional(),
  /** Only PRs that still have quantity left to order — `balanceQty > 0` and not
   *  short-closed. This is what the PO form's PR picker asks for (ADR-152).
   *
   *  It replaces the old client-side test `poId === null && status !== 'po_created'`,
   *  which was a BOOLEAN "has a PO at all" and so hid a PR the moment one PO was
   *  raised, even for 10 of 100. The server owns this filter because the balance
   *  is a SUM over purchase_order_lines that the browser cannot compute. */
  convertibleOnly: z.coerce.boolean().optional(),
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
