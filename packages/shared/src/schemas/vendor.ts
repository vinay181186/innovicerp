import { z } from 'zod';

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
  addressLine1: z.string().max(500).nullable(),
  city: z.string().max(100).nullable(),
  state: z.string().max(100).nullable(),
  pincode: z.string().max(12).nullable(),
  materialsSupplied: z.string().max(1000).nullable(),
  rating: z.string().max(8).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Vendor = z.infer<typeof vendorSchema>;

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
  addressLine1: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(12).optional(),
  materialsSupplied: z.string().max(1000).optional(),
  rating: z.string().max(8).optional(),
  isActive: z.boolean().default(true),
});
export type CreateVendorInput = z.infer<typeof createVendorInputSchema>;

export const updateVendorInputSchema = createVendorInputSchema.partial().omit({ code: true });
export type UpdateVendorInput = z.infer<typeof updateVendorInputSchema>;

/** BULK CREATE — the Excel importer's whole sheet in ONE request.
 *
 *  The importer used to POST /vendors once per row and wait for each answer,
 *  and every answer invalidated the on-screen vendor list, so the browser also
 *  re-downloaded the entire master after every single row. Measured on the live
 *  system that ran at ~1 vendor per second; a 500-row sheet took nine minutes.
 *  One request, one transaction, one list reload puts the same sheet in in
 *  seconds.
 *
 *  Capped at 2000 rows — comfortably past the largest master anyone would paste
 *  in, and small enough that the whole insert stays one sane transaction. */
export const bulkCreateVendorsInputSchema = z.object({
  vendors: z.array(createVendorInputSchema).min(1).max(2000),
});
export type BulkCreateVendorsInput = z.infer<typeof bulkCreateVendorsInputSchema>;

/** One row the bulk create refused, with the reason in the user's words. */
export interface BulkVendorSkip {
  /** 1-based position in the submitted array, so the UI can name the sheet row. */
  index: number;
  name: string;
  reason: string;
}

export interface BulkCreateVendorsResponse {
  created: number;
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkVendorSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const vendorSortFieldSchema = z.enum(['code', 'name']);
export type VendorSortField = z.infer<typeof vendorSortFieldSchema>;

export const listVendorsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
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
