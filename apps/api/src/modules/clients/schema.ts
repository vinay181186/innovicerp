// Re-export shared Zod schemas. Single source of truth in @innovic/shared.
export {
  clientSchema,
  createClientInputSchema,
  listClientsQuerySchema,
  updateClientInputSchema,
} from '@innovic/shared';
export type {
  Client,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from '@innovic/shared';
