// Delivery Challan shared schemas (T-040a — read-only).
//
// Header + lines per ADR-017. T-040a exposes list + detail only — no create
// or edit path yet. The legacy `printChallan` flow (legacy line 26133) creates
// DCs against JW POs with cascade into `jc_ops.sentQty` / outsourceStatus
// transitions; that lands in a future task once the dispatch UX is defined.
//
// Two read shapes:
//   - DeliveryChallan (table row); DeliveryChallanWithLines bundles lines for
//     detail page; DeliveryChallanListItem joins vendor name + po code + line
//     aggregates for the list view.

import { z } from 'zod';
import { DC_STATUSES } from '../enums/dc-status';
import { positiveQtySchema, qtyUomProblem } from '../lib/qty-rule';
import { uomSchema } from './item';
import { sfRawParamSchema } from './list-query';

export const dcStatusSchema = z.enum(DC_STATUSES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const deliveryChallanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  dcDate: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  poCodeText: z.string(),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string(),
  salesOrderLineId: z.string().uuid().nullable(),
  soRefText: z.string().nullable(),
  transport: z.string().nullable(),
  // Vehicle number the goods left on. Kept separate from `transport`
  // (the transporter's NAME) because the OSP DC print and the gate
  // register need the two apart. Same column name/type as the four
  // tables that already carry one: jw_dc_outward, jw_dc_inward,
  // jw_return_challans, customer_dispatches.
  // Non-optional on purpose: every read path that returns `transport`
  // must return this too, and typecheck is what enforces it.
  vehicleNo: z.string().nullable(),
  // ── Return-to-vendor challan raised from an NC (design §5) ──────────────
  /** The NC this challan returns pieces for; null on an ordinary OSP DC. When
   *  set there is no purchase order: `poCodeText` carries the NC code. */
  ncId: z.string().uuid().nullable().default(null),
  ncCode: z.string().nullable().default(null),
  jobCardId: z.string().uuid().nullable().default(null),
  jobCardCode: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  status: dcStatusSchema,
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallan = z.infer<typeof deliveryChallanSchema>;

export const deliveryChallanLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  deliveryChallanId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  // Live items-master code/name resolved via LEFT JOIN on itemId (null when the
  // line has no FK or the item was deleted); itemCodeText/itemNameText remain the
  // issue-time snapshot fallback.
  itemCode: z.string().nullable(),
  /** The customer's drawing revision — but ONLY when this challan line provably
   *  IS the customer's part, and null otherwise.
   *
   *  A DC line is a copy of a purchase-order line, and a PO line is not always
   *  the finished part: on a buying PO it is raw material, and on some job-work
   *  POs it is bought-in hardware. Printing the customer's drawing revision
   *  beside a bar of EN8 would state something false, so the API only fills
   *  this in when the chain dcl.purchase_order_line_id →
   *  purchase_order_lines.source_so_line_id → sales_order_lines lands on an SO
   *  line whose item_id is the SAME item as the challan line's. That is exactly
   *  the OSP case (the auto-raised job-work PR carries the job card's item, so
   *  the piece going to the vendor is the customer's part), and it excludes raw
   *  material and bought-in lines by construction.
   *
   *  Source is sales_order_lines.revision (migration 0119), never
   *  items.revision — a different column about the item master. Null renders as
   *  the bare code, with no slash and no placeholder; the challan HEADER still
   *  carries `soLineRevision` for the SO the whole document was raised under. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a stock-replenishment purchase, a vendor
   *  return, a line whose SO line was deleted). Read-only: the Sales Order is
   *  the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  qty: z.string(),
  uom: uomSchema,
  materialText: z.string().nullable(),
  dcRemarks: z.string().nullable(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallanLine = z.infer<typeof deliveryChallanLineSchema>;

export const deliveryChallanWithLinesSchema = deliveryChallanSchema.extend({
  vendorName: z.string().nullable(),
  poCode: z.string().nullable(), // resolved from purchase_orders when purchaseOrderId set
  soCode: z.string().nullable(), // resolved through sales_order_lines → sales_orders
  soInternalNo: z.string().nullable().optional(), // ADR-207 Internal SO No. of that SO, live
  /** The customer's drawing revision of the SO LINE this challan hangs off —
   *  a header-level fact, deliberately not named `itemRevision`, because on a
   *  delivery challan it belongs beside the SO number and not beside a line's
   *  item code (see the note on the line's own `itemRevision`).
   *
   *  It follows soCode exactly: the DC's own sales_order_line_id first, then
   *  the SO line(s) behind the PO's lines. That fallback is an aggregate over
   *  many PO lines, so it is filled in only when every one of them agrees on a
   *  single revision — otherwise null, because "SO-11, SO-12" has no one
   *  drawing revision and inventing one would be a lie. Source is
   *  sales_order_lines.revision (migration 0119), never items.revision. Null is
   *  correct and prints as nothing at all, not an empty "Rev". */
  soLineRevision: z.string().nullable().default(null),
  lines: z.array(deliveryChallanLineSchema),
  // T-059b — receipts are included on the detail load so the UI can render
  // the receipt history + cumulative received/rejected aggregates per line.
  receipts: z.array(z.lazy(() => deliveryChallanReceiptSchema)).default([]),
});
export type DeliveryChallanWithLines = z.infer<typeof deliveryChallanWithLinesSchema>;

