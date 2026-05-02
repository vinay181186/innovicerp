// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  createPurchaseRequestInputSchema,
  listPurchaseRequestsQuerySchema,
  purchaseRequestListItemSchema,
  purchaseRequestSchema,
  updatePurchaseRequestInputSchema,
} from '@innovic/shared';
export type {
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestListItem,
  UpdatePurchaseRequestInput,
} from '@innovic/shared';
