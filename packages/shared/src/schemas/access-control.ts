// Access Control zod schemas + types.
//
// Wire shapes for the Access Control matrix. Server validates input;
// frontend infers types from these schemas for the matrix editor and
// `useMyAccess()` hook. Mirror of legacy db.userAccess record shape
// (renderAccessControl L13861; _editAccess L13917).
//
// ── Tier upgrade (0100) ──────────────────────────────────────────
// The matrix used to be two independent things: a dept map of booleans
// that only decided sidebar visibility, and a per-form view/entry/edit
// triple that nothing read. It now expresses the (Tier + Department)
// model:
//
//   departments : dept → tier key (L1…L5)   — the baseline in that dept
//   forms       : form → per-action grants  — EXTRAS on top of the tier
//   fullAccess  : L6 Super Admin            — everything, everywhere
//   auditor     : L7 Auditor                — read everything, write nothing
//
// Form grants are ADDITIVE. A tick can only add a right the tier did not
// give; it can never take one away. That keeps "why can this person do
// this?" answerable from two places instead of a subtraction chain, and
// means an admin cannot accidentally strand a user by unticking one row.
// To reduce someone's rights, lower their tier.
//
// Legacy shape is still accepted on read: a `true` dept value (what every
// pre-0100 row holds) normalises to L1 — the safest reading, since before
// this change a dept tick granted no write rights at all. Migration 0100
// rewrites the stored rows to the tier that matches each user's role.

import { z } from 'zod';
import {
  ACCESS_DEPT_KEYS,
  ACCESS_FORM_KEYS,
  ACCESS_FORMS,
  ACCESS_TIER_KEYS,
  accessTier,
  type AccessDeptKey,
  type AccessFormKey,
  type AccessTierKey,
  isAccessTierKey,
} from '../enums/access-control';

// Per-form action set. Cascade (Edit ⇒ Entry ⇒ View, Approve ⇒ View) is
// enforced by the service on save; reads receive whatever was last stored.
// `approve` defaults so pre-0100 rows — which only ever stored the three
// original actions — parse without a backfill.
export const accessFormPermsSchema = z.object({
  view: z.boolean(),
  entry: z.boolean(),
  edit: z.boolean(),
  approve: z.boolean().default(false),
});
export type AccessFormPerms = z.infer<typeof accessFormPermsSchema>;

export const accessTierKeySchema = z.enum(
  ACCESS_TIER_KEYS as unknown as [AccessTierKey, ...AccessTierKey[]],
);

// JSONB maps. Use plain `Record` types so jsonb columns store cleanly.
// Keys are validated to be members of the registry but unknown keys
// are dropped silently on save (so renamed/deleted form keys don't
// block writes). The dept map accepts the legacy boolean shape as well
// as a tier key — see the normaliser below.
export const accessDeptsMapSchema = z.record(z.union([z.boolean(), accessTierKeySchema]));
export type AccessDeptsMap = Record<string, boolean | AccessTierKey>;

export const accessFormsMapSchema = z.record(accessFormPermsSchema);
export type AccessFormsMap = Record<string, AccessFormPerms>;

// The user_access row, serialised over the wire.
export const userAccessSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  companyId: z.string().uuid(),
  fullAccess: z.boolean(),
  auditor: z.boolean().default(false),
  departments: accessDeptsMapSchema,
  forms: accessFormsMapSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserAccess = z.infer<typeof userAccessSchema>;

// Save input — admin updates one user's matrix.
export const saveUserAccessInputSchema = z.object({
  fullAccess: z.boolean(),
  auditor: z.boolean().default(false),
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
  auditor: z.boolean().default(false),
  // Pre-computed counts so the table doesn't need the full forms map per row.
  deptCount: z.number().int().nonnegative(),
  totalDepts: z.number().int().nonnegative(),
  formCount: z.number().int().nonnegative(),
  totalForms: z.number().int().nonnegative(),
  // "Sales L3 · Store L1" — the row's headline, precomputed so the list
  // does not have to fetch every user's full matrix to render it.
  tierSummary: z.string().default(''),
});
export type UserAccessListItem = z.infer<typeof userAccessListItemSchema>;

export const listUserAccessResponseSchema = z.object({
  items: z.array(userAccessListItemSchema),
});
export type ListUserAccessResponse = z.infer<typeof listUserAccessResponseSchema>;

// "Effective" access for /me — applies fullAccess + cascade so the web
// shell can answer canView/canEdit/canEntry/canApprove without re-deriving
// the logic.
export const effectiveAccessSchema = z.object({
  fullAccess: z.boolean(),
  auditor: z.boolean().default(false),
  departments: accessDeptsMapSchema,
  forms: accessFormsMapSchema,
});
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>;

const NO_PERMS: AccessFormPerms = { view: false, entry: false, edit: false, approve: false };
const ALL_PERMS: AccessFormPerms = { view: true, entry: true, edit: true, approve: true };

export function emptyFormPerms(): AccessFormPerms {
  return { ...NO_PERMS };
}

// Apply the cascade to a single perms set. Edit ⇒ View+Entry+Edit;
// Entry ⇒ View+Entry; Approve ⇒ View+Approve (approve is deliberately
// NOT implied by edit — an Editor who cannot approve is the point of L3).
export function cascadeFormPerms(p: AccessFormPerms): AccessFormPerms {
  const approve = p.approve;
  if (p.edit) return { view: true, entry: true, edit: true, approve };
  if (p.entry) return { view: true, entry: true, edit: false, approve };
  return { view: p.view || approve, entry: false, edit: false, approve };
}

