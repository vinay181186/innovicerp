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
  /** The assembled item this BOM builds. Nullable ONLY for BOMs created
   *  before migration 0085 — every write since then requires one. */
  parentItemId: z.string().uuid().nullable().default(null),
  parentItemCode: z.string().nullable().default(null),
  parentItemName: z.string().nullable().default(null),
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
  // Raw material for THIS child part. A BOM child is a different part from its
  // parent and is generally cut from different stock, so there is nothing to
  // inherit — the BOM line is the only place that knows what the child is made
  // from. Copied onto the child Job Card the BOM cascade raises. Both optional
  // (a purchase/outsource line buys the part rather than cutting it).
  rawMaterialGradeId: z.string().uuid().nullable(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeId: z.string().uuid().nullable(),
  rawMaterialSizeText: z.string().nullable(),
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
  // Raw material for this child part — see bomMasterLineSchema. Optional.
  rawMaterialGradeId: z.string().uuid().nullable().optional(),
  rawMaterialGradeText: z.string().trim().max(120).nullable().optional(),
  rawMaterialSizeId: z.string().uuid().nullable().optional(),
  rawMaterialSizeText: z.string().trim().max(160).nullable().optional(),
});
export type CreateBomMasterLineInput = z.infer<typeof createBomMasterLineInputSchema>;

// A BOM says "this parent item is built from these child parts". The parent is
// REQUIRED and there is exactly one — a single column, not a list — because an
// assembly with two parents is not an assembly. Without it the BOM cannot say
// what it builds, which is what left equipment SOs plannable but undeliverable.
export const createBomMasterInputSchema = z
  .object({
    // bomNo is optional on create — server will auto-generate BOM-NNNN
    // if omitted (matches legacy _nextBOMNo behaviour).
    bomNo: z.string().min(1).max(64).optional(),
    bomName: z.string().min(1).max(255),
    parentItemId: z.string().uuid('Pick the parent item this BOM builds'),
    status: bomStatusSchema.default('draft'),
    lines: z.array(createBomMasterLineInputSchema).min(1, 'Add at least one item to the BOM'),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.childItemId)).size === v.lines.length,
    'Duplicate items in BOM',
  )
  .refine(
    (v) => !v.lines.some((l) => l.childItemId === v.parentItemId),
    'The parent item cannot also be one of its own child parts',
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
    // Required on update too, so the pre-0085 BOMs that have no parent get one
    // the first time anybody edits them — that is the whole backfill plan.
    parentItemId: z.string().uuid('Pick the parent item this BOM builds'),
    status: bomStatusSchema,
    lines: z.array(createBomMasterLineInputSchema).min(1),
    revisionNote: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.childItemId)).size === v.lines.length,
    'Duplicate items in BOM',
  )
  .refine(
    (v) => !v.lines.some((l) => l.childItemId === v.parentItemId),
    'The parent item cannot also be one of its own child parts',
  );
export type UpdateBomMasterInput = z.infer<typeof updateBomMasterInputSchema>;
