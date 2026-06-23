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

export const clientSortFieldSchema = z.enum(['code', 'name']);
export type ClientSortField = z.infer<typeof clientSortFieldSchema>;

export const listClientsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  sortBy: clientSortFieldSchema.optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export interface ListClientsResponse {
  clients: Client[];
  total: number;
  limit: number;
  offset: number;
}
