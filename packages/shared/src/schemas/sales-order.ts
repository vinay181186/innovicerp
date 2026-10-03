// Sales Order shared schemas (T-030).
//
// Header + lines, mirroring the legacy SO Master / SO line form
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html — `renderSOmaster()`
// line 11839, `soHeaderForm()` line 12183, `addSO()` line 12413, `_editFullSO()`
// line 12531) on top of the Phase 4 storage layer
// (sales_orders + sales_order_lines, ADR-012).
//
// Three shapes:
//   - read: SalesOrder (header) + SalesOrderLine; SalesOrderListItem aggregates
//     line_count + total_qty + jc_qty for the list view.
//   - write: createSalesOrderInputSchema + updateSalesOrderInputSchema accept
//     `{header, lines}` together. Service runs the inserts/updates/deletes in
//     a single transaction. Update uses the legacy merge semantics from
//     `_editFullSO()` line 12576-12612: lines with an `id` matching existing
//     are updated; lines without are created; existing lines absent from input
//     are soft-deleted.
//   - query: list filters (search, status, type, date range, pagination).
//
// Deferred per ADR-012 (forward fields, captured but not modelled here):
//   - milestones[] (#8, no current data)
//   - clientPoFileUrl / clientPoFileName (file upload, Phase 6)
//   - dispatchedQty / SO Total Value (derived; needs dispatch + BOM modules)
//   - bom_master_id is a uuid FK to bom_masters since 0184; bom_status stays
//     free text ("BOM Assigned" / "BOM Pending").

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { REVISION_PATTERN } from '../lib/revision';
import { internalSoNoError, normaliseInternalSoNo } from '../lib/internal-so-no';
import { SO_FULFILMENT_STATUSES } from '../enums/so-fulfilment-status';
import { sfRawParamSchema } from './list-query';
import { SO_STATUSES } from '../enums/so-status';
import { SO_TYPES } from '../enums/so-type';
import { uomSchema } from './item';

export const soTypeSchema = z.enum(SO_TYPES);
export const soStatusSchema = z.enum(SO_STATUSES);
/** ADR-196 — read-time, ERPNext-style (enums/so-fulfilment-status.ts). */
export const soFulfilmentStatusSchema = z.enum(SO_FULFILMENT_STATUSES);

/** ADR-207 — Internal SO No. on the way in: normalised (trimmed, "SO-" prefix
 *  upper-cased) then checked against the shared rule (lib/internal-so-no.ts). */
const internalSoNoInputSchema = z
  .string()
  .transform(normaliseInternalSoNo)
  .superRefine((v, ctx) => {
    const err = internalSoNoError(v);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  });

// ─── Read shapes ───────────────────────────────────────────────────────────

