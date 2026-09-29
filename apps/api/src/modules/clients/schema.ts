import { z } from 'zod';
import { activityReasonSchema } from '@innovic/shared';
// Re-export shared Zod schemas. Single source of truth in @innovic/shared.
export {
  bulkCreateClientsInputSchema,
  clientSchema,
  createClientInputSchema,
  listClientsQuerySchema,
  updateClientInputSchema,
} from '@innovic/shared';
export type {
  BulkClientSkip,
  BulkCreateClientsInput,
  BulkCreateClientsResponse,
  Client,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from '@innovic/shared';

// ADR-197: moving a customer to Trash needs a reason (REASON_REQUIRED_ACTIONS).
// Hosted here, not in @innovic/shared (frozen for this build) — the web sends
// `{ reason }` as the DELETE body.
export const deleteClientInputSchema = z.object({ reason: activityReasonSchema });
