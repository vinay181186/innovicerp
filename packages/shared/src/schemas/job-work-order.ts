// Job Work Order shared schemas (T-031).
//
// Header + lines, mirroring the legacy JW Master / JW form
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html — `renderJWMaster()`
// line 12642, `jwHeaderForm()` line 12784, `addJW()` line 12885) on top of the
// Phase 4 storage layer (job_work_orders + job_work_order_lines, ADR-012).
//
// Differences from `sales-order.ts`:
//   - Header: no `type`, no `costCenter`, no BOM fields. Carries `gstPercent`
//     (migration 0061) for SO-parity totals on the JWSO form.
//     Status uses the same `so_status` enum (ADR-012 #5 — semantics identical).
//     Carries the HEADER-level client-material intent fields (migration 0053,
//     matching legacy CLIENT MATERIAL DETAILS L12839): `clientMaterial`,
//     `clientMaterialQty`. (The old `materialReceivedDate` /
//     `materialReceivedQty` header fields were dropped in migration 0079 —
//     actual receipts come from Party GRN via `partyReceivedQty`.)
//   - Lines: `rate` (processing charge per unit, migration 0053) + no
//     `clientPoLineNo`. Material fields moved off the line to the header.
//
// Same write contracts:
//   - `createJobWorkOrderInputSchema` and `updateJobWorkOrderInputSchema`
//     accept `{header, lines}`; service runs the merge in one transaction
//     using the same option-C semantics as sales orders.
//   - Header requires a client-master `clientId` (supersedes ADR-012 #9 —
//     the free-text `customerName` fallback is removed, create and update).
//   - Each line requires `itemId` OR `itemCodeText` (ADR-012 #10).
//   - JWs always require ≥ 1 line (no Equipment exception).

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { REVISION_PATTERN } from '../lib/revision';
import { SO_STATUSES } from '../enums/so-status';
import { uomSchema } from './item';
import { sfRawParamSchema } from './list-query';

export const jwStatusSchema = z.enum(SO_STATUSES);

const codeRegex = /^[A-Za-z0-9._/-]+$/; // legacy jwNo allows '/'

// ─── Read shapes ───────────────────────────────────────────────────────────

export const jobWorkOrderLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jobWorkOrderId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  partName: z.string(),
  material: z.string().nullable(),
  drawingNo: z.string().nullable(),
  /** The customer's DRAWING REVISION and the drawing FILE (migration 0120) —
   *  the sales-order line's two fields, so a JWSO line and an SO line are the
   *  same shape and one screen can serve both. `revision` is free text, what is
   *  printed on the drawing ('A', 'B', '2'), and is independent of the file.
   *  `drawingFilePath` is a path in the private `qc-docs` bucket. */
  revision: z.string().default('0'),
  drawingFilePath: z.string().nullable().default(null),
  /** Item Master product image (items.image_path via itemId), for the thumbnail. */
  itemImagePath: z.string().nullable().default(null),
  uom: uomSchema,
  orderQty: z.number().int().positive(),
  /** Σ finished parts delivered back to the client (job_work_order_lines.returned_qty).
   *  Shown on the list as "Dispatched" — Balance = orderQty − returnedQty. */
  returnedQty: z.number().int().nonnegative().default(0),
  rate: z.string().nullable(), // processing charge/unit; NULL when prices hidden
  dueDate: z.string().nullable(), // ISO date
  status: jwStatusSchema,
  /** R6 (ADR-194): short-close markers. When set, this line was closed with an
   *  unmet balance (orderQty − returnedQty) — status is still 'closed'; these
   *  record that the close was short and why. Null on a normally-closed or open
   *  line. */
  shortClosedAt: z.string().nullable().default(null),
  shortClosedBy: z.string().uuid().nullable().default(null),
  shortCloseReason: z.string().nullable().default(null),
  sourceBomMasterId: z.string().uuid().nullable().default(null),
  /** ADR-203: this line's customer raw material — the `<item code>-RM` item
   *  (Party Supplied Material) and the per-customer party material it is booked
   *  under in the customer-material register. Set by the server on save. */
  rmItemId: z.string().uuid().nullable().default(null),
  rmItemCode: z.string().nullable().default(null),
  partyMaterialId: z.string().uuid().nullable().default(null),
  partyMaterialCode: z.string().nullable().default(null),
  /** ADR-203: QC-accepted customer material on THIS line (Σ party GRN accepted). */
  rmAcceptedQty: z.number().int().nonnegative().default(0),
  /** ADR-203: true once any downstream document (Job Card, plan, Party GRN,
   *  issue, return, invoice) uses this line — item / UOM / BOM are then locked
   *  and the line cannot be removed. Drives the edit form's locks. */
  inUse: z.boolean().default(false),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JobWorkOrderLine = z.infer<typeof jobWorkOrderLineSchema>;

