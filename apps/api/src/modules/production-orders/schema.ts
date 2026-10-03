// Production Orders (ADR-170) — wire shapes are owned by packages/shared and
// re-exported here so the module reads like its neighbours.
import { z } from 'zod';

export {
  closeProductionOrderInputSchema,
  createProductionOrderInputSchema,
  listProductionOrdersQuerySchema,
  productionOrderCloseSchema,
  productionOrderDetailSchema,
  productionOrderListItemSchema,
  productionOrderSchema,
  reverseProductionOrderCloseInputSchema,
  shortCloseProductionOrderInputSchema,
} from '@innovic/shared';
export type {
  CloseProductionOrderInput,
  CreateProductionOrderInput,
  ListProductionOrdersQuery,
  ListProductionOrdersResponse,
  NextProductionOrderCodeResponse,
  ProductionOrder,
  ProductionOrderClose,
  ProductionOrderDetail,
  ProductionOrderListItem,
  ReverseProductionOrderCloseInput,
  ShortCloseProductionOrderInput,
} from '@innovic/shared';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Edit-approval (ADR-202 Phase 3) — the HEADER fields of a Production Order a
 * user may change after it is created. Module-local (not in the frozen shared
 * contract) because this is the only edit path the PO has.
 *
 * order_qty is deliberately NOT editable: it drives the plan SUM-cap, the Job
 * Card qty snapshot, reservations and the credited / close math, so the order's
 * quantity is reduced with Short Close, never an edit. `orderQty` is accepted
 * here only so the service can REFUSE a changed value with a clear message
 * instead of Zod silently dropping it. The identity columns (planId, itemId,
 * routeCardId, jobCardId, code), the status and the credited / lost / close
 * fields are not in this schema, so Zod strips them and they never reach the
 * service.
 */
export const updateProductionOrderInputSchema = z.object({
  remarks: z.string().trim().max(500).nullable().optional(),
  targetDate: isoDate.optional(),
  actualSize: z.string().trim().max(120).nullable().optional(),
  rawMaterialAvailable: z.boolean().optional(),
  /** Accepted only to be refused — see updateProductionOrderTx. */
  orderQty: z.number().int().positive().optional(),
  /** The requester's note shown on the edit-approval request. */
  reason: z.string().trim().max(500).nullable().optional(),
  /** §20.4 optimistic-lock token the form loaded the order with. */
  expectedUpdatedAt: z.string().optional(),
});
export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderInputSchema>;
