import { z } from 'zod';

// Curated list of entities whose soft-deleted rows surface in /trash.
// Order matches legacy restoreFromTrash + adds common React-era tables.
// Each entry maps to a Postgres table with `deleted_at` + a human label.
export const TRASH_ENTITY_TYPES = [
  'Sales Order',
  'Job Work Order',
  'Job Card',
  'Item',
  'Client',
  'Vendor',
  'Machine',
  'Operator',
  'Purchase Request',
  'Purchase Order',
  'Goods Receipt Note',
  'Delivery Challan',
  'NC Register',
  'BOM Master',
  'Route Card',
  'Cost Center',
  'QC Process',
] as const;
export type TrashEntityType = (typeof TRASH_ENTITY_TYPES)[number];

export const trashEntityTypeSchema = z.enum(TRASH_ENTITY_TYPES);

export const trashListItemSchema = z.object({
  id: z.string().uuid(),
  type: trashEntityTypeSchema,
  label: z.string(),
  deletedAt: z.string(),
  deletedById: z.string().uuid().nullable(),
  deletedByName: z.string().nullable(),
});
export type TrashListItem = z.infer<typeof trashListItemSchema>;

export const listTrashQuerySchema = z.object({
  type: trashEntityTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListTrashQuery = z.infer<typeof listTrashQuerySchema>;

export const listTrashResponseSchema = z.object({
  items: z.array(trashListItemSchema),
  total: z.number().int().nonnegative(),
  byType: z.record(z.number().int().nonnegative()),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ListTrashResponse = z.infer<typeof listTrashResponseSchema>;

export const restoreTrashInputSchema = z.object({
  type: trashEntityTypeSchema,
  id: z.string().uuid(),
});
export type RestoreTrashInput = z.infer<typeof restoreTrashInputSchema>;
