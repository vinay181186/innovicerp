// User Management shared schemas (Phase A item 5a — Legacy parity build).
//
// Backed by the existing `users` table (schema.ts L123). Mirror of legacy
// renderUsers L13435 — admin-only. Insert is NOT exposed; new users are
// invited via Supabase Auth (db-trigger seeds the row on auth.users insert
// per 0001_post_init.sql). This screen handles the lifecycle from there:
// rename / change role / change phone / deactivate / reactivate / soft-
// delete.

import { z } from 'zod';
import { USER_ROLES } from '../enums/user-role';

export const userRoleSchema = z.enum(USER_ROLES);

export const userSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  role: userRoleSchema,
  phone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

// Update only — no create (Supabase Auth owns the invite flow).
export const updateUserInputSchema = z.object({
  fullName: z.string().max(255).optional(),
  role: userRoleSchema.optional(),
  phone: z.string().max(32).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const listUsersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  role: userRoleSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface ListUsersResponse {
  items: User[];
  total: number;
  limit: number;
  offset: number;
}
