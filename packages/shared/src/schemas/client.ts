import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { queryBoolean } from '../lib/query-boolean';
import { GST_CATEGORIES } from '../lib/gst';
import type { MasterRuleWarnings } from '../lib/master-rules';
import {
  type MasterImportResult,
  type MasterImportRowResult,
  masterImportOptionsSchema,
} from './master-import';

const codeRegex = /^[A-Za-z0-9._&-]+$/;

export const clientSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  contactPerson: z.string().max(255).nullable(),
  email: z.string().email().max(255).nullable(),
  phone: z.string().max(32).nullable(),
  gstNumber: z.string().max(32).nullable(),
  /** GST Category (plan D1, migration 0183) — NULL = not chosen yet. */
  gstCategory: z.enum(GST_CATEGORIES).nullable(),
  addressLine1: z.string().max(500).nullable(),
  city: z.string().max(100).nullable(),
  /** State name — always the INDIAN_STATES name for `stateCode` once chosen
   *  from the pick-list; older rows may still hold free text. */
  state: z.string().max(100).nullable(),
  /** GST State Code, 2 digits (INDIAN_STATES), migration 0183. */
  stateCode: z.string().length(2).nullable(),
  pincode: z.string().max(12).nullable(),
  /** Payment Days — days this customer is allowed to pay an invoice in. The
   *  default for a new invoice's Payment Terms (ADR-188). Null = not set. */
  paymentDays: z.number().int().min(0).max(365).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Client = z.infer<typeof clientSchema>;
/** A create / update answer: the saved customer + any warn-mode rule problems. */
export type ClientSaveResponse = Client & MasterRuleWarnings;

export const createClientInputSchema = z.object({
  // Optional: the server auto-generates the next CLI-### in the company series
  // when omitted (bug 5.1). A caller may still pass an explicit code.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen, ampersand')
    .optional(),
  name: z.string().min(1).max(255),
  contactPerson: z.string().max(255).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(32).optional(),
  gstNumber: z.string().max(32).optional(),
  /** GST Category (D1). null clears it on update. */
  gstCategory: z.enum(GST_CATEGORIES).nullable().optional(),
  addressLine1: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  /** Free text is still accepted (import, old callers) and resolved to a
   *  State Code on the server; the form sends `stateCode`. */
  state: z.string().max(100).optional(),
  /** GST State Code from the pick-list — wins over `state`. null clears it. */
  stateCode: z
    .string()
    .regex(/^[0-9]{2}$/, 'State Code is 2 digits')
    .nullable()
    .optional(),
  pincode: z.string().max(12).optional(),
  /** Payment Days (ADR-188). null clears it on update. */
  paymentDays: z.number().int().min(0).max(365).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateClientInput = z.infer<typeof createClientInputSchema>;

export const updateClientInputSchema = createClientInputSchema
  .partial()
  .omit({ code: true })
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });
export type UpdateClientInput = z.infer<typeof updateClientInputSchema>;

/** BULK IMPORT — the Excel importer's whole sheet in ONE request.
 *
 *  One request, one transaction, one list reload (the per-row POST loop took
 *  ~1 row per second). Each row is checked on its own on the server — a bad
 *  row is reported and left out, the rest go in (ERPNext Data Import; audit
 *  finding 35: one bad email used to reject the whole sheet). `mode` 'update'
 *  matches rows by Code and writes only the filled cells; `dryRun` is the
 *  preview (see master-import.ts). Capped at 2000 rows. */
export const bulkCreateClientsInputSchema = masterImportOptionsSchema.extend({
  clients: z.array(z.unknown()).min(1).max(2000),
});
export type BulkCreateClientsInput = z.input<typeof bulkCreateClientsInputSchema>;

/** Update Existing: one row — Code required, every other field optional
 *  (a missing field is left as it is). */
export const updateClientImportRowSchema = createClientInputSchema
  .partial()
  .extend({ code: z.string().trim().min(1, 'Code is required to update') });

/** One row the bulk import refused, with the reason in the user's words. */
export type BulkClientSkip = Pick<MasterImportRowResult, 'index' | 'name'> & { reason: string };

export interface BulkCreateClientsResponse extends MasterImportResult {
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkClientSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const clientSortFieldSchema = z.enum(['code', 'name']);
export type ClientSortField = z.infer<typeof clientSortFieldSchema>;

export const listClientsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: queryBoolean().optional(),
  sortBy: clientSortFieldSchema.optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  // 1000 so the Client Master can load the whole master in one scrolling fetch
  // (no Prev/Next), matching the SO master list. Raised from 200.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export interface ListClientsResponse {
  clients: Client[];
  total: number;
  limit: number;
  offset: number;
}