export const salesOrderLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  // ISSUE-005 — live item code joined from items.code when itemId is set.
  // Null when itemId is null (the snapshot text in itemCodeText is the
  // only display value). UI renders `itemCode ?? itemCodeText ?? '—'`.
  itemCode: z.string().nullable().default(null),
  partName: z.string(),
  /** The item master's name (items.name by itemId). The line's own Item Name
   *  (`partName`) stays editable; the SO detail screen shows a grey
   *  "Master: …" note when the two differ (plan v3 Step 4). Only the detail
   *  read fills it; null when the line has no item. */
  masterItemName: z.string().nullable().optional(),
  material: z.string().nullable(),
  drawingNo: z.string().nullable(),
  // The CUSTOMER'S drawing revision, exactly as written on the drawing they
  // sent — 'A', 'B', 'R1', '0'. Typed on the SO line and compulsory on the form
  // (migration 0119). Text, because a revision is not arithmetic: it is a label
  // printed on a drawing, and it is a letter as often as a number.
  //
  // INDEPENDENT of drawingFilePath. Until 0119 the server owned this and bumped
  // it whenever the drawing FILE changed, which welded two separate facts
  // together — a revision could not be recorded without an upload, and
  // re-uploading invented a revision that does not exist on paper. Nothing on
  // the server computes it now.
  revision: z.string().default('0'),
  // Uploaded drawing document's storage path (qc-docs bucket, folder
  // `so-line-drawings`; view via a short-lived signed URL). Nullable.
  drawingFilePath: z.string().nullable().default(null),
  /** Item Master product image (items.image_path via itemId), for the thumbnail. */
  itemImagePath: z.string().nullable().default(null),
  uom: uomSchema,
  orderQty: z.number().int().positive(),
  // Billing status (migration 0050 / ADR-042). dispatchedQty is the cumulative
  // customer-dispatched qty; billedQty is Σ invoice-line qty (populated on the
  // SO detail read, 0 elsewhere). Pending-to-bill = orderQty − billedQty.
  dispatchedQty: z.number().int().nonnegative().default(0),
  billedQty: z.number().int().nonnegative().default(0),
  // Σ job_cards.order_qty whose source_so_line_id = this line (SO detail read,
  // 0 elsewhere). Drives the JC-Qty / Balance columns on the SO Master expand.
  jcQty: z.number().int().nonnegative().default(0),
  // numeric stored as string; NULL when the viewer's access hides prices
  // (L1 Viewer without "see price") — see canSeeFormPrice on the API.
  rate: z.string().nullable(),
  dueDate: z.string().nullable(), // ISO date
  clientPoLineNo: z.string().nullable(),
  status: soStatusSchema,
  /** ADR-196 — the line was CLOSED short (ERPNext "Close"): status is 'closed'
   *  and its undelivered qty (Order Qty − Dispatched) is dropped from every
   *  Pending / to-plan / dispatchable figure. All three set together, all
   *  null otherwise — the same columns as a JWSO line (ADR-194 R6). */
  shortClosedAt: z.string().nullable().default(null),
  shortClosedBy: z.string().uuid().nullable().default(null),
  shortCloseReason: z.string().nullable().default(null),
  sourceBomMasterId: z.string().uuid().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type SalesOrderLine = z.infer<typeof salesOrderLineSchema>;

/** SO delivery-schedule milestone (ISSUE-015). One delivery lot planned for the
 *  SO (legacy `_soMilestones` row). SO-level, not per-line. */
export const soMilestoneSchema = z.object({
  id: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  lotNo: z.number().int(),
  qty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(), // ISO date
  remarks: z.string().nullable(),
});
export type SoMilestone = z.infer<typeof soMilestoneSchema>;

export const salesOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  /** ADR-207 — the user-typed office number (e.g. SO-2401). Null on SOs made
   *  before 0197. Show it with the SO No. via the web helper soNoWithInternal. */
  internalSoNo: z.string().nullable().default(null),
  soDate: z.string(), // ISO date
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  type: soTypeSchema,
  status: soStatusSchema,
  // numeric stored as string; NULL when the viewer's access hides prices.
  gstPercent: z.string().nullable(),
  bomMasterId: z.string().nullable(),
  bomStatus: z.string().nullable(),
  costCenter: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type SalesOrder = z.infer<typeof salesOrderSchema>;

/** The order's money, worked out on the server (ADR-190): Subtotal = Σ line
 *  Order Qty × Rate over every line, GST at the SO's GST %, Grand Total =
 *  Subtotal + GST. Rounded to paise. The same sums the SO form shows while
 *  typing, so the saved order and the form never disagree. */
export const soTotalsSchema = z.object({
  subtotal: z.number(),
  gstPercent: z.number(),
  gstAmount: z.number(),
  grandTotal: z.number(),
});
export type SoTotals = z.infer<typeof soTotalsSchema>;

/** Detail response: header + ordered lines (open lines first, then by lineNo)
 *  + delivery-schedule milestones (ordered by lotNo). */
