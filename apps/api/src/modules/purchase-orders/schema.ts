// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  createPurchaseOrderFromPrInputSchema,
  createPurchaseOrderInputSchema,
  listPurchaseOrdersQuerySchema,
  purchaseOrderDetailSchema,
  purchaseOrderLineSchema,
  purchaseOrderListItemSchema,
  purchaseOrderSchema,
  updatePurchaseOrderInputSchema,
} from '@innovic/shared';
export type {
  CreatePurchaseOrderFromPrInput,
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  PurchaseOrderLineInput,
  PurchaseOrderListItem,
  UpdatePurchaseOrderInput,
} from '@innovic/shared';
