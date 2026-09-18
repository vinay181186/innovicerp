// Global Search — "search anything" from the box in the common top header.
//
// One endpoint (`GET /global-search?q=…`) looks across every document and
// master kind below, matching the document number, party, line items (item
// code / part name / drawing no), linked document refs, remarks, vehicle,
// invoice/DC refs, status words … and returns rows for the full-screen Search
// page: Date | Type | Doc No. | Party | Particulars (one LINE per linked
// document / item — never joined into one string) | Qty | Status.
// Each row carries the uuid and the web decides where it opens: a detail
// page where one exists, otherwise the host list/register filtered to the
// code (`?tab=&search=`).
//
// Permissions: every kind is tied to the SAME Access Control gate that hides
// its page — a form key (`effectiveFormPerms(eff, formKey).view`) or, for the
// Tasks section which has no form keys, the department (`hasDeptAccess`).
// The API loads the caller's access once and skips a kind entirely when it
// is not viewable — no row, no count, no metadata leaves the server for a
// hidden page. Admins (`users.role = 'admin'`) see everything, like the sidebar.
//
// Money never appears in a row (price is tier-gated separately).

import { z } from 'zod';
import type { AccessDeptKey, AccessFormKey } from '../enums/access-control';

export const GLOBAL_SEARCH_KINDS = [
  // documents with their own detail page
  'sales-order',
  'job-work-order',
  'purchase-request',
  'purchase-order',
  'grn',
  'delivery-challan',
  'job-card',
  'nc',
  'invoice',
  'plan',
  'bom-master',
  'route-card',
  'design-project',
  'jw-dc-outward',
  // masters with a detail page
  'client',
  'vendor',
  'item',
  // registers whose rows open on their host list, filtered to the code
  'customer-dispatch',
  'jw-invoice',
  'jw-return',
  'capa',
  'store-issue',
  'tool-issue',
  'party-grn',
  'party-material-issue',
  'jw-dc-inward',
  'task',
  'design-tracker',
] as const;
export type GlobalSearchKind = (typeof GLOBAL_SEARCH_KINDS)[number];
export const globalSearchKindSchema = z.enum(GLOBAL_SEARCH_KINDS);

export type GlobalSearchGate =
  | { formKey: AccessFormKey; dept?: undefined }
  /** EVERY listed key must be viewable — for a tab whose own key sits inside a host page
   *  that hides on a different key (CAPA inside NC Register, Tool Issues inside Issue Register). */
  | { formKeys: readonly AccessFormKey[]; dept?: undefined }
  | { formKey?: undefined; dept: AccessDeptKey };

export interface GlobalSearchKindMeta {
  /** Short label shown in the "Type" column and the count strip. */
  label: string;
  /** Access Control gate: the form key(s) whose `view` hides the page, or the department for
   *  sections without form keys. */
  gate: GlobalSearchGate;
}