export const salesOrderDetailSchema = salesOrderSchema.extend({
  /** Told, not inferred. `false` means the server stripped money it may not
   *  send; absent means money is present. Clients must branch on this rather
   *  than probing a money field for null — a null money field also means "no
   *  value yet", and probing it hid the money columns from users fully
   *  entitled to see them. Optional because the write-back paths (create /
   *  update / approve) return this shape without passing the money gate, and
   *  they always carry real figures. */
  priceVisible: z.boolean().optional(),
  lines: z.array(salesOrderLineSchema),
  milestones: z.array(soMilestoneSchema).default([]),
  // BOM master document NUMBER (bom_masters.bom_no) resolved from bomMasterId,
  // null when unassigned. Only the detail read (getSalesOrder) populates it; the
  // UI shows it as a clickable link to the BOM master (and only for non-component
  // SOs — component orders have no equipment BOM).
  bomMasterCode: z.string().nullable().optional(),
  // Storage path of the latest active client-PO file in file_registry (ISSUE-013),
  // null when none uploaded. UI renders a 📎 view link + an upload control.
  clientPoFilePath: z.string().nullable().default(null),
  // Display name of the user who raised the SO (users.full_name joined on
  // created_by), null when unresolved. UI shows "raised by + date/time".
  createdByName: z.string().nullable().default(null),
  /** Only the detail read (GET /sales-orders/:id) fills it. Null when the
   *  caller's access hides prices (priceVisible false). */
  totals: soTotalsSchema.nullable().optional(),
  /** ADR-196 — To Deliver and Bill / To Deliver / To Bill / Completed /
   *  Closed, worked out on the server from the lines. Null for a draft or
   *  cancelled order. */
  fulfilmentStatus: soFulfilmentStatusSchema.nullable().default(null),
});
export type SalesOrderDetail = z.infer<typeof salesOrderDetailSchema>;

/** List row: header + aggregates from sales_order_lines + linked job_cards.
 *  Mirrors legacy renderSOmaster columns line 11971 (Lines, Total Qty, JC Qty,
 *  Due Date). earliestDueDate = MIN(line.due_date) across non-deleted lines. */
export const salesOrderListItemSchema = salesOrderSchema.extend({
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  jcQty: z.number().int().nonnegative(),
  /** Pieces already dispatched to the customer, summed over the order's lines
   *  (sales_order_lines.dispatched_qty). The list's Dispatched column; Balance
   *  is totalQty minus this. */
  dispatchedQty: z.number().int().nonnegative().default(0),
  /** ADR-196 — pieces dropped by closing lines short: Σ (Order Qty −
   *  Dispatched) over the short-closed lines. The list's Pending is
   *  totalQty − dispatchedQty − shortClosedQty. */
  shortClosedQty: z.number().int().nonnegative().default(0),
  /** ADR-196 — see salesOrderDetailSchema.fulfilmentStatus. */
  fulfilmentStatus: soFulfilmentStatusSchema.nullable().default(null),
  earliestDueDate: z.string().nullable(),
  // 📎 client-PO file link (ISSUE-013): latest active file_registry row with
  // category 'client_po' for this SO; null when none. Mirrors legacy
  // renderSOmaster clientPoFileUrl paperclip (L11866).
  clientPoFilePath: z.string().nullable().default(null),
  // Display name of the user who raised the SO (users.full_name joined on
  // created_by), null when unresolved. Shown as the "Raised By" column.
  createdByName: z.string().nullable().default(null),
});
export type SalesOrderListItem = z.infer<typeof salesOrderListItemSchema>;

// Document traceability for the SO detail page is served by
// GET /sales-orders/:id/related and typed by the shared DocumentTraceability
// schema (packages/shared/src/schemas/traceability.ts), used by every module.

// ─── Write inputs ──────────────────────────────────────────────────────────

/** Per-line input. itemId is preferred; itemCodeText is a fallback for legacy
 *  / unresolved codes (ADR-012 #10). At least one of (itemId, itemCodeText)
 *  must be present. lineNo is optional on input — service auto-assigns the
 *  next free integer if blank. `id` is set when updating an existing line. */
