// Multi-Level BOM (ADR-225). A SEPARATE document from BOM Master
// (schemas/bom-master.ts), which is untouched. A line may link the child
// item's own Multi-Level BOM, so one BOM nests to any depth (max 10 levels):
//
//   PS-100 ─ MA-10 (sub-assembly → its own IN-MLB) ─ HSG-10 ─ BRG-6205
//
// Rules the server enforces (the screen only mirrors them):
//   - a sub-assembly link exists only on a `manufacture` line; a Buy or
//     Outsource line is bought / sent out whole, its item's BOM is ignored
//     (ADR-225 decision 9)
//   - the link is resolved on the server to the child item's DEFAULT
//     Multi-Level BOM — the caller never chooses it
//   - no loops (A → B → A), no deeper than ML_BOM_MAX_LEVELS
//   - one Default Multi-Level BOM per item
//   - every new BOM is created Active (as ADR-223) — there is no status
//
// Names reuse docs/NAMING.md: `Qty per Set` (qtyPerSet), the BOM line type
// labels (Manufacture / Buy / Outsource), `RM Grade` / `RM Size`.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { BOM_LINE_TYPES } from '../enums/bom-line-type';
import { activityReasonSchema } from '../enums/activity';
import { positiveQtySchema } from '../lib/qty-rule';

/** Deepest allowed tree, counting the top item as level 0. */
export const ML_BOM_MAX_LEVELS = 10;

