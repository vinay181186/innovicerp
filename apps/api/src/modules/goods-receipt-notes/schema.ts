// Re-export shared Zod schemas (CLAUDE.md §8 — shared is the source of truth).
export {
  createGoodsReceiptNoteInputSchema,
  goodsReceiptNoteDetailSchema,
  goodsReceiptNoteLineSchema,
  goodsReceiptNoteListItemSchema,
  goodsReceiptNoteSchema,
  listGoodsReceiptNotesQuerySchema,
  updateGoodsReceiptNoteInputSchema,
} from '@innovic/shared';
export type {
  CreateGoodsReceiptNoteInput,
  GoodsReceiptNote,
  GoodsReceiptNoteDetail,
  GoodsReceiptNoteLine,
  GoodsReceiptNoteLineInput,
  GoodsReceiptNoteListItem,
  ListGoodsReceiptNotesQuery,
  ListGoodsReceiptNotesResponse,
  UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
