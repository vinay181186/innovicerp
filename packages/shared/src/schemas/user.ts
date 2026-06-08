// User Management shared schemas (Phase A item 5a — Legacy parity build).
//
// Backed by the existing `users` table (schema.ts L123). Mirror of legacy
// renderUsers L13435 — admin-only. The `on_auth_user_created` trigger
// (0001_post_init.sql) seeds a public.users row on every auth signup with
// company_id=NULL/viewer/inactive. Create (ADR-046) provisions the auth
// account from the API and promotes that row into the admin's company; the
// rest of the lifecycle is rename / change role / change phone / deactivate /
// reactivate / soft-delete.

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
  // Per-user PO approval ceiling (₹). numeric column → surfaced as a string
  // (same convention as PO rate/qty). Null = no personal limit; the company
  // approval_config.po_manager_limit applies instead. See ADR-038.
  approvalLimit: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

// Create — admin onboards a new user end-to-end. The API creates the Supabase
// Auth account (admin sets the initial password) and promotes the trigger-
// seeded public.users row into the admin's company with the chosen role.
// Mirror of legacy renderUsers "+ Add User" (_addUserFull / _saveUnifiedUser).
export const createUserInputSchema = z.object({
  email: z.string().email().max(255),
  // Supabase bcrypts the password (72-byte ceiling). 8-char floor is a sane
  // minimum for an internal tool; the admin hands this to the user directly.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  fullName: z.string().min(1).max(255),
  role: userRoleSchema,
  phone: z.string().max(32).optional(),
  approvalLimit: z.number().nonnegative().max(99999999).nullable().optional(),
  // Defaults to active — an admin adding a user expects them usable at once.
  isActive: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

// Update only — no create (Supabase Auth owns the invite flow).
export const updateUserInputSchema = z.object({
  fullName: z.string().max(255).optional(),
  role: userRoleSchema.optional(),
  phone: z.string().max(32).optional(),
  isActive: z.boolean().optional(),
  // null clears the personal limit (falls back to company po_manager_limit);
  // a non-negative number sets it. Mirror of legacy renderUsers approvalLimit
  // field (L13579). See ADR-038.
  approvalLimit: z.number().nonnegative().max(99999999).nullable().optional(),
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