export const deliveryChallanListItemSchema = deliveryChallanSchema.extend({
  vendorName: z.string().nullable(),
  poCode: z.string().nullable(),
  soCode: z.string().nullable(),
  soInternalNo: z.string().nullable().optional(), // ADR-207 Internal SO No. of that SO, live
  /** Header-level drawing revision of the SO line behind this challan — see the
   *  full note on the detail shape above. Same rule, same nulls. */
  soLineRevision: z.string().nullable().default(null),
  lineCount: z.number().int().nonnegative(),
  totalQty: z.string(), // sum of lines.qty as numeric string
});
export type DeliveryChallanListItem = z.infer<typeof deliveryChallanListItemSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listDeliveryChallansQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / po_code_text / vendor name
  status: dcStatusSchema.optional(),
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDeliveryChallansQuery = z.infer<typeof listDeliveryChallansQuerySchema>;

/** Legacy renderDispatchRegister L10756–10770 — 3-tile KPI strip above the
 *  table. totalDispatched = Σ lines.qty across all DCs (matching the filter
 *  set), entryCount = total DC lines, itemCount = COUNT(DISTINCT item). */
export const dispatchSummarySchema = z.object({
  totalDispatched: z.number().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
});
export type DispatchSummary = z.infer<typeof dispatchSummarySchema>;

export interface ListDeliveryChallansResponse {
  items: DeliveryChallanListItem[];
  total: number;
  limit: number;
  offset: number;
  /** PL-DR-1b — overall totals across all (non-deleted) DCs matching the
   *  filter set. Drives the KPI strip on /delivery-challans. */
  summary: DispatchSummary;
}

// ─── Write shapes (T-059a) ─────────────────────────────────────────────────

export const createDeliveryChallanLineInputSchema = z
  .object({
    lineNo: z.number().int().positive().optional(),
    // FK when the line item is in the master, else null with itemCodeText as the
    // human identifier (ADR-012 #10) — mirrors the Job-Work PO line this DC copies.
    itemId: z.string().uuid().nullable().optional(),
    itemCodeText: z.string().min(1),
    itemNameText: z.string().nullable().optional(),
    /** Decimals follow the unit (S9): up to 3 places (numeric(14,3), 0184);
     *  a whole-number unit (NOS / SET) is refused a fraction. */
    qty: positiveQtySchema,
    uom: uomSchema,
    materialText: z.string().nullable().optional(),
    dcRemarks: z.string().nullable().optional(),
    purchaseOrderLineId: z.string().uuid().nullable().optional(),
  })
  .superRefine((l, ctx) => {
    const problem = qtyUomProblem(l.qty, l.uom, `${l.itemCodeText}: Qty`);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['qty'], message: problem });
  });
export type CreateDeliveryChallanLineInput = z.infer<typeof createDeliveryChallanLineInputSchema>;

export const createDeliveryChallanInputSchema = z.object({
  header: z.object({
    // Optional — blank means the server auto-generates the next IN-DC-##### code.
    code: z.string().trim().optional(),
    dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    purchaseOrderId: z.string().uuid().nullable().optional(),
    poCodeText: z.string().min(1),
    // FK when the vendor is in the master, else null with vendorCodeText as the
    // human identifier (ADR-015) — mirrors the Job-Work PO this DC is issued from.
    vendorId: z.string().uuid().nullable().optional(),
    /** The VENDOR's code — never the PO number (A32). Optional when vendorId is
     *  set: the server stores the vendor master's code. Required otherwise. */
    vendorCodeText: z.string().min(1).optional(),
    salesOrderLineId: z.string().uuid().nullable().optional(),
    soRefText: z.string().nullable().optional(),
    transport: z.string().nullable().optional(),
    vehicleNo: z.string().nullable().optional(),
    /** ADR-208 — the store ticked "These are new pieces, not the ones waiting
     *  to go back". Required only when a PO line on this challan has pieces
     *  waiting on a return-to-vendor NC (ready or awaiting the QC decision);
     *  without it the save is refused with details.kind = 'rtv_pending'.
     *  Not stored — it is a confirmation, not a fact about the challan. */
    rtvPendingConfirmed: z.boolean().optional(),
  }),
  lines: z.array(createDeliveryChallanLineInputSchema).min(1),
});
export type CreateDeliveryChallanInput = z.infer<typeof createDeliveryChallanInputSchema>;

