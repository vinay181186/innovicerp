import { z } from 'zod';
import { sfRawParamSchema } from './list-query';
import { queryBoolean } from '../lib/query-boolean';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import {
  type MasterImportResult,
  type MasterImportRowResult,
  masterImportOptionsSchema,
} from './master-import';

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

export const updateOperatorInputSchema = createOperatorInputSchema
  .partial()
  .omit({ code: true })
  // §20.4 / ADR-226 — the version this form loaded.
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });
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
 *  in, and small enough that the whole insert stays one sane transaction.
 *
 *  Operator joined this contract last. It used to take a pre-validated
 *  `CreateOperatorInput[]` with no `mode` and no `dryRun`, which is why its
 *  import was the only master that wrote immediately with no preview and could
 *  insert the same sheet twice after a timeout. It now carries the same envelope
 *  as Item / Vendor / Customer: rows arrive UNCHECKED (`z.unknown()`) and are
 *  parsed one at a time on the server, so one bad row is reported and left out
 *  instead of rejecting the sheet; `mode` 'update' matches by Code and writes
 *  only the filled cells; `dryRun` is the preview. See master-import.ts. */
export const bulkCreateOperatorsInputSchema = masterImportOptionsSchema.extend({
  operators: z.array(z.unknown()).min(1).max(2000),
});
export type BulkCreateOperatorsInput = z.input<typeof bulkCreateOperatorsInputSchema>;

/** Update Existing: one row — Code required, every other field optional (a
 *  missing field is left as it is). `code` is omitted from the update input
 *  everywhere else precisely because it is the match key, so it is put back
 *  here as the one REQUIRED field. */
export const updateOperatorImportRowSchema = createOperatorInputSchema
  .partial()
  .extend({ code: z.string().trim().min(1, 'Code is required to update') });

/** One row the bulk import refused, with the reason in the user's words. */
export type BulkOperatorSkip = Pick<MasterImportRowResult, 'index' | 'name'> & { reason: string };

export interface BulkCreateOperatorsResponse extends MasterImportResult {
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkOperatorSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const listOperatorsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: queryBoolean().optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
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
