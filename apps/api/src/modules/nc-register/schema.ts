// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  closeNcReworkInputSchema,
  createNcDcInputSchema,
  createNcDcResultSchema,
  createNcRegisterInputSchema,
  disposeNcInputSchema,
  disposeNcResultSchema,
  listNcRegisterQuerySchema,
  ncRegisterListItemSchema,
  ncRegisterSchema,
  ncRegisterSummarySchema,
  updateNcRegisterInputSchema,
} from '@innovic/shared';
export type {
  CloseNcReworkInput,
  CreateNcDcInput,
  CreateNcDcResult,
  CreateNcRegisterInput,
  DisposeNcInput,
  DisposeNcResult,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterListItem,
  NcRegisterSummary,
  UpdateNcRegisterInput,
} from '@innovic/shared';
