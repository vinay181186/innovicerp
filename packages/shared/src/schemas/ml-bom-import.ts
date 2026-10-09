// Multi-Level BOM — Excel import (ADR-225 phase 2).
//
// One sheet row = one parent → child link. Levels are NOT typed: a Child Item
// Code that is also a BOM Item Code in the same file (or already has a Default
// Multi-Level BOM) becomes a sub-assembly on a Manufacture line.
//
// The web parses the sheet into raw strings and sends them; the server runs
// ONE rule set for both the Preview (dryRun: true — nothing saved) and the
// Import (dryRun: false — the whole file in one transaction, all or nothing).
//
// Decisions (ADR-225): an item that already has a Default Multi-Level BOM gets
// a NEW REVISION of it (7); a code not in Item Master is refused (8); a Buy /
// Outsource line ignores the child's BOM, with a warning (9).

import { z } from 'zod';
import { mlBomLineTypeSchema } from './ml-bom';

export const ML_BOM_IMPORT_MAX_ROWS = 2000;

/** Sheet headers, in template order. The importer matches them ignoring case
 *  and spacing; `Line Type` also accepts the older header `Line Kind`. */
export const ML_BOM_IMPORT_HEADERS = [
  'BOM Item Code',
  'Child Item Code',
  'Qty per Set',
  'Line Type',
  'RM Grade',
  'RM Size',
  'Line Remarks',
] as const;

/** One sheet row exactly as typed (strings), plus its sheet row number. */
export const mlBomImportRowSchema = z.object({
  /** Sheet row number (header = 1, first data row = 2). */
  rowNum: z.number().int().min(2),
  bomItemCode: z.string().max(120),
  childItemCode: z.string().max(120),
  qtyPerSet: z.string().max(40),
  /** "Manufacture" / "Buy" / "Outsource" (label), the stored code, or "Make". */
  lineType: z.string().max(40),
  rawMaterialGrade: z.string().max(120).nullable().optional(),
  rawMaterialSize: z.string().max(160).nullable().optional(),
  remarks: z.string().max(500).nullable().optional(),
});
export type MlBomImportRow = z.infer<typeof mlBomImportRowSchema>;

export const mlBomImportInputSchema = z.object({
  dryRun: z.boolean(),
  fileName: z.string().trim().min(1).max(255),
  rows: z.array(mlBomImportRowSchema).min(1, 'The sheet has no rows').max(ML_BOM_IMPORT_MAX_ROWS),
});
export type MlBomImportInput = z.infer<typeof mlBomImportInputSchema>;

export const ML_BOM_IMPORT_ROW_STATUSES = ['ok', 'warning', 'error'] as const;
export type MlBomImportRowStatus = (typeof ML_BOM_IMPORT_ROW_STATUSES)[number];

export const mlBomImportRowResultSchema = z.object({
  rowNum: z.number().int(),
  status: z.enum(ML_BOM_IMPORT_ROW_STATUSES),
  /** Errors and warnings for this row, in plain words. Empty when ok. */
  messages: z.array(z.string()),
});
export type MlBomImportRowResult = z.infer<typeof mlBomImportRowResultSchema>;

/** One BOM the file creates or revises. */
export const mlBomImportBomSchema = z.object({
  itemCode: z.string(),
  itemName: z.string().nullable(),
  action: z.enum(['create', 'revise']),
  /** Existing code on revise; the assigned code after a real import; null on a
   *  dry-run create (the number is given on save). */
  code: z.string().nullable(),
  /** BOM Rev after the import. */
  revision: z.number().int().positive(),
  lineCount: z.number().int().nonnegative(),
  subAssemblyCount: z.number().int().nonnegative(),
});
export type MlBomImportBom = z.infer<typeof mlBomImportBomSchema>;

/** Preview tree row — the file as the system reads it, per top item. */
export const mlBomImportTreeRowSchema = z.object({
  topItemCode: z.string(),
  depth: z.number().int().nonnegative(),
  itemCode: z.string(),
  itemName: z.string().nullable(),
  uom: z.string().nullable(),
  /** null on the top row. */
  bomType: mlBomLineTypeSchema.nullable(),
  qtyPerSet: z.string().nullable(),
  /** Qty for ONE top item (full precision down the tree, 3 decimals once). */
  explodedQty: z.string(),
  isSubAssembly: z.boolean(),
});
export type MlBomImportTreeRow = z.infer<typeof mlBomImportTreeRowSchema>;

export const mlBomImportResultSchema = z.object({
  dryRun: z.boolean(),
  /** true = no row errors and no file errors (an import would save). */
  ok: z.boolean(),
  /** true only after a real import committed. */
  saved: z.boolean(),
  rows: z.array(mlBomImportRowResultSchema),
  /** Whole-file problems: a loop (names the chain), deeper than 10 levels. */
  fileErrors: z.array(z.string()),
  boms: z.array(mlBomImportBomSchema),
  tree: z.array(mlBomImportTreeRowSchema),
  levels: z.number().int().nonnegative(),
});
export type MlBomImportResult = z.infer<typeof mlBomImportResultSchema>;
