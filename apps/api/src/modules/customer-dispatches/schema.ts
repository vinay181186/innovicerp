// Customer Dispatch module-local schemas.
//
// The shared contract (packages/shared) is FROZEN and carries no
// UpdateCustomerDispatchInput, so the Dispatch EDIT payload is defined here —
// the repo convention for an input that is not (yet) in shared, exactly as the
// cancel-reason body is module-local in routes.ts. The frontend declares the
// matching shape in apps/web/src/modules/customer-dispatches/api.ts; the fields
// below mirror it so the PATCH validates the real payload.

import { z } from 'zod';

export const updateCustomerDispatchInputSchema = z.object({
  // Optimistic-lock token (ADR-202 / §20.4). The current edit screen does not
  // send it yet; when absent the engine falls back to the freshly-locked row.
  expectedUpdatedAt: z.string().optional(),
  // Header travel details — the same ones the create form carries.
  dispatchDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  transport: z.string().max(255).nullable().optional(),
  vehicleNo: z.string().max(64).nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
  // One entry per EXISTING dispatch line, keyed by customer_dispatch_lines.id —
  // the same id the staged-edit diff uses in its `line:<id>:qty` change key. The
  // line SET is fixed (a dispatch's items come from the SO selection at create);
  // only the Dispatch Qty may change. 0 is allowed (ship nothing on that line);
  // the service refuses an edit where every line is 0.
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1, 'At least one line is required'),
  // Rides along for the activity-log entry on a direct (non-staged) edit (ADR-197).
  reason: z.string().max(1000).optional(),
});
export type UpdateCustomerDispatchInput = z.infer<typeof updateCustomerDispatchInputSchema>;
