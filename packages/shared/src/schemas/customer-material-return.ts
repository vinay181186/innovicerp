// Customer Material Return shared schemas (ADR-203, owner D3).
//
// The numbered challan (IN-CMR-#####) that sends the CUSTOMER'S OWN raw
// material back to them. Not to be confused with the JW Return (JW Dispatch),
// which sends back the FINISHED parts we machined. Two kinds of line:
//   good     — spare QC-accepted material from the customer-material register
//              (posts a 'return' / out row against the JWSO line)
//   rejected — pieces Incoming QC rejected on a Party GRN line, held until now
//              (raises party_grn_lines.rejected_returned_qty; never in the
//              register, because rejected pieces never entered it)
// Cancel reverses every line. Gated by party_create (entry to create, edit +
// approve to cancel).

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const CUSTOMER_MATERIAL_RETURN_KINDS = ['good', 'rejected'] as const;
export type CustomerMaterialReturnKind = (typeof CUSTOMER_MATERIAL_RETURN_KINDS)[number];
export const customerMaterialReturnKindSchema = z.enum(CUSTOMER_MATERIAL_RETURN_KINDS);

export const customerMaterialReturnLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int().positive(),
  kind: customerMaterialReturnKindSchema,
  jwLineId: z.string().uuid(),
  /** JWSO line no. + the finished part's code, for display. */
  jwLineNo: z.number().int().positive().nullable(),
  partCode: z.string().nullable(),
  partyMaterialId: z.string().uuid(),
  partyMaterialCode: z.string().nullable(),
  rmItemCode: z.string().nullable(),
  rmItemName: z.string().nullable(),
  /** Set for kind 'rejected' — the Party GRN line the rejected pieces came in on. */
  partyGrnLineId: z.string().uuid().nullable(),
  partyGrnCode: z.string().nullable(),
  qty: z.number().int().positive(),
});
export type CustomerMaterialReturnLine = z.infer<typeof customerMaterialReturnLineSchema>;

export const customerMaterialReturnSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  returnDate: z.string(),
  jobWorkOrderId: z.string().uuid(),
  jwCode: z.string().nullable(),
  clientId: z.string().uuid().nullable(),
  clientName: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  status: z.enum(['issued', 'cancelled']),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  totalQty: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type CustomerMaterialReturn = z.infer<typeof customerMaterialReturnSchema>;

export const customerMaterialReturnDetailSchema = customerMaterialReturnSchema.extend({
  lines: z.array(customerMaterialReturnLineSchema),
});
export type CustomerMaterialReturnDetail = z.infer<typeof customerMaterialReturnDetailSchema>;

/** What can still go back for one JWSO — feeds the create modal. */
export const customerMaterialReturnableRowSchema = z.object({
  kind: customerMaterialReturnKindSchema,
  jwLineId: z.string().uuid(),
  jwLineNo: z.number().int().positive(),
  partCode: z.string().nullable(),
  partyMaterialId: z.string().uuid(),
  partyMaterialCode: z.string(),
  rmItemCode: z.string().nullable(),
  partyGrnLineId: z.string().uuid().nullable(),
  partyGrnCode: z.string().nullable(),
  /** good: the line's register balance (accepted − issued + returned-to-store
   *  − already returned to customer), also capped by the material's stock.
   *  rejected: rejected − rejected already returned. */
  returnableQty: z.number().int().nonnegative(),
});
export type CustomerMaterialReturnableRow = z.infer<typeof customerMaterialReturnableRowSchema>;

export const createCustomerMaterialReturnInputSchema = z.object({
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderId: z.string().uuid(),
  vehicleNo: z.string().trim().max(32).optional(),
  remarks: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        kind: customerMaterialReturnKindSchema,
        jwLineId: z.string().uuid(),
        /** Required for kind 'rejected'. */
        partyGrnLineId: z.string().uuid().optional(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});
export type CreateCustomerMaterialReturnInput = z.infer<
  typeof createCustomerMaterialReturnInputSchema
>;

export const cancelCustomerMaterialReturnInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelCustomerMaterialReturnInput = z.infer<
  typeof cancelCustomerMaterialReturnInputSchema
>;

export const listCustomerMaterialReturnsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  jobWorkOrderId: z.string().uuid().optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListCustomerMaterialReturnsQuery = z.infer<
  typeof listCustomerMaterialReturnsQuerySchema
>;

export interface ListCustomerMaterialReturnsResponse {
  items: CustomerMaterialReturn[];
  total: number;
  limit: number;
  offset: number;
}