// Labels are the sidebar's own names for these pages, shortened for a column.
export const GLOBAL_SEARCH_KIND_META: Record<GlobalSearchKind, GlobalSearchKindMeta> = {
  'sales-order': { label: 'Sales Order', gate: { formKey: 'so_create' } },
  'job-work-order': { label: 'JWSO', gate: { formKey: 'jw_create' } },
  'purchase-request': { label: 'Purchase Request', gate: { formKey: 'pr_create' } },
  'purchase-order': { label: 'Purchase Order', gate: { formKey: 'po_create' } },
  grn: { label: 'GRN', gate: { formKey: 'grn_create' } },
  'delivery-challan': { label: 'OSP DC', gate: { formKey: 'ospdc_create' } },
  'job-card': { label: 'Job Card', gate: { formKey: 'jc_create' } },
  nc: { label: 'NC', gate: { formKey: 'nc_dispose' } },
  invoice: { label: 'Invoice', gate: { formKey: 'invoice_create' } },
  plan: { label: 'Plan', gate: { formKey: 'plan_create' } },
  'bom-master': { label: 'BOM', gate: { formKey: 'bom_create' } },
  'route-card': { label: 'Route Card', gate: { formKey: 'routecard_create' } },
  'design-project': { label: 'Design Project', gate: { formKey: 'dsnproj_create' } },
  'jw-dc-outward': { label: 'JW DC Out', gate: { formKey: 'ospdc_create' } },
  client: { label: 'Client', gate: { formKey: 'client_create' } },
  vendor: { label: 'Vendor', gate: { formKey: 'vendor_create' } },
  item: { label: 'Item', gate: { formKey: 'item_create' } },
  'customer-dispatch': { label: 'Dispatch', gate: { formKey: 'dispatch_create' } },
  'jw-invoice': { label: 'JW Invoice', gate: { formKey: 'invoice_create' } },
  'jw-return': { label: 'JW Return', gate: { formKey: 'dispatch_create' } },
  capa: { label: 'CAPA', gate: { formKeys: ['nc_dispose', 'capa_create'] } },
  'store-issue': { label: 'Store Issue', gate: { formKey: 'issue_create' } },
  'tool-issue': { label: 'Tool Issue', gate: { formKeys: ['issue_create', 'toolissue_create'] } },
  'party-grn': { label: 'Party GRN', gate: { formKey: 'party_create' } },
  'party-material-issue': { label: 'Party Issue', gate: { formKey: 'party_create' } },
  'jw-dc-inward': { label: 'JW DC In', gate: { formKey: 'ospdc_create' } },
  task: { label: 'Task', gate: { dept: 'tasks' } },
  'design-tracker': { label: 'Design Tracker', gate: { formKey: 'design_create' } },
};

// ── Query ──────────────────────────────────────────────────────────────────
export const GLOBAL_SEARCH_MIN_CHARS = 2;
export const GLOBAL_SEARCH_MAX_CHARS = 100;
export const GLOBAL_SEARCH_DEFAULT_LIMIT = 100;
export const GLOBAL_SEARCH_MAX_LIMIT = 200;

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(GLOBAL_SEARCH_MIN_CHARS).max(GLOBAL_SEARCH_MAX_CHARS),
  /** Restrict to one kind (the count strip's click-to-filter). Omit for all. */
  kind: globalSearchKindSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(GLOBAL_SEARCH_MAX_LIMIT)
    .default(GLOBAL_SEARCH_DEFAULT_LIMIT),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

// ── Result row ─────────────────────────────────────────────────────────────
export const globalSearchResultSchema = z.object({
  kind: globalSearchKindSchema,
  /** Row uuid — the `$id` of the detail route, or the row to reveal on the host list. */
  id: z.string().uuid(),
  /** Document number / master code as stored (IN-SO-00012, IN-MPO-00003/R1, DSP-0004, ITM-0007). */
  docNo: z.string(),
  /** Document date as YYYY-MM-DD; null when the kind has no business date. */
  date: z.string().nullable(),
  /** Client / vendor / person the document is for; null for masters and internal docs. */
  party: z.string().nullable(),
  /** Particulars, ONE ENTRY PER LINE: linked document refs first ("PO IN-MPO-00002/R1",
   *  "DC 4521"), then item / part / subject lines. The web renders each on its own line. */
  lines: z.array(z.string()),
  /** Document-level quantity as a plain number string ("45", "12.5"); null when none. */
  qty: z.string().nullable(),
  /** Raw status value when the kind has one, for a badge; null otherwise. */
  status: z.string().nullable(),
  /** The text that matched, when it is not already visible in the row (e.g. a line item's
   *  drawing no or a remark); null when the doc no / party / a shown line matched. */
  hit: z.string().nullable(),
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchResponseSchema = z.object({
  items: z.array(globalSearchResultSchema),
  /** True when more rows matched than `limit` allowed — the page says "narrow it down". */
  truncated: z.boolean(),
  /** Matches per kind across the WHOLE result (not just the page), for the count strip.
   *  Only kinds the caller may view appear; a hidden kind is absent, never 0. */
  counts: z.record(globalSearchKindSchema, z.number().int().nonnegative()),
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;
