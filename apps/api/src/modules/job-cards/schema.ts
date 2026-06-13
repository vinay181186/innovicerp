// Re-export shared Zod schemas (read-only at this phase per CLAUDE.md §8).
export {
  jcDocInputSchema,
  jcOpInputSchema,
  jobCardCreateInputSchema,
  jobCardListItemSchema,
  jobCardSourceLinkSchema,
  jobCardSourceSoLinkSchema,
  jobCardSourceJwLinkSchema,
  jobCardUpdateInputSchema,
  jobCardWriteInputSchema,
  listJobCardsQuerySchema,
} from '@innovic/shared';
export type {
  JcDocInput,
  JcOpInput,
  JobCardCreateInput,
  JobCardListItem,
  JobCardSourceLink,
  JobCardUpdateInput,
  JobCardWriteInput,
  ListJobCardsQuery,
  ListJobCardsResponse,
} from '@innovic/shared';
