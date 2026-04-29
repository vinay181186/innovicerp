// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  createItemInputSchema,
  itemSchema,
  listItemsQuerySchema,
  updateItemInputSchema,
} from '@innovic/shared';
export type {
  CreateItemInput,
  Item,
  ListItemsQuery,
  ListItemsResponse,
  UpdateItemInput,
} from '@innovic/shared';
