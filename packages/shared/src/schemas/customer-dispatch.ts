// Customer Dispatch shared schemas (migration 0050). Records dispatch of ready
// (produced + QC-accepted) qty against SO lines — the customer Dispatch
// Register that gates invoicing. Legacy dispatchLog / renderDispatchRegister.

import { z } from 'zod';
import { CUSTOMER_DISPATCH_STATUSES } from '../enums/customer-dispatch-status';

// A dispatchable SO line for a chosen SO (the create form).
export const dispatchableLineSchema = z.object({
  salesOrderLineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision typed on this very SO line
   *  (sales_order_lines.revision, migration 0119). It describes the order's
   *  drawing, not the item, so it is never items.revision — that is a different
   *  column and substituting it would put a plausible-looking wrong revision on
   *  the dispatch. Null is correct and renders as the bare code. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) typed on this same SO line — shown
   *  beside the item code on the dispatch form, as on every other document
   *  (user rule, 2026-09-23). Null when the customer's PO gave no line. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string(),
  orderQty: z.number().int().nonnegative(),
  readyQty: z.number().int().nonnegative(), // produced + QC-accepted (final op)
  /** Qty reserved to this SO line from stock (Stage 1) — also dispatchable now,
   *  on top of produced qty. Released back to stock as it ships. */
  reservedQty: z.number().int().nonnegative(),
  dispatchedQty: z.number().int().nonnegative(),
  availableQty: z.number().int().nonnegative(), // min(ready + reserved, order) − dispatched
  /** Still owed to the customer on this line: orderQty − dispatchedQty. */
  pendingQty: z.number().int().nonnegative(),
  /** PHYSICAL stock of this line's item — on the shelf, reserved or not. */
  physicalQty: z.number().int().nonnegative(),
  /** Free stock of this item: physical − reserved to ANY line. A dispatch may
   *  ship this line's own reservation first, then dip into free stock. */
  itemAvailableQty: z.number().int().nonnegative(),
  /** Earliest Customer Dispatch Date among the plans on this SO line — the date
   *  the dispatch team works to. Null when no plan carries one. */
  customerDispatchDate: z.string().nullable().default(null),
  // SO-line unit price — NULL when the viewer's access hides prices.
  rate: z.number().nonnegative().nullable(),
});
export type DispatchableLine = z.infer<typeof dispatchableLineSchema>;

export const dispatchableSoResponseSchema = z.object({
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  customer: z.string().nullable(),
  lines: z.array(dispatchableLineSchema),
});
export type DispatchableSoResponse = z.infer<typeof dispatchableSoResponseSchema>;

export const createCustomerDispatchInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transport: z.string().max(255).optional(),
  vehicleNo: z.string().max(64).optional(),
  remarks: z.string().max(1000).optional(),
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
      }),
    )
    .min(1, 'At least one line with qty > 0 is required'),
});
export type CreateCustomerDispatchInput = z.infer<typeof createCustomerDispatchInputSchema>;

export const customerDispatchLineRowSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int(),
  salesOrderLineId: z.string().uuid().nullable(),
  itemCode: z.string().nullable(), // resolved from items master (items.code)
  /** The customer's drawing revision, read live off the SO line this dispatch
   *  line ships against (customer_dispatch_lines.sales_order_line_id →
   *  sales_order_lines.revision, migration 0119). Never items.revision, which
   *  is a different column about the item master. The salesOrderLineId above is
   *  nullable and the join is a LEFT JOIN, so null arrives here whenever there
   *  is genuinely no SO line behind the shipment — and null must render as the
   *  bare item code, with no slash and no placeholder. */
  itemRevision: z.string().nullable().default(null),
  itemCodeText: z.string().nullable(), // stored snapshot alias (fallback only)
  itemName: z.string(),
  qty: z.number().int(),
});
export type CustomerDispatchLineRow = z.infer<typeof customerDispatchLineRowSchema>;

export const customerDispatchRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  dispatchDate: z.string(),
  salesOrderId: z.string().uuid(),
  soCode: z.string().nullable(),
  customer: z.string().nullable(),
  transport: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  status: z.enum(CUSTOMER_DISPATCH_STATUSES),
  remarks: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  /** Pieces of this dispatch already invoiced (ADR-190) — the same fact the SO
   *  line calls `billedQty`, screen label `Billed`. An invoice line points at
   *  the SO LINE, never at a dispatch, so this is DERIVED: each SO line's
   *  invoiced qty is spread over that line's dispatches oldest first (dispatch
   *  date, then entry time). Cancelled dispatches are never billed. Filled by
   *  the list and every single-dispatch read (detail, create, cancel). */
  billedQty: z.number().int().nonnegative().optional(),
  /** none = nothing invoiced, partial = some, full = billedQty ≥ totalQty. */
  billedStatus: z.enum(['none', 'partial', 'full']).optional(),
});
export type CustomerDispatchRow = z.infer<typeof customerDispatchRowSchema>;

export const customerDispatchDetailSchema = customerDispatchRowSchema.extend({
  lines: z.array(customerDispatchLineRowSchema),
});
export type CustomerDispatchDetail = z.infer<typeof customerDispatchDetailSchema>;

export const listCustomerDispatchesResponseSchema = z.object({
  dispatches: z.array(customerDispatchRowSchema),
});
export type ListCustomerDispatchesResponse = z.infer<typeof listCustomerDispatchesResponseSchema>;

// Line-grain register row — legacy renderDispatchRegister iterated db.dispatchLog
// one row per dispatched item line (Date / JC / SO / CPO Ln / Item / Qty / UOM /
// Customer / Dispatched By / Remarks / Stock B→A). Flattened from dispatch docs.
export const customerDispatchRegisterRowSchema = z.object({
  dispatchId: z.string().uuid(),
  dispatchCode: z.string(),
  status: z.enum(CUSTOMER_DISPATCH_STATUSES),
  date: z.string(),
  jcNo: z.string().nullable(), // codes of the JC(s) feeding the SO line
  soNo: z.string().nullable(),
  clientPoLineNo: z.string().nullable(),
  itemCode: z.string().nullable(), // resolved from items master (items.code)
  /** The customer's drawing revision for this register row, read off the SO
   *  line the dispatch line ships against (sales_order_lines.revision,
   *  migration 0119) — the same LEFT JOIN that already supplies clientPoLineNo
   *  and uom below. Never items.revision. Null is correct wherever the line has
   *  no SO line behind it, and renders as the bare item code. */
  itemRevision: z.string().nullable().default(null),
  itemCodeText: z.string().nullable(), // stored snapshot alias (fallback only)
  itemName: z.string(),
  qty: z.number().int(),
  uom: z.string().nullable(),
  customer: z.string().nullable(),
  dispatchedBy: z.string().nullable(),
  remarks: z.string().nullable(),
  stockBefore: z.number().int().nullable(),
  stockAfter: z.number().int().nullable(),
  currentStock: z.number().int().nullable(), // item on-hand now (summary panel)
});
export type CustomerDispatchRegisterRow = z.infer<typeof customerDispatchRegisterRowSchema>;

export const customerDispatchRegisterResponseSchema = z.object({
  rows: z.array(customerDispatchRegisterRowSchema),
});
export type CustomerDispatchRegisterResponse = z.infer<
  typeof customerDispatchRegisterResponseSchema
>;

// SO dropdown option for the dispatch + invoice create forms.
export const financeSoOptionSchema = z.object({
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  customer: z.string().nullable(),
});
export type FinanceSoOption = z.infer<typeof financeSoOptionSchema>;
