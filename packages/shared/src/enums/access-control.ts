// Access Control registry — depts + forms + actions.
//
// Mirror of legacy _allDepts (HTML L13849) and _allForms (HTML L13811).
// 35 legacy form keys ported verbatim (preserving keys for modules that
// don't yet exist in React, e.g. oj_create / servicepo_create — these
// stay defined so when those modules ship their gating is pre-wired)
// plus 4 new keys for React-only modules:
//   - tpi_submit             (TPI module)
//   - qcdocs_upload          (QC Documents matrix)
//   - accesscontrol_manage   (this module itself)
//   - printtpl_edit          (Print Templates admin editor)
//
// Single source of truth — API, web sidebar gating, web button gating,
// and the matrix editor all consume this registry.

// ── Departments (drive sidebar section visibility) ─────────────
export const ACCESS_DEPTS = [
  { key: 'planning',   label: 'Planning',   color: '#8B5CF6' },
  { key: 'sales',      label: 'Sales',      color: '#22C55E' },
  { key: 'store',      label: 'Store',      color: '#F59E0B' },
  { key: 'design',     label: 'Design',     color: '#8B5CF6' },
  { key: 'production', label: 'Production', color: '#06B6D4' },
  { key: 'qc',         label: 'QC',         color: '#EF4444' },
  { key: 'purchase',   label: 'Purchase',   color: '#2563EB' },
  { key: 'finance',    label: 'Finance',    color: '#0D9488' },
  { key: 'system',     label: 'System',     color: '#64748B' },
] as const;

export type AccessDept = (typeof ACCESS_DEPTS)[number];
export type AccessDeptKey = AccessDept['key'];

export const ACCESS_DEPT_KEYS: readonly AccessDeptKey[] = ACCESS_DEPTS.map((d) => d.key);