// ─── Return to Vendor by JW PO / DC No. (ADR-208) ──────────────────────────
// The "Against JW PO / DC" source on +New DC: the store searches by the JW PO
// No. or the DC No. the pieces first went out on, and gets the return-to-vendor
// NCs behind it. The challan itself is still raised by POST
// /nc-register/:id/create-dc (createNcDc) — this list only FINDS the NC, so the
// one-challan-per-NC lock and the RTV counting stay in one place.

export const RTV_CANDIDATE_STATES = [
  /** QC disposed the NC Return to Vendor and no challan exists yet — the exact
   *  predicate createNcDc accepts (same SQL as pendingRtvChallan). */
  'ready',
  /** Vendor-sourced NC still pending QC's decision — shown greyed, never
   *  selectable. */
  'awaiting_decision',
] as const;
export const rtvCandidateStateSchema = z.enum(RTV_CANDIDATE_STATES);
export type RtvCandidateState = z.infer<typeof rtvCandidateStateSchema>;

export const rtvCandidateSchema = z.object({
  ncId: z.string().uuid(),
  ncCode: z.string(),
  ncDate: z.string(),
  state: rtvCandidateStateSchema,
  itemId: z.string().uuid().nullable(),
  itemCode: z.string().nullable(),
  itemCodeText: z.string().nullable(),
  itemRevision: z.string().nullable(),
  itemName: z.string().nullable(),
  itemNameText: z.string().nullable(),
  /** The NC's rejected qty — exactly what the return challan line will carry. */
  rejectedQty: z.string(),
  clientPoLineNo: z.string().nullable(),
  jobCardId: z.string().uuid().nullable(),
  jcCode: z.string().nullable(),
  opSeq: z.number().int().nullable(),
  /** The JW PO the pieces belong to — resolved exactly as createNcDc resolves
   *  the challan's PO line (origin outsource op's PO line, else the rejected
   *  GRN line's PO line). Null when it cannot be resolved. */
  purchaseOrderId: z.string().uuid().nullable(),
  poCode: z.string().nullable(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  /** The OSP DC the rejected pieces came back on (the NC's GRN → its DC).
   *  Null for an NC logged at the op with no GRN. */
  sourceDeliveryChallanId: z.string().uuid().nullable(),
  sourceDeliveryChallanCode: z.string().nullable(),
  /** Default return vendor — the NC's source vendor (createNcDc's default). */
  vendorId: z.string().uuid().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
});
export type RtvCandidate = z.infer<typeof rtvCandidateSchema>;

export const listRtvCandidatesQuerySchema = z.object({
  /** Narrow to one JW PO (the Against PO warning). Absent = every candidate. */
  purchaseOrderId: z.string().uuid().optional(),
});
export type ListRtvCandidatesQuery = z.infer<typeof listRtvCandidatesQuerySchema>;

export interface ListRtvCandidatesResponse {
  items: RtvCandidate[];
}

/** details on the 409 the Against PO save answers with when RTV pieces are
 *  waiting on one of its PO lines and rtvPendingConfirmed was not sent. */
export interface RtvPendingConflictDetails {
  kind: 'rtv_pending';
  ncs: { ncCode: string; rejectedQty: string; state: RtvCandidateState; poLineId: string }[];
}

// ─── Receipts (T-059b — outsource receive-back) ────────────────────────────

export const deliveryChallanReceiptLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  receiptId: z.string().uuid(),
  deliveryChallanLineId: z.string().uuid(),
  receivedQty: z.string(),
  rejectedQty: z.string(),
  rejectReason: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallanReceiptLine = z.infer<typeof deliveryChallanReceiptLineSchema>;

export const deliveryChallanReceiptSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  deliveryChallanId: z.string().uuid(),
  receiptCode: z.string(),
  receiptDate: z.string(),
  vendorInvoiceText: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  lines: z.array(deliveryChallanReceiptLineSchema),
});
export type DeliveryChallanReceipt = z.infer<typeof deliveryChallanReceiptSchema>;

// Receipt code is auto-generated by the service from the parent DC code, so
// the input shape is just: which DC, when, optional vendor invoice + remarks,
// plus per-line received qty. There is NO reject at receive: everything
// received lands on an auto-GRN as pending QC, and the accept/reject decision
// (with its defect record) is made at Incoming QC — the single reject surface.

