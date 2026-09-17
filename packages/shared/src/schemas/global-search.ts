// Global Search — the header search box on every page.
//
// One endpoint (`GET /global-search?q=…`) looks across every document type
// that has its own detail screen and returns rows shaped for the
// Date | Particulars | Type | Doc No. result list. Each row carries the
// document's uuid so the web can open the existing detail page.
//
// Permissions: every kind is tied to the SAME Access Control form key that
// gates its list/detail page. The API loads the caller's effective access once
// and skips a kind entirely when `effectiveFormPerms(eff, formKey).view` is
// false — no row, no count, no metadata leaves the server for a hidden page.
// Admins (`users.role = 'admin'`) see everything, matching the sidebar.
//
// Kinds deliberately EXCLUDED (no deep-linkable detail screen, so a result
// could not open anything): Customer Dispatch, JW Invoice, JW Return Challan,
// CAPA, Store/Tool Issue, Party GRN / Party Material Issue, JW DC Inward,
// Tasks, Design Tracker. Add a kind here only once its detail route exists.

import { z } from 'zod';
import type { AccessFormKey } from '../enums/access-control';

export const GLOBAL_SEARCH_KINDS = [
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
  'client',
  'vendor',
  'item',
] as const;
export type GlobalSearchKind = (typeof GLOBAL_SEARCH_KINDS)[number];
export const globalSearchKindSchema = z.enum(GLOBAL_SEARCH_KINDS);

export interface GlobalSearchKindMeta {
  /** Short label shown in the "Type" column. */
  label: string;
  /** Access Control form key whose `view` permission gates this kind. */
  formKey: AccessFormKey;
}

// Labels are the sidebar's own names for these pages, shortened for a column.
export const GLOBAL_SEARCH_KIND_META: Record<GlobalSearchKind, GlobalSearchKindMeta> = {
  'sales-order': { label: 'Sales Order', formKey: 'so_create' },
  'job-work-order': { label: 'JWSO', formKey: 'jw_create' },
  'purchase-request': { label: 'Purchase Request', formKey: 'pr_create' },
  'purchase-order': { label: 'Purchase Order', formKey: 'po_create' },
  grn: { label: 'GRN', formKey: 'grn_create' },
  'delivery-challan': { label: 'OSP DC', formKey: 'ospdc_create' },
  'job-card': { label: 'Job Card', formKey: 'jc_create' },
  nc: { label: 'NC', formKey: 'nc_dispose' },
  invoice: { label: 'Invoice', formKey: 'invoice_create' },
  plan: { label: 'Plan', formKey: 'plan_create' },
  'bom-master': { label: 'BOM', formKey: 'bom_create' },
  'route-card': { label: 'Route Card', formKey: 'routecard_create' },
  'design-project': { label: 'Design Project', formKey: 'dsnproj_create' },
  client: { label: 'Client', formKey: 'client_create' },
  vendor: { label: 'Vendor', formKey: 'vendor_create' },
  item: { label: 'Item', formKey: 'item_create' },
};

// ── Query ──────────────────────────────────────────────────────────────────
export const GLOBAL_SEARCH_MIN_CHARS = 2;
export const GLOBAL_SEARCH_MAX_CHARS = 100;
export const GLOBAL_SEARCH_DEFAULT_LIMIT = 30;
export const GLOBAL_SEARCH_MAX_LIMIT = 50;

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(GLOBAL_SEARCH_MIN_CHARS).max(GLOBAL_SEARCH_MAX_CHARS),
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
  /** Row uuid — the `$id` param of the kind's detail route. */
  id: z.string().uuid(),
  /** Document number / master code as stored (e.g. IN-SO-00012, IN-MPO-00003/R1, ITM-0007). */
  docNo: z.string(),
  /** Document date as YYYY-MM-DD; null when the kind has no business date. */
  date: z.string().nullable(),
  /** Short human line: party name, item, PO ref … (never money). */
  particulars: z.string(),
  /** Raw status value when the kind has one, for a badge; null otherwise. */
  status: z.string().nullable(),
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchResponseSchema = z.object({
  items: z.array(globalSearchResultSchema),
  /** True when more rows matched than `limit` allowed — the UI says "refine your search". */
  truncated: z.boolean(),
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;
