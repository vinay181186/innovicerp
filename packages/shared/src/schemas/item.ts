import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { queryBoolean } from '../lib/query-boolean';
import { sfRawParamSchema } from './list-query';
import { ITEM_TYPES } from '../enums/item-type';
import { ITEM_PROCUREMENT_TYPES } from '../enums/item-procurement-type';
import { UOMS } from '../enums/uom';
import type { MasterRuleWarnings } from '../lib/master-rules';
import {
  type MasterImportResult,
  type MasterImportRowResult,
  masterImportOptionsSchema,
} from './master-import';

export const itemTypeSchema = z.enum(ITEM_TYPES);
export const itemProcurementTypeSchema = z.enum(ITEM_PROCUREMENT_TYPES);
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
  /** ADR-171: 'make' (planned & produced) | 'buy' (purchased finished — the
   *  Planning line offers "+ PR" instead of "+ Plan"). Default 'make'. */
  procurementType: itemProcurementTypeSchema.default('make'),
  /** ADR-193 phase 4 — Tool / Instrument items only: one register row per
   *  piece (Serial No., calibration). Locked once stock or instruments exist. */
  trackSerial: z.boolean().default(false),
  hsnCode: z.string().max(16).nullable(),
  /** Legacy item-level drawing (ADR-032). The drawing now lives on the SO/JWSO line
   *  (user decision 2026-09-21); this stays readable for old items only. */
  drawingFilePath: z.string().nullable(),
  /** Product image (3D render) — storage path in the private bucket, folder
   *  `item-images`. Shown as the fixed-size thumbnail next to code · name everywhere. */
  imagePath: z.string().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;
/** A create / update answer: the saved item + any warn-mode HSN problem. */
export type ItemSaveResponse = Item & MasterRuleWarnings;

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
  // ADR-193 / owner decision Q2: chosen when the item is created — no default.
  itemType: z.enum(ITEM_TYPES, { errorMap: () => ({ message: 'Choose the Item Type' }) }),
  procurementType: itemProcurementTypeSchema.default('make'),
  /** Tool / Instrument only (server refuses it on any other type). */
  trackSerial: z.boolean().optional(),
  hsnCode: z.string().max(16).optional(),
  drawingFilePath: z.string().optional(),
  /** null clears the image on update. */
  imagePath: z.string().max(512).nullable().optional(),
});
export type CreateItemInput = z.infer<typeof createItemInputSchema>;

export const updateItemInputSchema = createItemInputSchema
  .partial()
  .omit({ code: true })
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });
export type UpdateItemInput = z.infer<typeof updateItemInputSchema>;

/** BULK IMPORT — the Excel importer's whole sheet in ONE request.
 *
 *  One request, one transaction, one list reload (the per-row POST loop took
 *  ~1 row per second). Each row is checked on its own on the server — a bad
 *  row is reported and left out, the rest go in (ERPNext Data Import). `mode`
 *  'update' matches rows by Item Code and writes only the filled cells (Item
 *  Type is not changed by import — use the item screen, which runs the stock
 *  lock); `dryRun` is the preview (see master-import.ts). Capped at 2000 rows. */
export const bulkCreateItemsInputSchema = masterImportOptionsSchema.extend({
  items: z.array(z.unknown()).min(1).max(2000),
});
export type BulkCreateItemsInput = z.input<typeof bulkCreateItemsInputSchema>;

/** Update Existing: one row — Item Code required, every other field optional
 *  (a missing field is left as it is). */
export const updateItemImportRowSchema = createItemInputSchema
  .partial()
  .extend({ code: z.string().trim().min(1, 'Item Code is required to update') });

/** One row the bulk import refused, with the reason in the user's words. */
export type BulkItemSkip = Pick<MasterImportRowResult, 'index' | 'name'> & { reason: string };

export interface BulkCreateItemsResponse extends MasterImportResult {
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkItemSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const itemSortFieldSchema = z.enum(['code', 'name']);
export type ItemSortField = z.infer<typeof itemSortFieldSchema>;

export const listItemsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemType: itemTypeSchema.optional(),
  /** ADR-195: when true, hide party-owned item types (Party Supplied Material)
   *  from the list. The general "what are we making / selling / buying" line-item
   *  pickers pass this so a customer's own material can't be chosen on a normal
   *  line; the Item Master list and the JWSO Customer Material picker do not. */
  excludePartyOwned: queryBoolean().optional(),
  procurementType: itemProcurementTypeSchema.optional(),
  sortBy: itemSortFieldSchema.optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  /** Sort & Filter (ADR-200) — the Item Master screen's column sort / filters. */
  sf: sfRawParamSchema,
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