export const jobWorkOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  jwDate: z.string(), // ISO date
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  status: jwStatusSchema,
  gstPercent: z.string().nullable(), // NULL when prices hidden (parity with sales_order)
  remarks: z.string().nullable(),
  // Client material details (header-level, per legacy CLIENT MATERIAL DETAILS
  // L12839). Client supplies raw material → we process → deliver finished parts.
  clientMaterial: z.string().nullable(),
  clientMaterialQty: z.string().nullable(), // numeric stored as string
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JobWorkOrder = z.infer<typeof jobWorkOrderSchema>;

export const jobWorkOrderDetailSchema = jobWorkOrderSchema.extend({
  /** Told, not inferred. `false` means the server stripped money it may not
   *  send; absent means money is present. Clients must branch on this rather
   *  than probing a money field for null — a null money field also means "no
   *  value yet", and probing it hid the money columns from users fully
   *  entitled to see them. Optional because the write-back paths (create /
   *  update / approve) return this shape without passing the money gate, and
   *  they always carry real figures. */
  priceVisible: z.boolean().optional(),
  /** ADR-203: customer material QC-ACCEPTED across this JWSO's lines
   *  (Σ party_grn_lines.accepted_qty by jw_line_id). Rejected pieces never count. */
  partyReceivedQty: z.number().int().nonnegative(),
  lines: z.array(jobWorkOrderLineSchema),
});
export type JobWorkOrderDetail = z.infer<typeof jobWorkOrderDetailSchema>;

/** List ROW = ONE JWSO header with line aggregates (#6 — matches the SO Master
 *  list, which is one row per order, not per line). Columns, in order:
 *  JWSO NO. · DATE · CLIENT · CLIENT PO · LINES · TOTAL QTY · JC QTY ·
 *  MATERIAL · DUE · STATUS · REMARKS. Material status reads the actual
 *  partyReceivedQty (Σ Party GRN receipts) vs clientMaterialQty;
 *  earliestDueDate = MIN(line.due). */
export const jobWorkOrderListItemSchema = z.object({
  /** Told, not inferred. `false` means the server stripped money it may not
   *  send; absent means money is present. See the note on the detail shape. */
  priceVisible: z.boolean().optional(),
  jwId: z.string().uuid(),
  code: z.string(),
  jwDate: z.string(),
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  /** # of non-deleted lines on this JWSO. */
  lineCount: z.number().int().nonnegative(),
  /** Σ line order_qty across the JWSO. */
  totalQty: z.number().int().nonnegative(),
  /** Σ finished parts dispatched (delivered) back to the client across all lines
   *  (Σ job_work_order_lines.returned_qty). Balance = totalQty − dispatchedQty. */
  dispatchedQty: z.number().int().nonnegative().default(0),
  /** Σ job_cards.order_qty linked to any line of this JWSO. */
  jcQty: z.number().int().nonnegative(),
  /** MIN(line.due_date) across non-deleted lines; null when none set. */
  earliestDueDate: z.string().nullable(),
  status: jwStatusSchema,
  remarks: z.string().nullable(),
  /** Header-level client material (expected/order intent — drives the MATERIAL
   *  column's "expected" number). */
  clientMaterialQty: z.string().nullable(),
  /** ADR-203: customer material QC-accepted across the JWSO's lines
   *  (Σ party_grn_lines.accepted_qty by jw_line_id). */
  partyReceivedQty: z.number().int().nonnegative(),
  /** ADR-203: customer material the lines need = Σ order qty of lines that
   *  have a customer RM (1 RM piece per finished part, owner D1). */
  rmRequiredQty: z.number().int().nonnegative().default(0),
});
export type JobWorkOrderListItem = z.infer<typeof jobWorkOrderListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const jobWorkOrderLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  /** ADR-203: Item Master only — every JWSO line names a master item (its
   *  `<code>-RM` customer material is derived from it). `itemCodeText` is a
   *  server-written snapshot and is no longer accepted. Line numbers are
   *  assigned by the server and never reused; `status` is server-owned. */
  itemId: z.string().uuid(),
  partName: z.string().min(1).max(255),
  material: z.string().max(255).nullable().optional(),
  drawingNo: z.string().max(64).nullable().optional(),
  // Compulsory on the FORM (the only layer that can ask a human), optional
  // here so the server paths that insert a JWSO line without asking anyone —
  // the BOM cascade and the SO-to-JW conversions — still work. Same split the
  // sales-order line makes.
  /** ADR-178: upper-cased on the way in ("b" → "B"); letters, digits, . - /
   *  only. Going backwards (B → A, 2 → 1) is refused on update by the server
   *  and the form — see lib/revision.ts. */
  revision: z
    .string()
    .trim()
    .max(32)
    .transform((s) => s.toUpperCase())
    .refine((s) => s === '' || REVISION_PATTERN.test(s), 'Rev: letters, digits, . - / only')
    .optional(),
  drawingFilePath: z.string().max(512).nullable().optional(),
  // No default: a partial update that leaves `uom` out must not reset it.
  uom: uomSchema.optional(),
  orderQty: z.number().int().positive(), // CHECK > 0 in DB too
  rate: z.coerce.number().nonnegative().optional(),
  /** Per line. `null` clears it. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
  // BOM-8 for job work (migration 0086): when set, this line is an ASSEMBLY
  // — the cascade spawns a child Job Card per component and readiness
  // becomes weakest-component instead of this line's own output. The BOM may
  // not contain a `purchase` component (client supplies the material); the
  // service rejects that with a friendly error. See bom-master/cascade.ts.
  sourceBomMasterId: z.string().uuid().optional(),
});
export type JobWorkOrderLineInput = z.infer<typeof jobWorkOrderLineInputSchema>;

const _jwHeaderInputBase = z.object({
  // Optional on create: the server auto-generates the next IN-JW-##### in the
  // company series when omitted (bug 1.2). A caller may still pass a code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen')
    .optional(),
  jwDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'jwDate must be YYYY-MM-DD'),
  clientId: z.string().uuid().optional(),
  customerName: z.string().max(255).optional(),
  /** `null` clears it on edit. */
  clientPoNo: z.string().max(64).nullable().optional(),
  // Optional on the wire — the service + DB both default it to 18 when omitted.
  gstPercent: z.coerce.number().nonnegative().max(99.99).optional(),
  /** `null` clears it on edit. */
  remarks: z.string().max(2000).nullable().optional(),
  // ADR-203: status is server-owned (a new JWSO is always 'open'), and the
  // header-level customer material is gone — each LINE carries its own RM.
});

