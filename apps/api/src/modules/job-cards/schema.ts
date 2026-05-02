// Re-export shared Zod schemas (read-only at this phase per CLAUDE.md §8).
export {
  jobCardListItemSchema,
  jobCardSourceLinkSchema,
  jobCardSourceSoLinkSchema,
  jobCardSourceJwLinkSchema,
  listJobCardsQuerySchema,
} from '@innovic/shared';
export type {
  JobCardListItem,
  JobCardSourceLink,
  ListJobCardsQuery,
  ListJobCardsResponse,
} from '@innovic/shared';