export const salesOrderLineInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    lineNo: z.number().int().positive().optional(),
    itemId: z.string().uuid().optional(),
    itemCodeText: z.string().min(1).max(64).optional(),
    partName: z.string().min(1).max(255),
    material: z.string().max(255).optional(),
    drawingNo: z.string().max(64).nullable().optional(),
    // COMPULSORY, and nothing else on the line changes it. The customer's
    // drawing revision is a fact about the paper, so the person entering the
    // order is the only one who knows it — the server used to derive it from
    // whether a file had been uploaded, which is a different fact entirely.
    //
    // Required rather than optional: "compulsory" has to bite somewhere, and the
    // API boundary is the only place that catches a client which skips the form.
    // Server paths that insert a line without going through this schema (the BOM
    // cascade, JW-sourced lines) fall back to the column default.
    /** ADR-178: upper-cased on the way in ("b" → "B"); letters, digits, . - /
     *  only. Going backwards (B → A, 2 → 1) is refused on update by the server
     *  and the form — see lib/revision.ts. */
    revision: z
      .string()
      .trim()
      .min(1, 'Rev is required')
      .max(32)
      .transform((s) => s.toUpperCase())
      .refine((s) => REVISION_PATTERN.test(s), 'Rev: letters, digits, . - / only'),
    // Uploaded-drawing storage path, set by the web upload flow (qc-docs bucket).
    //
    // Nullable, not merely optional: an ABSENT key means "the payload does not
    // mention the drawing, leave it alone", while an explicit null means "the
    // user cleared it". Those are different intentions and the Rev logic acts
    // on them differently — only the second one records a 'removed' revision.
    // (`undefined` cannot carry the second meaning: JSON.stringify drops the
    // key entirely, which is why clearing a drawing silently did nothing.)
    drawingFilePath: z.string().max(512).nullable().optional(),
    uom: uomSchema.default('NOS'),
    orderQty: z.number().int().positive(), // CHECK > 0 enforced in DB too
    rate: z.coerce.number().nonnegative().default(0),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    clientPoLineNo: z.string().max(64).optional(),
    status: soStatusSchema.optional(),
    // BOM-8 cascade: when set, line creation spawns child JCs / PRs from
    // the BOM's lines (per bom_type). Fires once per line creation;
    // re-saves with same BOM are idempotent (checked by source_so_line_id
    // already-existing children). See modules/bom-master/cascade.ts.
    sourceBomMasterId: z.string().uuid().optional(),
  })
  .refine((l) => Boolean(l.itemId) || Boolean(l.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  });
export type SalesOrderLineInput = z.infer<typeof salesOrderLineInputSchema>;

/** Per-milestone input (ISSUE-015). `id` set when updating an existing lot;
 *  rows absent from an update payload are soft-deleted (line-merge semantics). */
export const salesOrderMilestoneInputSchema = z.object({
  id: z.string().uuid().optional(),
  lotNo: z.number().int().positive(),
  qty: z.coerce.number().int().nonnegative().default(0),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .optional(),
  remarks: z.string().max(500).optional(),
});
export type SalesOrderMilestoneInput = z.infer<typeof salesOrderMilestoneInputSchema>;