// Apply the cascade across every form. Used on save and when computing
// effective access for /me.
export function cascadeFormsMap(forms: AccessFormsMap): AccessFormsMap {
  const out: AccessFormsMap = {};
  for (const [k, v] of Object.entries(forms)) {
    out[k] = cascadeFormPerms({ ...NO_PERMS, ...v });
  }
  return out;
}

// Collapse the stored dept map — legacy booleans and tier keys alike —
// into dept → tier. A `true` becomes L1: before the tier model a dept
// tick carried no write rights, so reading it as anything higher would
// silently promote every existing user.
export function normalizeDeptsMap(m: AccessDeptsMap): Record<string, AccessTierKey> {
  const out: Record<string, AccessTierKey> = {};
  for (const [k, v] of Object.entries(m)) {
    if (isAccessTierKey(v)) out[k] = v;
    else if (v === true) out[k] = 'L1';
  }
  return out;
}

// Strip unknown keys from a dept map, preserving each tier. Server-side
// defensive sanitation.
export function pruneDeptsMap(m: AccessDeptsMap): Record<string, AccessTierKey> {
  const normalized = normalizeDeptsMap(m);
  const out: Record<string, AccessTierKey> = {};
  for (const k of ACCESS_DEPT_KEYS) {
    const tier = normalized[k];
    if (tier) out[k] = tier;
  }
  return out;
}

// Strip unknown form keys. Defensive — keys that have been removed from
// the registry get silently dropped on the next save.
export function pruneFormsMap(m: AccessFormsMap): AccessFormsMap {
  const out: AccessFormsMap = {};
  for (const k of ACCESS_FORM_KEYS) {
    if (m[k]) out[k] = m[k]!;
  }
  return out;
}

// ── Frontend + server gate helpers ───────────────────────────
// Behavior on the load states:
//   - `eff` null/undefined         ⇒ deny (still loading, fail closed)
//   - `eff.fullAccess === true`    ⇒ allow (L6)
//   - `eff` unconfigured           ⇒ DENY (see note)
//   - otherwise                    ⇒ tier for the form's dept, plus any
//                                    explicit per-form grants, plus the
//                                    L7 auditor read-everything flag
//
// "Unconfigured" = no full_access, no auditor, no dept grants and no form
// grants. It used to mean ALLOW-ALL: the matrix shipped as opt-in, so every
// non-admin backfilled with an empty row had to keep working until an admin
// got round to configuring them (docs/PARITY/access-control.md §10 DELTA #6).
//
// That rollout is over, and the rule had inverted itself. Once role moved out
// of User Management, a newly created user was active immediately with no
// access row — so the person nobody had configured yet saw MORE of the ERP
// than the person who had been given two departments. An empty matrix now
// denies. Admins still bypass everything (both in the sidebar and in
// requireFormAccess), so an admin can always configure their way out.
export function isUnconfigured(eff: EffectiveAccess): boolean {
  return (
    !eff.fullAccess &&
    !eff.auditor &&
    Object.keys(eff.departments).length === 0 &&
    Object.keys(eff.forms).length === 0
  );
}

// Which tier does this user hold in this department? Null = none.
export function deptTier(
  eff: EffectiveAccess | null | undefined,
  dept: AccessDeptKey,
): AccessTierKey | null {
  if (!eff) return null;
  return normalizeDeptsMap(eff.departments)[dept] ?? null;
}

// The single source of truth for "what may this user do on this form".
// Grants are unioned, never subtracted: department tier ∪ explicit form
// ticks ∪ the auditor read flag.
export function effectiveFormPerms(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): AccessFormPerms {
  if (!eff) return { ...NO_PERMS };
  if (eff.fullAccess) return { ...ALL_PERMS };

  const form = ACCESS_FORMS.find((f) => f.key === formKey);
  const tierKey = form ? normalizeDeptsMap(eff.departments)[form.dept] : undefined;
  const fromTier = tierKey ? accessTier(tierKey).perms : NO_PERMS;
  const fromForm = cascadeFormPerms({ ...NO_PERMS, ...(eff.forms[formKey] ?? NO_PERMS) });

  return {
    view: eff.auditor || fromTier.view || fromForm.view,
    entry: fromTier.entry || fromForm.entry,
    edit: fromTier.edit || fromForm.edit,
    approve: fromTier.approve || fromForm.approve,
  };
}

export function canViewForm(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): boolean {
  return effectiveFormPerms(eff, formKey).view;
}

export function canEntryForm(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): boolean {
  return effectiveFormPerms(eff, formKey).entry;
}

export function canEditForm(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): boolean {
  return effectiveFormPerms(eff, formKey).edit;
}

export function canApproveForm(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): boolean {
  return effectiveFormPerms(eff, formKey).approve;
}

export function hasDeptAccess(
  eff: EffectiveAccess | null | undefined,
  dept: AccessDeptKey,
): boolean {
  if (!eff) return false;
  if (eff.fullAccess || eff.auditor) return true;
  return normalizeDeptsMap(eff.departments)[dept] !== undefined;
}
