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