export const createDeliveryChallanReceiptLineInputSchema = z.object({
  deliveryChallanLineId: z.string().uuid(),
  /** Up to 3 decimals (S9); the service refuses a fraction for a NOS / SET line. */
  receivedQty: positiveQtySchema,
  remarks: z.string().nullable().optional(),
});
export type CreateDeliveryChallanReceiptLineInput = z.infer<
  typeof createDeliveryChallanReceiptLineInputSchema
>;

export const createDeliveryChallanReceiptInputSchema = z.object({
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendorInvoiceText: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  lines: z.array(createDeliveryChallanReceiptLineInputSchema).min(1),
});
export type CreateDeliveryChallanReceiptInput = z.infer<
  typeof createDeliveryChallanReceiptInputSchema
>;

// Receipt-with-lines is the shape returned by the receive endpoint AND
// included in the DC detail load (each DC has 0..N receipts).
export const deliveryChallanReceiptWithLinesSchema = deliveryChallanReceiptSchema;
export type DeliveryChallanReceiptWithLines = z.infer<typeof deliveryChallanReceiptWithLinesSchema>;

/** What POST /delivery-challans/:id/receive answers with: the refreshed DC
 *  (same shape the detail page loads) PLUS the GRN the receive just raised.
 *  The GRN screen's "Against JWPO / DC" tab lands on that GRN after saving,
 *  so it needs the id back in the same response — before this the caller
 *  could only guess it from the list. Null only when nothing was received
 *  (every line 0), which the input schema already refuses. */
export const receiveDeliveryChallanResponseSchema = deliveryChallanWithLinesSchema.extend({
  autoGrn: z
    .object({
      id: z.string().uuid(),
      code: z.string(),
    })
    .nullable()
    .default(null),
});
export type ReceiveDeliveryChallanResponse = z.infer<typeof receiveDeliveryChallanResponseSchema>;

// ─── How many pieces may go out now (send-qty preview) ─────────────────────
//
// The DC form used to cap the Send Now box at the PO line quantity, which is
// the wrong number: what may actually leave depends on how far the shop floor
// has got and on what earlier challans already sent. So the user typed a qty
// the form accepted, pressed Save, and only then met a red server error. This
// shape carries the real cap back to the form so the answer arrives while the
// number is being typed.
//
// The API computes it with the same helper the save-time guard uses, so the
// number shown here is the number the challan will accept.

export const dcSendableLimitKindSchema = z.enum([
  /** Nothing narrows the line — the PO quantity is the only cap. */
  'po_qty',
  /** Earlier challans have already shipped part of this PO line. */
  'po_balance',
  /** Every piece on the line has gone out. Not a warning: the line is DONE,
   *  and the screen colours it calmly rather than in alarm. */
  'fully_sent',
  /** The operation behind the line has received nothing yet — the operation
   *  before it has not cleared a single piece. */
  'not_started',
  /** Everything the operation has received is already at the vendor. Waiting
   *  on the operation before it, not on anything the user can do here. */
  'at_vendor',
  /** The balance was finished IN-HOUSE on this operation (ADR-081 dual lane),
   *  so there is nothing left to outsource. */
  'done_in_house',
  /** The job-card operation behind the line has not cleared that many yet —
   *  the general case, when none of the sharper ones above fits. */
  'operation',
  /** A JWSO job card still waiting on the client's material. */
  'material',
  /** A job-work PO line with no operation linked — nothing can be checked,
   *  so nothing may be sent until the link is repaired. */
  'not_linked',
]);
export type DcSendableLimitKind = z.infer<typeof dcSendableLimitKindSchema>;

export const dcSendableLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  /** The most this line may go out on this challan, every rule considered. */
  maxSendNow: z.number().int().nonnegative(),
  limitKind: dcSendableLimitKindSchema,
  /** Plain-English explanation of the cap, written server-side so the form and
   *  the save-time guard can never word the same limit differently. Null when
   *  the PO quantity is the only thing in the way. */
  limitReason: z.string().nullable(),
  /** Where the line's work sits, for a message that names the job rather than
   *  a uuid. Null on a buying PO line with no operation behind it. */
  jobCardCode: z.string().nullable(),
  opSeq: z.number().int().nullable(),
});
export type DcSendableLine = z.infer<typeof dcSendableLineSchema>;

export const dcSendablePreviewSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  lines: z.array(dcSendableLineSchema),
});
export type DcSendablePreview = z.infer<typeof dcSendablePreviewSchema>;