// ── Form actions ───────────────────────────────────────────────
// Edit ⊃ Entry ⊃ View. Approve is INDEPENDENT of edit — it only implies
// view, so an L4 Approver can sign off a document without being able to
// create or alter one (segregation of duty). Cascade enforced at
// write-time by the service.
export const ACCESS_ACTIONS = ['view', 'entry', 'edit', 'approve'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

// ── Form keys ──────────────────────────────────────────────────
// 35 legacy keys + 4 React-only keys. Each entry: { key, dept, label }.
// `dept` MUST be one of ACCESS_DEPT_KEYS.
export const ACCESS_FORMS = [
  // Sales
  { key: 'so_create',          dept: 'sales',      label: 'SO Master' },
  { key: 'jw_create',          dept: 'sales',      label: 'JW Master' },
  { key: 'client_create',      dept: 'sales',      label: 'Client Master' },
  { key: 'dispatch_create',    dept: 'sales',      label: 'Dispatch Register' },
  // Planning
  { key: 'plan_create',        dept: 'planning',   label: 'SO/JW Planning' },
  // Production
  { key: 'jc_create',          dept: 'production', label: 'Job Cards' },
  { key: 'op_entry',           dept: 'production', label: 'Op Entry' },
  { key: 'machop_entry',       dept: 'production', label: 'Machine Op Entry' },
  { key: 'machine_create',     dept: 'production', label: 'Machine Master' },
  { key: 'operator_create',    dept: 'production', label: 'Operator Master' },
  // Design
  { key: 'routecard_create',   dept: 'design',     label: 'Route Cards' },
  { key: 'bom_create',         dept: 'design',     label: 'BOM Master' },
  { key: 'design_create',      dept: 'design',     label: 'Design Tracker' },
  { key: 'dsnproj_create',     dept: 'design',     label: 'Design Projects' },
  { key: 'dsnissue_create',    dept: 'design',     label: 'Design Issues' },
  { key: 'dsnworklog_create',  dept: 'design',     label: 'Daily Work Log' },
  { key: 'dsndcr_create',      dept: 'design',     label: 'Design DCR/DCN' },
  // Store
  { key: 'item_create',        dept: 'store',      label: 'Item Master' },
  { key: 'grn_create',         dept: 'store',      label: 'GRN' },
  { key: 'issue_create',       dept: 'store',      label: 'Item Issue Register' },
  { key: 'toolissue_create',   dept: 'store',      label: 'Tool Issue Register' },
  { key: 'party_create',       dept: 'store',      label: 'Party Material' },
  // QC
  { key: 'qc_submit',          dept: 'qc',         label: 'QC Call Register' },
  { key: 'qc_incoming',        dept: 'qc',         label: 'Incoming QC' },
  { key: 'qcprocess_create',   dept: 'qc',         label: 'QC Process Master' },
  { key: 'nc_dispose',         dept: 'qc',         label: 'NC Register' },
  { key: 'capa_create',        dept: 'qc',         label: 'CAPA' },
  // — New React-only QC keys —
  { key: 'tpi_submit',         dept: 'qc',         label: 'TPI' },
  { key: 'qcdocs_upload',      dept: 'qc',         label: 'QC Documents' },
  // Purchase
  { key: 'pr_create',          dept: 'purchase',   label: 'Purchase Requests' },
  { key: 'po_create',          dept: 'purchase',   label: 'Purchase Orders' },
  { key: 'vendor_create',      dept: 'purchase',   label: 'Vendor Master' },
  { key: 'oj_create',          dept: 'purchase',   label: 'Outsource Jobs' },
  { key: 'ospdc_create',       dept: 'purchase',   label: 'OSP DC & Outward' },
  { key: 'servicepo_create',   dept: 'purchase',   label: 'Service PO' },
  // Finance
  { key: 'cc_create',          dept: 'finance',    label: 'Cost Center Master' },
  // System
  { key: 'user_manage',        dept: 'system',     label: 'User Management' },
  // — New React-only System keys —
  { key: 'accesscontrol_manage', dept: 'system',   label: 'Access Control' },
  { key: 'printtpl_edit',      dept: 'system',     label: 'Print Templates' },
] as const satisfies readonly { key: string; dept: AccessDeptKey; label: string }[];

export type AccessForm = (typeof ACCESS_FORMS)[number];
export type AccessFormKey = AccessForm['key'];

export const ACCESS_FORM_KEYS: readonly AccessFormKey[] = ACCESS_FORMS.map((f) => f.key);

// Build-time guard so a stray dept key in ACCESS_FORMS surfaces as a compile
// error: every form's dept must be one of ACCESS_DEPT_KEYS (enforced via the
// `satisfies` clause above).

// ── Tiers (L1–L7) ──────────────────────────────────────────────
// A tier is a named bundle of the four actions, granted PER DEPARTMENT.
// That pairing is the whole point: "L3 in Sales, L1 in Store" is one
// user, not two roles. Previously the only lever was `users.role`, a
// single global value that applied identically in every department.
//
// L1–L5 live in the departments map (dept → tier). The last two are
// whole-account flags on the user_access row because they are not
// per-department by nature:
//   L6 Super Admin — `full_access` (already existed)
//   L7 Auditor     — `auditor` (new): read EVERY department, write nothing
//
// A tier can only ever RESTRICT what `users.role` already permits — the
// row-level-security policies keyed to the role remain the outer wall,
// so a tier can never hand out more than the role allows. `recommendedRole`
// is what the role must be for the tier to be fully usable; the UI warns
// when the two disagree rather than silently granting nothing.
export const ACCESS_TIERS = [
  {
    key: 'L1',
    label: 'Viewer',
    perms: { view: true, entry: false, edit: false, approve: false },
    hint: 'Can open and read. Cannot save anything.',
    recommendedRole: 'viewer',
  },
  {
    key: 'L2',
    label: 'Data Entry',
    perms: { view: true, entry: true, edit: false, approve: false },
    hint: 'Can create new records. Cannot change one after it is saved.',
    recommendedRole: 'operator',
  },
  {
    key: 'L3',
    label: 'Editor / Executor',
    perms: { view: true, entry: true, edit: true, approve: false },
    hint: 'Can create and change records. Cannot approve.',
    recommendedRole: 'manager',
  },
  {
    key: 'L4',
    label: 'Approver',
    perms: { view: true, entry: false, edit: false, approve: true },
    hint: 'Can approve or reject. Cannot create or change — and never their own record.',
    recommendedRole: 'manager',
  },
  {
    key: 'L5',
    label: 'Department Admin',
    perms: { view: true, entry: true, edit: true, approve: true },
    hint: 'Full rights inside this department only.',
    recommendedRole: 'manager',
  },
] as const satisfies readonly {
  key: string;
  label: string;
  perms: { view: boolean; entry: boolean; edit: boolean; approve: boolean };
  hint: string;
  recommendedRole: string;
}[];

export type AccessTier = (typeof ACCESS_TIERS)[number];
export type AccessTierKey = AccessTier['key'];

export const ACCESS_TIER_KEYS: readonly AccessTierKey[] = ACCESS_TIERS.map((t) => t.key);

export function isAccessTierKey(k: unknown): k is AccessTierKey {
  return typeof k === 'string' && (ACCESS_TIER_KEYS as readonly string[]).includes(k);
}

export function accessTier(key: AccessTierKey): AccessTier {
  // Non-null: key is constrained to the registry by its type.
  return ACCESS_TIERS.find((t) => t.key === key)!;
}

// The highest tier a given `users.role` can actually deliver.
//
// Row-level security is still keyed to the role, so a tier above this
// ceiling silently does nothing — the matrix would say yes and the database
// would say no. Rather than let an admin configure a user who then cannot
// work, the UI compares the two and says so.
//
//   admin / manager → L5  (write everywhere the RLS policies allow)
//   qc              → L3  (records and amends inspections)
//   operator        → L2  (records entries; cannot amend after submit)
//   everyone else   → L1  (procurement / dispatch / design / viewer carry no
//                          write rights in any policy — read-only in practice)
export function maxTierForRole(role: string): AccessTierKey {
  if (role === 'admin' || role === 'manager') return 'L5';
  if (role === 'qc') return 'L3';
  if (role === 'operator') return 'L2';
  return 'L1';
}

// Is `tier` beyond what `role` can deliver? Used to warn, never to block —
// an admin may legitimately set the tier first and fix the role after.
export function tierExceedsRole(tier: AccessTierKey, role: string): boolean {
  const order = ACCESS_TIER_KEYS as readonly string[];
  return order.indexOf(tier) > order.indexOf(maxTierForRole(role));
}

// ── Helpers ────────────────────────────────────────────────────
export function isAccessDeptKey(k: string): k is AccessDeptKey {
  return (ACCESS_DEPT_KEYS as readonly string[]).includes(k);
}

export function isAccessFormKey(k: string): k is AccessFormKey {
  return (ACCESS_FORM_KEYS as readonly string[]).includes(k);
}

export function accessFormsByDept(dept: AccessDeptKey): readonly AccessForm[] {
  return ACCESS_FORMS.filter((f) => f.dept === dept);
}
