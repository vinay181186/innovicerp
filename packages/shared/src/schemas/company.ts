// Company Settings shared schemas (Phase A item 5b — Legacy parity build).
//
// Backed by the existing `companies` table (schema.ts L81). The Settings
// page edits the caller's own company — name, GST, phone, address fields.
// Admin-only; mirrors legacy renderSettings L13351 sans the Firebase
// migration block (irrelevant on Supabase) and the destructive
// reset/factory-reset buttons (not user-friendly + can't be safely
// implemented without RLS-bypass keys).

import { z } from 'zod';

export const companySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  gstNumber: z.string().nullable(),
  phone: z.string().nullable(),
  // Letterhead footer e-mail (migration 0054) — printed on outward docs.
  email: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  pincode: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Company = z.infer<typeof companySchema>;

export const updateCompanyInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  gstNumber: z.string().max(32).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().max(255).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(64).optional(),
  state: z.string().max(64).optional(),
  pincode: z.string().max(16).optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>;
