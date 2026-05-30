// Access Control zod schemas + types.
//
// Wire shapes for the Access Control matrix. Server validates input;
// frontend infers types from these schemas for the matrix editor and
// `useMyAccess()` hook. Mirror of legacy db.userAccess record shape
// (renderAccessControl L13861; _editAccess L13917).

import { z } from 'zod';
import {
  ACCESS_DEPT_KEYS,
  ACCESS_FORM_KEYS,
  type AccessDeptKey,
  type AccessFormKey,
} from '../enums/access-control';

// Per-form action triple. Cascade (Edit ⇒ Entry ⇒ View) is enforced by
// the service on save; reads receive whatever was last stored.
export const accessFormPermsSchema = z.object({
  view: z.boolean(),
  entry: z.boolean(),
  edit: z.boolean(),
});
export type AccessFormPerms = z.infer<typeof accessFormPermsSchema>;

// JSONB maps. Use plain `Record` types so jsonb columns store cleanly.
// Keys are validated to be members of the registry but unknown keys
// are dropped silently on save (so renamed/deleted form keys don't
// block writes).
export const accessDeptsMapSchema = z.record(z.boolean());
export type AccessDeptsMap = Record<string, boolean>;

export const accessFormsMapSchema = z.record(accessFormPermsSchema);
export type AccessFormsMap = Record<string, AccessFormPerms>;

// The user_access row, serialised over the wire.
export const userAccessSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  fullAccess: z.boolean(),
  departments: accessDeptsMapSchema,
  forms: accessFormsMapSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserAccess = z.infer<typeof userAccessSchema>;

// Save input — admin updates one user's matrix.
export const saveUserAccessInputSchema = z.object({
  fullAccess: z.boolean(),
  departments: accessDeptsMapSchema,
  forms: accessFormsMapSchema,
});
export type SaveUserAccessInput = z.infer<typeof saveUserAccessInputSchema>;

// Compact list-row shape for the matrix list view.
export const userAccessListItemSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  userEmail: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  fullAccess: z.boolean(),
  // Pre-computed counts so the table doesn't need the full forms map per row.
  deptCount: z.number().int().nonnegative(),
  totalDepts: z.number().int().nonnegative(),
  formCount: z.number().int().nonnegative(),
  totalForms: z.number().int().nonnegative(),
});
export type UserAccessListItem = z.infer<typeof userAccessListItemSchema>;

export const listUserAccessResponseSchema = z.object({
  items: z.array(userAccessListItemSchema),
});
export type ListUserAccessResponse = z.infer<typeof listUserAccessResponseSchema>;

// "Effective" access for /me — applies fullAccess + cascade so the web
// shell can answer canView/canEdit/canEntry without re-deriving the logic.
export const effectiveAccessSchema = z.object({
  fullAccess: z.boolean(),
  departments: accessDeptsMapSchema,
  forms: accessFormsMapSchema,
});
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>;

// Apply the View ⊆ Entry ⊆ Edit cascade to a single perms triple.
// Edit ⇒ View+Entry+Edit; Entry ⇒ View+Entry; View ⇒ View.
export function cascadeFormPerms(p: AccessFormPerms): AccessFormPerms {
  if (p.edit) return { view: true, entry: true, edit: true };
  if (p.entry) return { view: true, entry: true, edit: false };
  return { view: p.view, entry: false, edit: false };
}

// Apply the cascade across every form. Used on save and when computing
// effective access for /me.
export function cascadeFormsMap(forms: AccessFormsMap): AccessFormsMap {
  const out: AccessFormsMap = {};
  for (const [k, v] of Object.entries(forms)) {
    out[k] = cascadeFormPerms(v);
  }
  return out;
}

// Strip unknown keys from a dept map. Server-side defensive sanitation.
export function pruneDeptsMap(m: AccessDeptsMap): AccessDeptsMap {
  const out: AccessDeptsMap = {};
  for (const k of ACCESS_DEPT_KEYS) {
    if (m[k]) out[k] = true;
  }
  return out;
}

// Strip unknown form keys. Defensive — keys that have been removed from
// the registry get silently dropped on the next save.
export function pruneFormsMap(m: AccessFormsMap): AccessFormsMap {
  const out: AccessFormsMap = {};
  for (const k of ACCESS_FORM_KEYS) {
    if (m[k]) out[k] = m[k];
  }
  return out;
}

// ── Frontend helpers (the canView/canEdit/canEntry trio) ─────
// Behavior on the three load states:
//   - `eff` null/undefined         ⇒ deny (still loading, fail closed)
//   - `eff.fullAccess === true`    ⇒ allow
//   - `eff` unconfigured           ⇒ allow (smooth day-one rollout — see note)
//   - otherwise                    ⇒ check forms/departments map
//
// "Unconfigured" = no full_access AND no dept grants AND no form grants.
// That's the backfill state for every non-admin user the day the matrix
// ships. We allow them through so the matrix is opt-in for the admin to
// start using. As soon as the admin saves ANY change for a user (even
// granting one dept), that user moves into strict-mode gating. See
// docs/PARITY/access-control.md §10 DELTA #6 + the build-first-audit-later
// rollout discipline.
function isUnconfigured(eff: EffectiveAccess): boolean {
  return (
    !eff.fullAccess &&
    Object.keys(eff.departments).length === 0 &&
    Object.keys(eff.forms).length === 0
  );
}

export function canViewForm(eff: EffectiveAccess | null | undefined, formKey: AccessFormKey): boolean {
  if (!eff) return false;
  if (eff.fullAccess || isUnconfigured(eff)) return true;
  const p = eff.forms[formKey];
  return !!(p && (p.view || p.entry || p.edit));
}

export function canEntryForm(eff: EffectiveAccess | null | undefined, formKey: AccessFormKey): boolean {
  if (!eff) return false;
  if (eff.fullAccess || isUnconfigured(eff)) return true;
  const p = eff.forms[formKey];
  return !!(p && (p.entry || p.edit));
}

export function canEditForm(eff: EffectiveAccess | null | undefined, formKey: AccessFormKey): boolean {
  if (!eff) return false;
  if (eff.fullAccess || isUnconfigured(eff)) return true;
  const p = eff.forms[formKey];
  return !!(p && p.edit);
}

export function hasDeptAccess(eff: EffectiveAccess | null | undefined, dept: AccessDeptKey): boolean {
  if (!eff) return false;
  if (eff.fullAccess || isUnconfigured(eff)) return true;
  return !!eff.departments[dept];
}
