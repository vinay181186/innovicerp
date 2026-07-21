import { z } from 'zod';
import { ITEM_TYPES } from '../enums/item-type';
import { UOMS } from '../enums/uom';

export const itemTypeSchema = z.enum(ITEM_TYPES);
export const uomSchema = z.enum(UOMS);

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const itemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable(),
  drawingNo: z.string().max(64).nullable(),
  revision: z.string().min(1).max(8),
  material: z.string().max(64).nullable(),
  uom: uomSchema,
  itemType: itemTypeSchema,
  hsnCode: z.string().max(16).nullable(),
  drawingFilePath: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;

export const createItemInputSchema = z.object({
  // Optional: the server auto-generates the next ITM-#### in the company series
  // when omitted. The form prefills it (editable), and the rules below still
  // apply to any value the user keeps or types.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen')
    .optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  drawingNo: z.string().max(64).optional(),
  revision: z.string().min(1).max(8).default('A'),
  material: z.string().max(64).optional(),
  uom: uomSchema.default('NOS'),
  itemType: itemTypeSchema.default('component'),
  hsnCode: z.string().max(16).optional(),
  drawingFilePath: z.string().optional(),
});
export type CreateItemInput = z.infer<typeof createItemInputSchema>;

export const updateItemInputSchema = createItemInputSchema.partial().omit({ code: true });
export type UpdateItemInput = z.infer<typeof updateItemInputSchema>;

export const itemSortFieldSchema = z.enum(['code', 'name']);
export type ItemSortField = z.infer<typeof itemSortFieldSchema>;

export const listItemsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemType: itemTypeSchema.optional(),
  sortBy: itemSortFieldSchema.optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  // Max 1000: line-editor autocompletes (BOM, Route Card, Job Card) pull the
  // whole item master into a <datalist>. Capped at 200 the API 400'd those
  // requests and the dropdown silently showed nothing. 1000 covers our scale.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;

export interface ListItemsResponse {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}
