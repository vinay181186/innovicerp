import { z } from 'zod';

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const operatorSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  department: z.string().max(100).nullable(),
  skills: z.string().max(1000).nullable(),
  isActive: z.boolean(),
  userId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Operator = z.infer<typeof operatorSchema>;

export const createOperatorInputSchema = z.object({
  // Optional: the server auto-generates the next OP-### in the company series
  // when omitted. A caller may still pass an explicit code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen')
    .optional(),
  name: z.string().min(1).max(255),
  department: z.string().max(100).optional(),
  skills: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
  userId: z.string().uuid().optional().or(z.literal('')),
});
export type CreateOperatorInput = z.infer<typeof createOperatorInputSchema>;

export const updateOperatorInputSchema = createOperatorInputSchema.partial().omit({ code: true });
export type UpdateOperatorInput = z.infer<typeof updateOperatorInputSchema>;

/** BULK CREATE — the Excel importer's whole sheet in ONE request.
 *
 *  The importer used to POST /operators once per row and wait for each answer,
 *  and every answer invalidated the on-screen operator list, so the browser also
 *  re-downloaded the entire master after every single row. Measured on the live
 *  vendors import (same code shape) that ran at ~1 row per second; a 500-row
 *  sheet took nine minutes. One request, one transaction, one list reload puts
 *  the same sheet in in seconds.
 *
 *  Capped at 2000 rows — comfortably past the largest master anyone would paste
 *  in, and small enough that the whole insert stays one sane transaction. */
export const bulkCreateOperatorsInputSchema = z.object({
  operators: z.array(createOperatorInputSchema).min(1).max(2000),
});
export type BulkCreateOperatorsInput = z.infer<typeof bulkCreateOperatorsInputSchema>;

/** One row the bulk create refused, with the reason in the user's words. */
export interface BulkOperatorSkip {
  /** 1-based position in the submitted array, so the UI can name the sheet row. */
  index: number;
  name: string;
  reason: string;
}

export interface BulkCreateOperatorsResponse {
  created: number;
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkOperatorSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const listOperatorsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListOperatorsQuery = z.infer<typeof listOperatorsQuerySchema>;

export interface ListOperatorsResponse {
  operators: Operator[];
  total: number;
  limit: number;
  offset: number;
}
