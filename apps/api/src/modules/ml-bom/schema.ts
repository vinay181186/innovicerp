// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
import { z } from 'zod';
import {
  ML_BOM_IMPORT_MAX_ROWS,
  mlBomImportInputSchema as sharedMlBomImportInputSchema,
  mlBomImportRowSchema as sharedMlBomImportRowSchema,
} from '@innovic/shared';

export {
  createMlBomInputSchema,
  deleteMlBomInputSchema,
  listMlBomsQuerySchema,
  makeDefaultMlBomInputSchema,
  mlBomCostQuerySchema,
  mlBomImportInputSchema,
  mlBomTreeQuerySchema,
  updateMlBomInputSchema,
} from '@innovic/shared';
export type {
  CreateMlBomInput,
  DeleteMlBomInput,
  ListMlBomsQuery,
  ListMlBomsResponse,
  MakeDefaultMlBomInput,
  MlBom,
  MlBomDetail,
  MlBomExplodedItem,
  MlBomLine,
  MlBomLineInput,
  MlBomListItem,
  MlBomRevision,
  MlBomTreeNode,
  MlBomTreeQuery,
  MlBomTreeResponse,
  UpdateMlBomInput,
} from '@innovic/shared';

// D2 — optional "Drawing Rev" column on the Excel import. The shared import
// row (packages/shared ml-bom-import.ts) is frozen and has no field for it, so
// the API accepts it here as an OPTIONAL extra key: a client that does not send
// it gets exactly the shared contract. Blank / absent → the line is imported
// with no Rev (imports are never refused for a missing Rev — the Fix List
// covers it later); a Rev given → resolved in the register.

export const mlBomImportRowWithRevSchema = sharedMlBomImportRowSchema.extend({
  /** "Drawing Rev" column, as typed. */
  childDrawingRev: z.string().max(40).nullable().optional(),
});
export type MlBomImportRowWithRev = z.infer<typeof mlBomImportRowWithRevSchema>;

export const mlBomImportInputWithRevSchema = sharedMlBomImportInputSchema.extend({
  rows: z
    .array(mlBomImportRowWithRevSchema)
    .min(1, 'The sheet has no rows')
    .max(ML_BOM_IMPORT_MAX_ROWS),
});
export type MlBomImportInputWithRev = z.infer<typeof mlBomImportInputWithRevSchema>;
