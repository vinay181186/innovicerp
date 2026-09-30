import { z } from 'zod';
import { activityReasonSchema } from '@innovic/shared';
// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  bulkCreateItemsInputSchema,
  createItemInputSchema,
  itemSchema,
  listItemsQuerySchema,
  updateItemImportRowSchema,
  updateItemInputSchema,
} from '@innovic/shared';
export type {
  BulkCreateItemsInput,
  BulkCreateItemsResponse,
  BulkItemSkip,
  CreateItemInput,
  Item,
  ItemSaveResponse,
  ListItemsQuery,
  ListItemsResponse,
  UpdateItemInput,
} from '@innovic/shared';

// ADR-197: moving a item to Trash needs a reason (REASON_REQUIRED_ACTIONS).
// Hosted here, not in @innovic/shared (frozen for this build) — the web sends
// `{ reason }` as the DELETE body.
export const deleteItemInputSchema = z.object({ reason: activityReasonSchema });