/** CREATE — `{header, lines}`. Header + ≥ 1 line (no Equipment exception
 *  on JWs); service runs both inserts in one transaction. */
export const createJobWorkOrderInputSchema = z.object({
  // Client master link is mandatory (supersedes ADR-012 #9 for JW): a JW must
  // reference a real client; the free-text customerName fallback is removed.
  // The server snapshots customerName from the client master record.
  header: _jwHeaderInputBase.refine((h) => Boolean(h.clientId), {
    message: 'A client (from the client master) is required for a Job Work order.',
  }),
  lines: z.array(jobWorkOrderLineInputSchema).min(1, 'At least one line is required'),
});
export type CreateJobWorkOrderInput = z.infer<typeof createJobWorkOrderInputSchema>;

/** UPDATE — same shape; lines optional (option C merge). `code` immutable.
 *  Client master link is mandatory on edit too (matches create): editing a
 *  legacy customerName-only JWSO forces picking a client from the master. The
 *  server re-snapshots customerName from the chosen client. */
export const updateJobWorkOrderInputSchema = z.object({
  header: _jwHeaderInputBase
    .partial()
    .omit({ code: true })
    .refine((h) => Boolean(h.clientId), {
      message: 'A client (from the client master) is required for a Job Work order.',
    }),
  lines: z.array(jobWorkOrderLineInputSchema).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type UpdateJobWorkOrderInput = z.infer<typeof updateJobWorkOrderInputSchema>;

/** R6 (ADR-194): short-close ONE JWSO line — close it with the balance left
 *  unmet (the customer will not send / take the rest). Sets status='closed' and
 *  records the shortfall + reason on the line. Reuses the jw_create permission. */
export const shortCloseJobWorkOrderLineInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ShortCloseJobWorkOrderLineInput = z.infer<typeof shortCloseJobWorkOrderLineInputSchema>;

/** ADR-203: find-or-create the customer RM item for an order item. Called by
 *  the JWSO form the moment a line's item is picked (silent, no popup — owner
 *  option B). Idempotent: the same order item always returns the same RM. */
export const ensureJwRmItemInputSchema = z.object({
  itemId: z.string().uuid(),
});
export type EnsureJwRmItemInput = z.infer<typeof ensureJwRmItemInputSchema>;

export const ensureJwRmItemResponseSchema = z.object({
  rmItemId: z.string().uuid(),
  rmItemCode: z.string(),
  rmItemName: z.string(),
  /** true when this call created it (the line shows "new"). */
  created: z.boolean(),
});
export type EnsureJwRmItemResponse = z.infer<typeof ensureJwRmItemResponseSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listJobWorkOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: jwStatusSchema.optional(),
  clientId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200) — the screen's column sort + filters. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJobWorkOrdersQuery = z.infer<typeof listJobWorkOrdersQuerySchema>;

export interface ListJobWorkOrdersResponse {
  items: JobWorkOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}
