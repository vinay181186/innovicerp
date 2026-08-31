import { z } from 'zod';

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
  addressLine1: z.string().max(500).nullable(),
  city: z.string().max(100).nullable(),
  state: z.string().max(100).nullable(),
  pincode: z.string().max(12).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Client = z.infer<typeof clientSchema>;

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
  addressLine1: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(12).optional(),
  isActive: z.boolean().default(true),
});
export type CreateClientInput = z.infer<typeof createClientInputSchema>;

export const updateClientInputSchema = createClientInputSchema.partial().omit({ code: true });
export type UpdateClientInput = z.infer<typeof updateClientInputSchema>;

/** BULK CREATE — the Excel importer's whole sheet in ONE request.
 *
 *  The importer used to POST /clients once per row and wait for each answer,
 *  and every answer invalidated the on-screen client list, so the browser also
 *  re-downloaded the entire master after every single row. Measured on the live
 *  system the identical vendor importer ran at ~1 row per second; a 500-row
 *  sheet took nine minutes. One request, one transaction, one list reload puts
 *  the same sheet in in seconds.
 *
 *  Capped at 2000 rows — comfortably past the largest master anyone would paste
 *  in, and small enough that the whole insert stays one sane transaction. */
export const bulkCreateClientsInputSchema = z.object({
  clients: z.array(createClientInputSchema).min(1).max(2000),
});
export type BulkCreateClientsInput = z.infer<typeof bulkCreateClientsInputSchema>;

/** One row the bulk create refused, with the reason in the user's words. */
export interface BulkClientSkip {
  /** 1-based position in the submitted array, so the UI can name the sheet row. */
  index: number;
  name: string;
  reason: string;
}

export interface BulkCreateClientsResponse {
  created: number;
  /** Rows that were not written, each with a plain-English reason. */
  skipped: BulkClientSkip[];
  /** Codes assigned to the rows that were created, in insert order. */
  codes: string[];
}

export const clientSortFieldSchema = z.enum(['code', 'name']);
export type ClientSortField = z.infer<typeof clientSortFieldSchema>;

export const listClientsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
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
