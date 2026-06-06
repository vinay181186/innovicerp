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
  itemName: z.string(),
  orderQty: z.number().int().nonnegative(),
  readyQty: z.number().int().nonnegative(), // produced + QC-accepted (final op)
  dispatchedQty: z.number().int().nonnegative(),
  availableQty: z.number().int().nonnegative(), // ready − dispatched
  rate: z.number().nonnegative(),
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
  itemCode: z.string().nullable(),
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
  itemCode: z.string().nullable(),
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
