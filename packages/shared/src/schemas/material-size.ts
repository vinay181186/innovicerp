import { z } from 'zod';

// Raw-material SIZE master (e.g. 'Ø30 × 1000', '50 × 6 FLAT'). One of the two
// masters behind the single "Raw Material Master" menu entry; the other is
// ./material-grade.
//
// The size is ONE box, by decision — whatever the buyer writes on the cutting
// slip goes in verbatim. It is not broken into shape / dia / length, and it is
// NOT scoped to a grade: the Grade and Size pickers on a plan are independent.

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const materialSizeSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** Auto SZ-#### in the company series unless the caller passes one. */
  code: z.string().min(1).max(64),
  /** The size exactly as written — 'Ø30 × 1000'. Wide enough for symbols. */
  name: z.string().min(1).max(160),
  /** Free note: stock form, supplier spec, cutting allowance. */
  description: z.string().max(500).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type MaterialSize = z.infer<typeof materialSizeSchema>;

export const createMaterialSizeInputSchema = z.object({
  // Optional: the server auto-generates the next SZ-#### in the company series
  // when omitted. A caller may still pass an explicit code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen')
    .optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});
export type CreateMaterialSizeInput = z.infer<typeof createMaterialSizeInputSchema>;

export const updateMaterialSizeInputSchema = createMaterialSizeInputSchema
  .partial()
  .omit({ code: true });
export type UpdateMaterialSizeInput = z.infer<typeof updateMaterialSizeInputSchema>;

/** BULK CREATE — the Excel importer's whole sheet in ONE request. See the
 *  matching note on ./material-grade. */
export const bulkCreateMaterialSizesInputSchema = z.object({
  sizes: z.array(createMaterialSizeInputSchema).min(1).max(2000),
});
export type BulkCreateMaterialSizesInput = z.infer<typeof bulkCreateMaterialSizesInputSchema>;

/** One row the bulk create refused, with the reason in the user's words. */
export interface BulkMaterialSizeSkip {
  /** 1-based position in the submitted array, so the UI can name the sheet row. */
  index: number;
  name: string;
  reason: string;
}

export interface BulkCreateMaterialSizesResponse {
  created: number;
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkMaterialSizeSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const listMaterialSizesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  // 1000 so the master list loads in one scrolling fetch (no Prev/Next),
  // matching the Vendor Master.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMaterialSizesQuery = z.infer<typeof listMaterialSizesQuerySchema>;

export interface ListMaterialSizesResponse {
  sizes: MaterialSize[];
  total: number;
  limit: number;
  offset: number;
}
