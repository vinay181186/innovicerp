import { activityReasonSchema } from '@innovic/shared';
import { z } from 'zod';

// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  createDeliveryChallanInputSchema,
  createDeliveryChallanLineInputSchema,
  createDeliveryChallanReceiptInputSchema,
  createDeliveryChallanReceiptLineInputSchema,
  dcSendableLineSchema,
  dcSendablePreviewSchema,
  deliveryChallanLineSchema,
  deliveryChallanListItemSchema,
  deliveryChallanReceiptLineSchema,
  deliveryChallanReceiptSchema,
  deliveryChallanReceiptWithLinesSchema,
  deliveryChallanSchema,
  deliveryChallanWithLinesSchema,
  listDeliveryChallansQuerySchema,
} from '@innovic/shared';
export type {
  CreateDeliveryChallanInput,
  CreateDeliveryChallanLineInput,
  CreateDeliveryChallanReceiptInput,
  CreateDeliveryChallanReceiptLineInput,
  DcSendableLine,
  DcSendablePreview,
  DeliveryChallan,
  DeliveryChallanLine,
  DeliveryChallanListItem,
  DeliveryChallanReceipt,
  DeliveryChallanReceiptLine,
  DeliveryChallanReceiptWithLines,
  DeliveryChallanWithLines,
  ListDeliveryChallansQuery,
  ListDeliveryChallansResponse,
} from '@innovic/shared';

// ADR-197 — cancelling a challan needs a reason (REASON_REQUIRED_ACTIONS). Kept
// in this module (packages/shared is frozen for the accountability build); the
// reason is written on the CANCEL activity-log row.
export const cancelDeliveryChallanInputSchema = z.object({ reason: activityReasonSchema });
export type CancelDeliveryChallanInput = z.infer<typeof cancelDeliveryChallanInputSchema>;
