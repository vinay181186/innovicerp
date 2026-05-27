// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  closeNcReworkInputSchema,
  createNcRegisterInputSchema,
  disposeNcInputSchema,
  listNcRegisterQuerySchema,
  ncRegisterListItemSchema,
  ncRegisterSchema,
  ncRegisterSummarySchema,
  updateNcRegisterInputSchema,
} from '@innovic/shared';
export type {
  CloseNcReworkInput,
  CreateNcRegisterInput,
  DisposeNcInput,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterListItem,
  NcRegisterSummary,
  UpdateNcRegisterInput,
} from '@innovic/shared';
