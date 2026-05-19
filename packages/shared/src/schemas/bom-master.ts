// BOM Master shared schemas (BOM-1). Ports the structure of the legacy
// renderBOMMaster (legacy/InnovicERP_v82_12_3.html L8438) to typed Zod.
//
// Header + lines + revision-log triple. Each revision archives the
// previous lines[] as JSON so the diff history survives even after the
// line rows are replaced on update.
//
// Status workflow: draft → active → obsolete (active is the only status
// that SO lines can link to; obsolete is archived but legacy SOs keep
// their reference).

import { z } from 'zod';
import { BOM_LINE_TYPES } from '../enums/bom-line-type';
import { BOM_STATUSES } from '../enums/bom-status';

export const bomStatusSchema = z.enum(BOM_STATUSES);
export const bomLineTypeSchema = z.enum(BOM_LINE_TYPES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const bomMasterSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  bomNo: z.string(),
  bomName: z.string(),
  revision: z.number().int().positive(),
  status: bomStatusSchema,
  revisionDate: z.string(), // ISO date
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type BomMaster = z.infer<typeof bomMasterSchema>;

export const bomMasterLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  bomMasterId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  childItemId: z.string().uuid(),
  qtyPerSet: z.string(), // numeric stored as string
  bomType: bomLineTypeSchema,
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  // Joined display values (populated by service via items table)
  childItemCode: z.string().nullable().default(null),
  childItemName: z.string().nullable().default(null),
});
export type BomMasterLine = z.infer<typeof bomMasterLineSchema>;

export const bomMasterRevisionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  bomMasterId: z.string().uuid(),
  revision: z.number().int().positive(),
  changedByText: z.string(),
  notes: z.string().nullable(),
  // Snapshot of the lines AS THEY WERE at this revision. Structurally
  // equivalent to BomMasterLineSnapshot[] (subset of fields the diff
  // needs — childItemId, qtyPerSet, bomType — plus childItemCode for
  // display). Stored as jsonb so the diff trail survives even after
  // line rows are replaced.
  itemsSnapshot: z.array(
    z.object({
      childItemId: z.string().uuid(),
      childItemCode: z.string().nullable().optional(),
      qtyPerSet: z.string(),
      bomType: bomLineTypeSchema,
    }),
  ),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type BomMasterRevision = z.infer<typeof bomMasterRevisionSchema>;

export const bomMasterDetailSchema = bomMasterSchema.extend({
  lines: z.array(bomMasterLineSchema),
  revisions: z.array(bomMasterRevisionSchema).default([]),
  linkedSoCount: z.number().int().nonnegative().default(0),
});
export type BomMasterDetail = z.infer<typeof bomMasterDetailSchema>;

export const bomMasterListItemSchema = bomMasterSchema.extend({
  lineCount: z.number().int().nonnegative(),
  linkedSoCount: z.number().int().nonnegative(),
});
export type BomMasterListItem = z.infer<typeof bomMasterListItemSchema>;

// ─── List query ────────────────────────────────────────────────────────────

export const listBomMastersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: bomStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListBomMastersQuery = z.infer<typeof listBomMastersQuerySchema>;

export interface ListBomMastersResponse {
  items: BomMasterListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createBomMasterLineInputSchema = z.object({
  childItemId: z.string().uuid(),
  qtyPerSet: z.number().positive(),
  bomType: bomLineTypeSchema,
});
export type CreateBomMasterLineInput = z.infer<typeof createBomMasterLineInputSchema>;

export const createBomMasterInputSchema = z
  .object({
    // bomNo is optional on create — server will auto-generate BOM-NNNN
    // if omitted (matches legacy _nextBOMNo behaviour).
    bomNo: z.string().min(1).max(64).optional(),
    bomName: z.string().min(1).max(255),
    status: bomStatusSchema.default('draft'),
    lines: z.array(createBomMasterLineInputSchema).min(1, 'Add at least one item to the BOM'),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.childItemId)).size === v.lines.length,
    'Duplicate items in BOM',
  );
export type CreateBomMasterInput = z.infer<typeof createBomMasterInputSchema>;

// Update: same shape as create but bomNo is REQUIRED (you can't rename
// during an edit) + revisionNote is optional (server auto-generates a
// diff note if blank). Service bumps revision integer + writes the
// pre-update lines snapshot to bom_master_revisions.
export const updateBomMasterInputSchema = z
  .object({
    bomNo: z.string().min(1).max(64),
    bomName: z.string().min(1).max(255),
    status: bomStatusSchema,
    lines: z.array(createBomMasterLineInputSchema).min(1),
    revisionNote: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.childItemId)).size === v.lines.length,
    'Duplicate items in BOM',
  );
export type UpdateBomMasterInput = z.infer<typeof updateBomMasterInputSchema>;

// Excel import — one row per item. Mirrors the template the web UI will
// generate via the template download endpoint. itemCode is the human-
// readable code that the server resolves to items.id; on miss the row
// is flagged in the error report rather than failing the whole import.
export const importBomLinesInputRowSchema = z.object({
  itemCode: z.string().min(1).max(64),
  qtyPerSet: z.number().positive(),
  bomType: bomLineTypeSchema,
});
export type ImportBomLinesInputRow = z.infer<typeof importBomLinesInputRowSchema>;

export const importBomLinesInputSchema = z.object({
  rows: z.array(importBomLinesInputRowSchema).min(1),
});
export type ImportBomLinesInput = z.infer<typeof importBomLinesInputSchema>;

export interface ImportBomLinesRowError {
  rowIndex: number; // 0-based index in the input.rows array
  itemCode: string;
  reason: string;
}

export interface ImportBomLinesResponse {
  inserted: number;
  skipped: number;
  errors: ImportBomLinesRowError[];
  bom: BomMasterDetail;
}
