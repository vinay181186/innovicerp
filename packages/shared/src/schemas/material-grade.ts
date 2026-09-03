import { z } from 'zod';

// Raw-material GRADE master (e.g. EN24, EN8, SS304). One of the two masters
// behind the single "Raw Material Master" menu entry; the other is
// ./material-size. The two are deliberately INDEPENDENT — a size is not scoped
// to a grade, so picking EN24 does not narrow the size list.
//
// Shape copied from the Machine / Operator masters: company-scoped, soft
// delete, an auto code series, an Active flag and the usual audit columns.

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const materialGradeSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** Auto GRD-### in the company series unless the caller passes one. */
  code: z.string().min(1).max(64),
  /** The grade as it is written on the shop floor — 'EN24', 'SS304'. */
  name: z.string().min(1).max(120),
  /** Free note: standard, equivalent, hardness — whatever the buyer needs. */
  description: z.string().max(500).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type MaterialGrade = z.infer<typeof materialGradeSchema>;

export const createMaterialGradeInputSchema = z.object({
  // Optional: the server auto-generates the next GRD-### in the company series
  // when omitted. A caller may still pass an explicit code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen')
    .optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});
export type CreateMaterialGradeInput = z.infer<typeof createMaterialGradeInputSchema>;

export const updateMaterialGradeInputSchema = createMaterialGradeInputSchema
  .partial()
  .omit({ code: true });
export type UpdateMaterialGradeInput = z.infer<typeof updateMaterialGradeInputSchema>;

/** BULK CREATE — the Excel importer's whole sheet in ONE request.
 *
 *  Same contract as the vendor / item / client / operator importers: one
 *  request, one transaction, one list reload. Row-at-a-time importing ran at
 *  ~1 row per second on the live system because every row also re-downloaded
 *  the whole master. */
export const bulkCreateMaterialGradesInputSchema = z.object({
  grades: z.array(createMaterialGradeInputSchema).min(1).max(2000),
});
export type BulkCreateMaterialGradesInput = z.infer<typeof bulkCreateMaterialGradesInputSchema>;

/** One row the bulk create refused, with the reason in the user's words. */
export interface BulkMaterialGradeSkip {
  /** 1-based position in the submitted array, so the UI can name the sheet row. */
  index: number;
  name: string;
  reason: string;
}

export interface BulkCreateMaterialGradesResponse {
  created: number;
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkMaterialGradeSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const listMaterialGradesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  // 1000 so the master list loads in one scrolling fetch (no Prev/Next),
  // matching the Vendor Master.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMaterialGradesQuery = z.infer<typeof listMaterialGradesQuerySchema>;

export interface ListMaterialGradesResponse {
  grades: MaterialGrade[];
  total: number;
  limit: number;
  offset: number;
}
