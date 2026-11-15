// Rev Substitutions — query / param shapes local to the routes. The row and
// the create input live in packages/shared (schemas/engineering-change.ts).

import { sfRawParamSchema } from '@innovic/shared';
import { z } from 'zod';

export const listRevSubstitutionsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  itemId: z.string().uuid().optional(),
  salesOrderLineId: z.string().uuid().optional(),
  jobCardId: z.string().uuid().optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListRevSubstitutionsQuery = z.infer<typeof listRevSubstitutionsQuerySchema>;

export const cancelRevSubstitutionInputSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .default({});
export type CancelRevSubstitutionInput = z.infer<typeof cancelRevSubstitutionInputSchema>;