// ADR-207 — the SO No. (`code`, IN-SO-#####) is SYSTEM ONLY: it is not part of
// any write input; the server always generates it. Users type the Internal SO
// No. instead (required on create, optional on update).
const _soHeaderInputBase = z.object({
  soDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'soDate must be YYYY-MM-DD'),
  clientId: z.string().uuid().optional(),
  customerName: z.string().max(255).optional(),
  clientPoNo: z.string().max(64).optional(),
  type: soTypeSchema.default('component_manufacturing'),
  status: soStatusSchema.default('open'),
  gstPercent: z.coerce.number().nonnegative().max(99.99).default(18),
  /** The BOM (bom_masters.id) this equipment SO builds — a real uuid FK since
   *  0184. Only an Active BOM may be linked (checked by the server when the
   *  link is set or changed). '' / absent = no BOM. */
  bomMasterId: z.union([z.string().uuid(), z.literal('')]).optional(),
  bomStatus: z.string().max(32).optional(),
  costCenter: z.string().max(64).optional(),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — `{header, lines}`. Header + at least one line; service runs both
 *  inserts in a single transaction. Equipment SOs may legally have an empty
 *  lines array (the equipment itself was modelled as a single line in legacy
 *  but Phase 4 keeps both shapes uniform for now — Equipment with zero lines
 *  is allowed; non-Equipment requires ≥ 1 line). */
export const createSalesOrderInputSchema = z
  .object({
    // Client master link is mandatory (supersedes ADR-012 #9 for SO): an SO
    // must reference a real client; the free-text customerName fallback is
    // removed. The server snapshots customerName from the client master.
    header: _soHeaderInputBase
      .extend({ internalSoNo: internalSoNoInputSchema })
      .refine((h) => Boolean(h.clientId), {
        message: 'A client (from the client master) is required for a Sales Order.',
      }),
    lines: z.array(salesOrderLineInputSchema).default([]),
    milestones: z.array(salesOrderMilestoneInputSchema).optional(),
  })
  .refine((i) => i.header.type === 'equipment' || i.lines.length > 0, {
    message: 'At least one line is required for non-Equipment SOs (legacy line 12442)',
  });
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderInputSchema>;

/** UPDATE — same shape as create. `code` is never accepted (system-only).
 *  `internalSoNo` is optional: absent = unchanged (an old SO with none is not
 *  forced to get one); when sent it must pass the same rule as create. Lines use the
 *  legacy `_editFullSO` merge semantics: id-matched lines are updated, new
 *  lines are inserted, existing lines absent from input are soft-deleted. */
export const updateSalesOrderInputSchema = z.object({
  // Client master link is mandatory on edit too (matches create): every SO must
  // reference a real client. Editing a legacy customerName-only order therefore
  // forces picking a client from the master; the free-text fallback is gone.
  // The server re-snapshots customerName from the chosen client.
  header: _soHeaderInputBase
    .partial()
    .extend({ internalSoNo: internalSoNoInputSchema.optional() })
    .refine((h) => Boolean(h.clientId), {
      message: 'A client (from the client master) is required for a Sales Order.',
    }),
  lines: z.array(salesOrderLineInputSchema).optional(),
  milestones: z.array(salesOrderMilestoneInputSchema).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderInputSchema>;

/** ADR-196 — Close ONE SO line short (ERPNext "Close"): the undelivered qty is
 *  dropped; what was dispatched stays (and can still be billed). Status becomes
 *  'closed' and shortClosedAt/By + reason are stamped. Reason required. Same
 *  shape as the JWSO line short close (ADR-194 R6). */
export const shortCloseSalesOrderLineInputSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});
export type ShortCloseSalesOrderLineInput = z.infer<typeof shortCloseSalesOrderLineInputSchema>;

/** ADR-196 — header "Close": closes short every open line that still has
 *  undelivered qty, with one reason. */
export const closeSalesOrderInputSchema = shortCloseSalesOrderLineInputSchema;
export type CloseSalesOrderInput = ShortCloseSalesOrderLineInput;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listSalesOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / internal SO no / customer / clientPoNo
  status: soStatusSchema.optional(),
  type: soTypeSchema.optional(),
  clientId: z.string().uuid().optional(),
  /** Inclusive lower bound on so_date (YYYY-MM-DD). */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Inclusive upper bound on so_date (YYYY-MM-DD). */
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListSalesOrdersQuery = z.infer<typeof listSalesOrdersQuerySchema>;

export interface ListSalesOrdersResponse {
  items: SalesOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}
