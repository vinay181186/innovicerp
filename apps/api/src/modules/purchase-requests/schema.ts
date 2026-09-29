import { activityReasonSchema } from '@innovic/shared';
import { z } from 'zod';

// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  closePurchaseRequestBalanceInputSchema,
  createPurchaseRequestInputSchema,
  listPurchaseRequestsQuerySchema,
  purchaseRequestDetailSchema,
  purchaseRequestListItemSchema,
  purchaseRequestSchema,
  updatePurchaseRequestInputSchema,
} from '@innovic/shared';
export type {
  ClosePurchaseRequestBalanceInput,
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestDetail,
  PurchaseRequestListItem,
  UpdatePurchaseRequestInput,
} from '@innovic/shared';

// ADR-197 — Delete (move to Trash) records WHY. Module-local: the shared PR
// contract has no delete body; the reason rides the DELETE request's JSON body.
export const deletePurchaseRequestInputSchema = z.object({ reason: activityReasonSchema });
export type DeletePurchaseRequestInput = z.infer<typeof deletePurchaseRequestInputSchema>;
