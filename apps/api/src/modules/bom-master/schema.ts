import { activityReasonSchema } from '@innovic/shared';
import { z } from 'zod';

// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  bomLineTypeSchema,
  bomMasterDetailSchema,
  bomMasterLineSchema,
  bomMasterListItemSchema,
  bomMasterRevisionSchema,
  bomMasterSchema,
  bomStatusSchema,
  createBomMasterInputSchema,
  createBomMasterLineInputSchema,
  listBomMastersQuerySchema,
  updateBomMasterInputSchema,
} from '@innovic/shared';
export type {
  BomMaster,
  BomMasterDetail,
  BomMasterLine,
  BomMasterListItem,
  BomMasterRevision,
  CreateBomMasterInput,
  CreateBomMasterLineInput,
  ListBomMastersQuery,
  ListBomMastersResponse,
  UpdateBomMasterInput,
} from '@innovic/shared';

// Delete (ADR-197): the reason is required — it lands on the DELETE row of the
// BOM's History. Module-local because packages/shared is frozen for this change.
export const deleteBomMasterInputSchema = z.object({ reason: activityReasonSchema });
export type DeleteBomMasterInput = z.infer<typeof deleteBomMasterInputSchema>;
