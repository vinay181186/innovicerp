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
  { key: 'planning', label: 'Planning', color: '#8B5CF6' },
  { key: 'sales', label: 'Sales', color: '#22C55E' },
  { key: 'store', label: 'Store', color: '#F59E0B' },
  { key: 'design', label: 'Design', color: '#8B5CF6' },
  { key: 'production', label: 'Production', color: '#06B6D4' },
  { key: 'qc', label: 'QC', color: '#EF4444' },
  { key: 'purchase', label: 'Purchase', color: '#2563EB' },
  { key: 'finance', label: 'Finance', color: '#0D9488' },
  // Tasks and Reports were hardcoded as "always visible" in the sidebar
  // (UNGATED_SECTIONS) from before the tier model existed, so every account —
  // including one nobody had configured — saw the task board, the alert
  // drill-downs, the activity log and 19 cross-department reports. They are
  // ordinary departments now: invisible until granted, like everything else.
  //
  // They carry no ACCESS_FORMS keys, so the tier alone decides visibility.
  // Grant them at L1 — a higher tier here would raise the account's derived
  // role globally (see `roleForAccess`), which is not what "may open Reports"
  // should mean.
  { key: 'tasks', label: 'Tasks', color: '#EC4899' },
  { key: 'reports', label: 'Reports', color: '#0EA5E9' },
  { key: 'system', label: 'System', color: '#64748B' },
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
  { key: 'so_create', dept: 'sales', label: 'SO Master' },
  { key: 'jw_create', dept: 'sales', label: 'JW Master' },
  { key: 'client_create', dept: 'sales', label: 'Client Master' },
  { key: 'dispatch_create', dept: 'sales', label: 'Dispatch Register' },
  // Planning
  { key: 'plan_create', dept: 'planning', label: 'SO/JW Planning' },
  // Production
  { key: 'jc_create', dept: 'production', label: 'Job Cards' },
  { key: 'op_entry', dept: 'production', label: 'Op Entry' },
  { key: 'machop_entry', dept: 'production', label: 'Machine Op Entry' },
  { key: 'machine_create', dept: 'production', label: 'Machine Master' },
  { key: 'operator_create', dept: 'production', label: 'Operator Master' },
  // Design
  { key: 'routecard_create', dept: 'design', label: 'Route Cards' },
  { key: 'bom_create', dept: 'design', label: 'BOM Master' },
  { key: 'design_create', dept: 'design', label: 'Design Tracker' },
  { key: 'dsnproj_create', dept: 'design', label: 'Design Projects' },
  { key: 'dsnissue_create', dept: 'design', label: 'Design Issues' },
  { key: 'dsnworklog_create', dept: 'design', label: 'Daily Work Log' },
  { key: 'dsndcr_create', dept: 'design', label: 'Design DCR/DCN' },
  // Store
  { key: 'item_create', dept: 'store', label: 'Item Master' },
  { key: 'grn_create', dept: 'store', label: 'GRN' },
  { key: 'issue_create', dept: 'store', label: 'Item Issue Register' },
  { key: 'toolissue_create', dept: 'store', label: 'Tool Issue Register' },
  { key: 'party_create', dept: 'store', label: 'Party Material' },
  // QC
  { key: 'qc_submit', dept: 'qc', label: 'QC Call Register' },
  { key: 'qc_incoming', dept: 'qc', label: 'Incoming QC' },
  { key: 'qcprocess_create', dept: 'qc', label: 'QC Process Master' },
  { key: 'nc_dispose', dept: 'qc', label: 'NC Register' },
  { key: 'capa_create', dept: 'qc', label: 'CAPA' },
  // — New React-only QC keys —
  { key: 'tpi_submit', dept: 'qc', label: 'TPI' },
  { key: 'qcdocs_upload', dept: 'qc', label: 'QC Documents' },
  // Purchase
  { key: 'pr_create', dept: 'purchase', label: 'Purchase Requests' },
  { key: 'po_create', dept: 'purchase', label: 'Purchase Orders' },
  { key: 'vendor_create', dept: 'purchase', label: 'Vendor Master' },
  { key: 'oj_create', dept: 'purchase', label: 'Outsource Jobs' },
  { key: 'ospdc_create', dept: 'purchase', label: 'OSP DC & Outward' },
  { key: 'servicepo_create', dept: 'purchase', label: 'Service PO' },
  // Finance
  { key: 'cc_create', dept: 'finance', label: 'Cost Center Master' },
  { key: 'invoice_create', dept: 'finance', label: 'Invoices' },
  // System
  { key: 'user_manage', dept: 'system', label: 'User Management' },
  // — New React-only System keys —
  { key: 'accesscontrol_manage', dept: 'system', label: 'Access Control' },
  { key: 'printtpl_edit', dept: 'system', label: 'Print Templates' },
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
// Since ADR-136 the relationship runs the other way: `users.role` is
// DERIVED from the tiers granted here (see `roleForAccess`), not a ceiling
// they have to fit under. An earlier version of this comment claimed the
// row-level-security policies keyed to the role were the outer wall beneath
// the tiers — they are not. The API connects as a role that bypasses RLS, so
// those policies never run, and the `require*Role` guards in the services are
// the only enforcement there is. That is precisely why the role must follow
// the access instead of being chosen next to it.
// "Can see price" is deliberately NOT a perm on the tier table. Money is the
// one right that depends on the DEPARTMENT as well as the level — see
// `priceStartTier` below — so a tier alone cannot answer it. Ask
// `tierSeesPrice(dept, tier)` or `tierPermsForDept(dept, tier)` instead.
export const ACCESS_TIERS = [
  {
    key: 'L1',
    label: 'Viewer',
    perms: { view: true, entry: false, edit: false, approve: false },
    hint: 'Can open and read. Cannot save anything. Never sees prices/amounts.',
  },
  {
    key: 'L2',
    label: 'Data Entry',
    perms: { view: true, entry: true, edit: false, approve: false },
    hint: 'Can create new records. Cannot change one after it is saved. Sees prices only in Sales, Purchase, Store and Finance.',
  },
  {
    key: 'L3',
    label: 'Editor / Executor',
    perms: { view: true, entry: true, edit: true, approve: false },
    hint: 'Can create and change records. Cannot approve. Sees prices in any department.',
  },
  {
    key: 'L4',
    label: 'Approver',
    perms: { view: true, entry: false, edit: false, approve: true },
    hint: 'Can approve or reject. Cannot create or change — and never their own record.',
  },
  {
    key: 'L5',
    label: 'Department Admin',
    perms: { view: true, entry: true, edit: true, approve: true },
    hint: 'Full rights inside this department only.',
  },
] as const satisfies readonly {
  key: string;
  label: string;
  perms: { view: boolean; entry: boolean; edit: boolean; approve: boolean };
  hint: string;
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

// ── Who may see money ──────────────────────────────────────────
// "Can see price" is the one right that is NOT decided by the level alone.
// It depends on the department too.
//
// In the four money departments the paperwork IS the money: a Purchase L2
// clerk types the rate, a Store L2 books a GRN against it, Sales quotes it
// and Finance settles it. Blind them and they cannot do the job at all.
//
// Everywhere else the L2 is a data-entry hand — a production operator booking
// quantity done, a QC hand recording a result — and the cost of the part is
// none of their business. There money starts one level higher, at L3, where
// you are running the department rather than feeding it.
//
// L1 never sees money in any department. That is the whole point of L1.
export const PRICE_AT_L2_DEPTS: readonly AccessDeptKey[] = [
  'sales',
  'purchase',
  'store',
  'finance',
];

// The lowest tier that sees money in this department.
export function priceStartTier(dept: AccessDeptKey): AccessTierKey {
  return (PRICE_AT_L2_DEPTS as readonly string[]).includes(dept) ? 'L2' : 'L3';
}

// Does this (department, tier) pair see money by default? L4 Approver counts
// as above L3 here — an approver who cannot read the amount cannot approve.
export function tierSeesPrice(dept: AccessDeptKey, tier: AccessTierKey): boolean {
  const order = ACCESS_TIER_KEYS as readonly string[];
  return order.indexOf(tier) >= order.indexOf(priceStartTier(dept));
}

// The full perm set a tier grants inside a given department — the tier table's
// four write actions plus the department-dependent money right. This is what
// callers want; `accessTier(k).perms` alone cannot answer the price question.
export function tierPermsForDept(
  dept: AccessDeptKey,
  tier: AccessTierKey,
): { view: boolean; entry: boolean; edit: boolean; approve: boolean; price: boolean } {
  return { ...accessTier(tier).perms, price: tierSeesPrice(dept, tier) };
}

// What a department gets the moment it is picked as someone's MAIN
// department. Editor / Executor is the working level — create and change
// records in your own department, but not approve them. An admin can drop it
// afterwards (a Design viewer is L1) or raise it; this is only the seed.
export const MAIN_DEPT_DEFAULT_TIER: AccessTierKey = 'L3';

// Derive `users.role` from the access someone was granted.
//
// The role dropdown is gone: an admin picks a department, not a job title.
// But 120 places in the API still gate writes on `users.role` — it is what
// actually blocks a save — so a role still has to be written. It is now a
// CONSEQUENCE of the access, never a separate choice, which is what stops the
// two from ever disagreeing.
//
// The rule is "the narrowest role that still covers everything they were
// given":
//   full access        → admin   (the only path to admin — never derived)
//   auditor            → viewer  (reads everything, writes nothing)
//   nothing granted    → viewer
//   top tier is L1     → viewer  (view-only everywhere they have anything)
//   top tier is L2     → qc if that is Quality's alone, else operator
//   top tier is L3+    → qc if Quality is the only place they can write,
//                        else manager
//
// `qc` and `operator` are genuinely narrower than `manager`, so preferring
// them is not cosmetic — a Quality lead derived as `qc` cannot write Sales
// or Purchase records, where `manager` could.
export function roleForAccess(input: {
  fullAccess: boolean;
  auditor: boolean;
  departments: Record<string, AccessTierKey>;
}): string {
  if (input.fullAccess) return 'admin';
  if (input.auditor) return 'viewer';

  const order = ACCESS_TIER_KEYS as readonly string[];
  const entries = Object.entries(input.departments).filter(([, t]) => isAccessTierKey(t));
  if (entries.length === 0) return 'viewer';

  const rank = (t: string): number => order.indexOf(t);
  const top = entries.reduce((best, e) => (rank(e[1]) > rank(best[1]) ? e : best));
  const topTier = top[1];

  if (topTier === 'L1') return 'viewer';

  // Departments where this person can actually write (L2 and above).
  const writeDepts = entries.filter(([, t]) => rank(t) >= rank('L2')).map(([d]) => d);
  const qcOnly = writeDepts.length > 0 && writeDepts.every((d) => d === 'qc');
  if (qcOnly) return 'qc';

  if (topTier === 'L2') return 'operator';
  return 'manager';
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