export const mlBomLineTypeSchema = z.enum(BOM_LINE_TYPES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const mlBomSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** IN-MLB-00001 */
  code: z.string(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  /** Raised on every edit; the old lines are kept in `revisions`. */
  revision: z.number().int().positive(),
  /** The BOM other BOMs link to when this item is their child. */
  isDefault: z.boolean(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type MlBom = z.infer<typeof mlBomSchema>;

export const mlBomLineSchema = z.object({
  id: z.string().uuid(),
  mlBomId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  childItemId: z.string().uuid(),
  childItemCode: z.string().nullable().default(null),
  childItemName: z.string().nullable().default(null),
  childUom: z.string().nullable().default(null),
  /** numeric(14,3) as string */
  qtyPerSet: z.string(),
  bomType: mlBomLineTypeSchema,
  /** Set = this line is a sub-assembly built from that BOM. Server-resolved. */
  childMlBomId: z.string().uuid().nullable(),
  childMlBomCode: z.string().nullable().default(null),
  rawMaterialGradeId: z.string().uuid().nullable(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeId: z.string().uuid().nullable(),
  rawMaterialSizeText: z.string().nullable(),
  remarks: z.string().nullable(),
  updatedAt: z.string(),
});
export type MlBomLine = z.infer<typeof mlBomLineSchema>;

export const mlBomRevisionSchema = z.object({
  id: z.string().uuid(),
  mlBomId: z.string().uuid(),
  revision: z.number().int().positive(),
  changedByText: z.string(),
  notes: z.string().nullable(),
  /** The lines AS THEY WERE at this revision. */
  linesSnapshot: z.array(
    z.object({
      childItemId: z.string().uuid(),
      childItemCode: z.string().nullable().optional(),
      qtyPerSet: z.string(),
      bomType: mlBomLineTypeSchema,
      childMlBomId: z.string().uuid().nullable().optional(),
    }),
  ),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type MlBomRevision = z.infer<typeof mlBomRevisionSchema>;

export const mlBomDetailSchema = mlBomSchema.extend({
  lines: z.array(mlBomLineSchema),
  revisions: z.array(mlBomRevisionSchema).default([]),
  /** Live Multi-Level BOMs whose lines link this one as a sub-assembly. */
  usedIn: z
    .array(
      z.object({ mlBomId: z.string().uuid(), code: z.string(), itemCode: z.string().nullable() }),
    )
    .default([]),
});
export type MlBomDetail = z.infer<typeof mlBomDetailSchema>;

export const mlBomListItemSchema = mlBomSchema.extend({
  lineCount: z.number().int().nonnegative(),
  subAssemblyCount: z.number().int().nonnegative(),
  /** Deepest level under this BOM (0 = no lines). */
  levels: z.number().int().nonnegative(),
});
export type MlBomListItem = z.infer<typeof mlBomListItemSchema>;

// ─── Tree + exploded (GET /ml-boms/:id/tree?qty=) ──────────────────────────

/** One row of the tree, flattened in display order (depth-first by line no). */
export const mlBomTreeNodeSchema = z.object({
  /** Unique within the response: the chain of line ids, '' for the top row. */
  key: z.string(),
  depth: z.number().int().nonnegative(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  uom: z.string().nullable(),
  /** null on the top row. */
  bomType: mlBomLineTypeSchema.nullable(),
  /** Qty per one parent (the line's Qty per Set); null on the top row. */
  qtyPerSet: z.string().nullable(),
  /** Qty for the requested top quantity — full precision down the tree,
   *  rounded to 3 decimals once, here (ADR-225 DB check). */
  explodedQty: z.string(),
  /** Set on a sub-assembly row (and on the top row: the BOM itself). */
  mlBomId: z.string().uuid().nullable(),
  mlBomCode: z.string().nullable(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeText: z.string().nullable(),
});
export type MlBomTreeNode = z.infer<typeof mlBomTreeNodeSchema>;

/** Leaf parts summed by item — what is actually bought or machined. */
export const mlBomExplodedItemSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  uom: z.string().nullable(),
  bomType: mlBomLineTypeSchema,
  explodedQty: z.string(),
});
export type MlBomExplodedItem = z.infer<typeof mlBomExplodedItemSchema>;

export const mlBomTreeQuerySchema = z.object({
  qty: z.coerce.number().positive().max(1_000_000).default(1),
});
export type MlBomTreeQuery = z.infer<typeof mlBomTreeQuerySchema>;

export const mlBomTreeResponseSchema = z.object({
  qty: z.number(),
  levels: z.number().int().nonnegative(),
  nodes: z.array(mlBomTreeNodeSchema),
  exploded: z.array(mlBomExplodedItemSchema),
});
export type MlBomTreeResponse = z.infer<typeof mlBomTreeResponseSchema>;

// ─── List query ────────────────────────────────────────────────────────────

export const listMlBomsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMlBomsQuery = z.infer<typeof listMlBomsQuerySchema>;

export interface ListMlBomsResponse {
  items: MlBomListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Write inputs ──────────────────────────────────────────────────────────

export const mlBomLineInputSchema = z.object({
  childItemId: z.string().uuid(),
  qtyPerSet: positiveQtySchema,
  bomType: mlBomLineTypeSchema,
  rawMaterialGradeId: z.string().uuid().nullable().optional(),
  rawMaterialGradeText: z.string().trim().max(120).nullable().optional(),
  rawMaterialSizeId: z.string().uuid().nullable().optional(),
  rawMaterialSizeText: z.string().trim().max(160).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type MlBomLineInput = z.infer<typeof mlBomLineInputSchema>;

const linesRefinements = <T extends { itemId: string; lines: MlBomLineInput[] }>(s: z.ZodType<T>) =>
  s
    .refine(
      (v) => new Set(v.lines.map((l) => l.childItemId)).size === v.lines.length,
      'The same item is on two lines',
    )
    .refine(
      (v) => !v.lines.some((l) => l.childItemId === v.itemId),
      'A BOM cannot contain its own item',
    );

export const createMlBomInputSchema = linesRefinements(
  z.object({
    itemId: z.string().uuid('Pick the item this BOM makes'),
    /** Omitted → true when the item has no Default yet. */
    isDefault: z.boolean().optional(),
    remarks: z.string().trim().max(1000).nullable().optional(),
    lines: z.array(mlBomLineInputSchema).min(1, 'Add at least one line'),
  }),
);
export type CreateMlBomInput = z.infer<typeof createMlBomInputSchema>;

export const updateMlBomInputSchema = linesRefinements(
  z.object({
    /** Fixed after create — sent so the shared refinements can check lines. */
    itemId: z.string().uuid(),
    remarks: z.string().trim().max(1000).nullable().optional(),
    lines: z.array(mlBomLineInputSchema).min(1, 'Add at least one line'),
    revisionNote: z.string().trim().max(2000).nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  }),
);
export type UpdateMlBomInput = z.infer<typeof updateMlBomInputSchema>;

/** POST /ml-boms/:id/make-default */
export const makeDefaultMlBomInputSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type MakeDefaultMlBomInput = z.infer<typeof makeDefaultMlBomInputSchema>;

/** DELETE /ml-boms/:id — a reason, as every delete (ADR-197). */
export const deleteMlBomInputSchema = z.object({ reason: activityReasonSchema });
export type DeleteMlBomInput = z.infer<typeof deleteMlBomInputSchema>;
