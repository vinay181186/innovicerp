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

// ADR-202 Phase 3 — the OSP DC EDIT payload. Module-local (packages/shared is
// frozen): the DC create shape is in shared, but the update one is not, exactly
// as the cancel-reason body above stays module-local. The frontend sends the
// matching shape (header travel details + one entry per EXISTING line); the line
// SET is fixed (a DC's items come from the PO selection at create), so add /
// remove is refused in the service — only qty / material / remarks may change.
export const updateDeliveryChallanInputSchema = z.object({
  // Optimistic-lock token (ADR-202 / §20.4). When absent the engine falls back
  // to the freshly-locked row.
  expectedUpdatedAt: z.string().optional(),
  // Header travel details — the same three the create form carries.
  dcDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  transport: z.string().nullable().optional(),
  vehicleNo: z.string().nullable().optional(),
  // One entry per EXISTING DC line, keyed by delivery_challan_lines.id — the same
  // id the staged-edit diff uses in its `line:<id>:qty` change key. qty drives
  // the op counter (jc_ops.outsource_sent_qty); 0 is allowed (send nothing on
  // that line), the service refuses an edit where every line is 0. materialText /
  // dcRemarks are kept at their current value when omitted.
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty: z.coerce.number().nonnegative(),
        materialText: z.string().nullable().optional(),
        dcRemarks: z.string().nullable().optional(),
      }),
    )
    .min(1, 'At least one line is required'),
  // Rides along for the activity-log entry on a direct (non-staged) edit (ADR-197).
  reason: z.string().max(1000).optional(),
});
export type UpdateDeliveryChallanInput = z.infer<typeof updateDeliveryChallanInputSchema>;
