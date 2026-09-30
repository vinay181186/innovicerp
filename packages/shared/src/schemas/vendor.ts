import { z } from 'zod';
import { queryBoolean } from '../lib/query-boolean';
import { GST_CATEGORIES } from '../lib/gst';
import type { MasterRuleWarnings } from '../lib/master-rules';
import {
  type MasterImportResult,
  type MasterImportRowResult,
  masterImportOptionsSchema,
} from './master-import';

const codeRegex = /^[A-Za-z0-9._&-]+$/;

export const vendorSchema = z.object({
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
  /** State name — the INDIAN_STATES name for `stateCode` once chosen from the
   *  pick-list; older rows may still hold free text. */
  state: z.string().max(100).nullable(),
  /** GST State Code, 2 digits (INDIAN_STATES), migration 0183. */
  stateCode: z.string().length(2).nullable(),
  pincode: z.string().max(12).nullable(),
  materialsSupplied: z.string().max(1000).nullable(),
  rating: z.string().max(8).nullable(),
  /** Payment Terms (days) — days we are allowed to pay this vendor (plan D6,
   *  migration 0183). The default for its POs' terms. Null = not set. The
   *  customer's equivalent is `paymentDays` on the client. */
  paymentTermsDays: z.number().int().min(0).max(365).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Vendor = z.infer<typeof vendorSchema>;
/** A create / update answer: the saved vendor + any warn-mode rule problems. */
export type VendorSaveResponse = Vendor & MasterRuleWarnings;

export const createVendorInputSchema = z.object({
  // Optional: the server auto-generates the next VND-### in the company series
  // when omitted. A caller may still pass an explicit code.
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
  materialsSupplied: z.string().max(1000).optional(),
  rating: z.string().max(8).optional(),
  /** Payment Terms (days) (D6). null clears it on update. */
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateVendorInput = z.infer<typeof createVendorInputSchema>;

export const updateVendorInputSchema = createVendorInputSchema.partial().omit({ code: true });
export type UpdateVendorInput = z.infer<typeof updateVendorInputSchema>;

/** BULK IMPORT — the Excel importer's whole sheet in ONE request.
 *
 *  One request, one transaction, one list reload (the per-row POST loop took
 *  ~1 row per second). Each row is checked on its own on the server — a bad
 *  row is reported and left out, the rest go in (ERPNext Data Import; audit
 *  finding 35: one bad email used to reject the whole sheet). `mode` 'update'
 *  matches rows by Code and writes only the filled cells; `dryRun` is the
 *  preview (see master-import.ts). Capped at 2000 rows. */
export const bulkCreateVendorsInputSchema = masterImportOptionsSchema.extend({
  vendors: z.array(z.unknown()).min(1).max(2000),
});
export type BulkCreateVendorsInput = z.input<typeof bulkCreateVendorsInputSchema>;

/** Update Existing: one row — Code required, every other field optional
 *  (a missing field is left as it is). */
export const updateVendorImportRowSchema = createVendorInputSchema
  .partial()
  .extend({ code: z.string().trim().min(1, 'Code is required to update') });

/** One row the bulk import refused, with the reason in the user's words. */
export type BulkVendorSkip = Pick<MasterImportRowResult, 'index' | 'name'> & { reason: string };

export interface BulkCreateVendorsResponse extends MasterImportResult {
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkVendorSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const vendorSortFieldSchema = z.enum(['code', 'name']);
export type VendorSortField = z.infer<typeof vendorSortFieldSchema>;

export const listVendorsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: queryBoolean().optional(),
  sortBy: vendorSortFieldSchema.optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  // 1000 so the Vendor Master can load the whole master in one scrolling fetch
  // (no Prev/Next), matching the SO master list. Raised from 200.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export interface ListVendorsResponse {
  vendors: Vendor[];
  total: number;
  limit: number;
  offset: number;
}
