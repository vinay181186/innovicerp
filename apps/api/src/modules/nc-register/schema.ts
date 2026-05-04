// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  createNcRegisterInputSchema,
  listNcRegisterQuerySchema,
  ncRegisterListItemSchema,
  ncRegisterSchema,
  updateNcRegisterInputSchema,
} from '@innovic/shared';
export type {
  CreateNcRegisterInput,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterListItem,
  UpdateNcRegisterInput,
} from '@innovic/shared';
