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
// ONE exception: `priceOff`. "Can do the job but must not see the number" is
// a real, ordinary request for money and has no equivalent for the write
// actions — if someone should not edit, you simply do not give them L3. So
// the money column alone is revocable per form, and nothing else is.
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
  tierSeesPrice,
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
  // `price` = may this user see money (rates / amounts / totals / costs) on
  // this form. Defaults false so pre-price rows parse without a backfill; the
  // department tier supplies it by default (see tierSeesPrice), so a tick here
  // is only needed to grant money BELOW the department's normal starting tier.
  price: z.boolean().default(false),
  // `priceOff` = money's per-form subtraction. Set, it hides money on this form
  // even though the department tier would have shown it — the "does the job,
  // must not see the number" case (a Sales L2 who enters orders but is not to
  // see rates). Defaults false, so every stored row written before this existed
  // keeps behaving exactly as it did.
  priceOff: z.boolean().default(false),
  // ── Per-page OFF switches (the write-action counterparts of priceOff) ──
  // Each one SUBTRACTS its action on this one form, below whatever the
  // department tier granted — the same "revoke for one page" lever priceOff is,
  // generalised to view / create / edit / approve. They exist because the tier
  // is set per DEPARTMENT: without them an admin who wants "L3 across Purchase
  // but hands off Vendor Master" has no way to say it. Grants still only ADD;
  // these are the sanctioned way to take one action away for one page.
  //
  //   viewOff    = "Hide page"  — removes the page entirely (sidebar link gone,
  //                URL shows the no-access panel). Cascades: a page you cannot
  //                open grants no create / edit / approve / price either.
  //   entryOff   = "No create"  — can open and read, but cannot create.
  //   editOff    = "No edit"    — cannot change a saved record.
  //   approveOff = "No approve" — cannot approve / reject.
  //
  // All default false, so every stored row keeps behaving exactly as before.
  viewOff: z.boolean().default(false),
  entryOff: z.boolean().default(false),
  editOff: z.boolean().default(false),
  approveOff: z.boolean().default(false),
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
  // Which department this person belongs to. Seeds that department's tier and
  // is what the screens show in place of the old role dropdown. Null for L6 /
  // L7 accounts, which are not departmental, and for anyone not set up yet.
  mainDept: z.string().nullable().default(null),
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
  mainDept: z.string().nullable().default(null),
  // Explicit intent to drop someone out of admin. The derived role makes it
  // possible to demote an admin by saving an empty box, which is a one-click
  // accident with no undo — so the server refuses unless the caller says they
  // meant it, and the modal asks first.
  confirmAdminChange: z.boolean().default(false),
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
  mainDept: z.string().nullable().default(null),
  // What the access below WOULD derive to. `role` above is what is stored and
  // enforced right now; they differ for anyone whose access has never been
  // saved, and the row says so rather than leaving it invisible.
  derivedRole: z.string().default(''),
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

const NO_PERMS: AccessFormPerms = {
  view: false,
  entry: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  editOff: false,
  approveOff: false,
};
const ALL_PERMS: AccessFormPerms = {
  view: true,
  entry: true,
  edit: true,
  approve: true,
  price: true,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  editOff: false,
  approveOff: false,
};

export function emptyFormPerms(): AccessFormPerms {
  return { ...NO_PERMS };
}

// Apply the cascade to a single perms set. Edit ⇒ View+Entry+Edit;
// Entry ⇒ View+Entry; Approve ⇒ View+Approve (approve is deliberately
// NOT implied by edit — an Editor who cannot approve is the point of L3).
export function cascadeFormPerms(p: AccessFormPerms): AccessFormPerms {
  const approve = p.approve;
  // `price` / `priceOff` (can-see-money) are independent — they neither imply
  // nor are implied by any write action, so they pass straight through the
  // cascade untouched. The four OFF switches are subtractions applied AFTER the
  // cascade (in effectiveFormPerms), so they too pass through here unchanged.
  const price = p.price;
  const off = {
    priceOff: p.priceOff,
    viewOff: p.viewOff,
    entryOff: p.entryOff,
    editOff: p.editOff,
    approveOff: p.approveOff,
  };
  if (p.edit) return { view: true, entry: true, edit: true, approve, price, ...off };
  if (p.entry) return { view: true, entry: true, edit: false, approve, price, ...off };
  return { view: p.view || approve, entry: false, edit: false, approve, price, ...off };
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

  // "Hide page" (viewOff) is the whole-page kill switch and wins over the tier,
  // over per-form grants, and over the auditor read flag — the same way priceOff
  // beats them for money. Nothing on a page you cannot open is reachable, so
  // every action collapses to false. (L6 Super Admin never reaches here — it
  // returned ALL_PERMS above and is never hidden.)
  if (fromForm.viewOff) {
    return {
      ...NO_PERMS,
      viewOff: true,
      entryOff: fromForm.entryOff,
      editOff: fromForm.editOff,
      approveOff: fromForm.approveOff,
      priceOff: fromForm.priceOff,
    };
  }

  // Money is the only right the department decides as well as the tier:
  // Sales / Purchase / Store / Finance from L2, every other department from
  // L3. See `priceStartTier` for why.
  const tierPrice = form && tierKey ? tierSeesPrice(form.dept, tierKey) : false;

  return {
    view: eff.auditor || fromTier.view || fromForm.view,
    // Each OFF switch subtracts its own action AFTER the tier ∪ per-form-grant
    // union — the write-action mirror of priceOff. An admin who ticked "No
    // create / No edit / No approve" on this one page meant it, so it beats the
    // tier just like Hide-price does. Grants can only ever ADD; these are the
    // sanctioned way to take one action back for one page.
    entry: (fromTier.entry || fromForm.entry) && !fromForm.entryOff,
    edit: (fromTier.edit || fromForm.edit) && !fromForm.editOff,
    approve: (fromTier.approve || fromForm.approve) && !fromForm.approveOff,
    // Auditors read everything, money included; otherwise money follows the
    // department's starting tier or an explicit per-form "see price" tick.
    price: !fromForm.priceOff && (eff.auditor || tierPrice || fromForm.price),
    viewOff: false,
    entryOff: fromForm.entryOff,
    editOff: fromForm.editOff,
    approveOff: fromForm.approveOff,
    priceOff: fromForm.priceOff,
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

// May this user see money (rates / amounts / totals / costs) on this form?
// The single source of truth for hiding prices from L1 Viewers, used by both
// the web (to drop money columns/tiles) and the API (to null money fields
// before they leave the server).
export function canSeePrice(
  eff: EffectiveAccess | null | undefined,
  formKey: AccessFormKey,
): boolean {
  return effectiveFormPerms(eff, formKey).price;
}

export function hasDeptAccess(
  eff: EffectiveAccess | null | undefined,
  dept: AccessDeptKey,
): boolean {
  if (!eff) return false;
  if (eff.fullAccess || eff.auditor) return true;
  return normalizeDeptsMap(eff.departments)[dept] !== undefined;
}
