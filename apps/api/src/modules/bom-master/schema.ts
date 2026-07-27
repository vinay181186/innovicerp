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
