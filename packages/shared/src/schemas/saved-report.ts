// Saved (ad-hoc) reports — T-041b.
//
// Layered on the T-041a server-defined registry: the engine still runs SQL
// hand-written by us, but the *shape* of which columns/filters/group/sort
// are picked is composed by the user through a drag-and-drop builder. The
// spec is stored as JSONB in `saved_reports.spec`; the API validates it
// against a whitelisted source catalog (see SOURCE_DESCRIPTORS below) and
// translates it to safe parameterised SQL — values are bind vars, never
// interpolated.
//
// Mirrors the legacy "Excel Report Builder" (see legacy HTML L17434+).
//
// Endpoints (all under /saved-reports):
//   GET    /sources                → list source descriptors (catalog)
//   GET    /                       → list saved reports (own + shared)
//   POST   /                       → create
//   GET    /:id                    → fetch one
//   PUT    /:id                    → update
//   DELETE /:id                    → soft delete
//   GET    /:id/run                → run a saved report
//   POST   /preview                → run an ad-hoc spec without saving
//                                    (powers the builder live preview)

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';
import { reportColumnTypeSchema } from './report';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';

// ─── Filter / aggregation primitives ──────────────────────────────────────

export const filterOpSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'gt',
  'lt',
  'after',
  'before',
]);
export type FilterOp = z.infer<typeof filterOpSchema>;

export const aggFunctionSchema = z.enum(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);
export type AggFunction = z.infer<typeof aggFunctionSchema>;

export const adHocFilterSchema = z.object({
  field: z.string().min(1).max(64),
  op: filterOpSchema,
  /** Always a string — server coerces per field.type before binding. Empty
   *  values cause the filter to be skipped at run-time (matches legacy). */
  value: z.string().max(200).default(''),
});
export type AdHocFilter = z.infer<typeof adHocFilterSchema>;

export const adHocSortSchema = z.object({
  field: z.string().min(1).max(64),
  dir: z.enum(['asc', 'desc']),
});
export type AdHocSort = z.infer<typeof adHocSortSchema>;

export const adHocSpecSchema = z.object({
  sourceKey: z.string().min(1).max(64),
  columns: z.array(z.string().min(1).max(64)).min(1).max(20),
  filters: z.array(adHocFilterSchema).max(10).default([]),
  /** Single field for summary sheet (legacy). null = no grouping. */
  groupBy: z.string().min(1).max(64).nullable().default(null),
  /** Numeric field aggregated by sumFn when groupBy is set. */
  sumCol: z.string().min(1).max(64).nullable().default(null),
  sumFn: aggFunctionSchema.default('SUM'),
  sort: z.array(adHocSortSchema).max(3).default([]),
});
export type AdHocSpec = z.infer<typeof adHocSpecSchema>;

// ─── Source catalog (single source of truth, shared by API + Web) ────────

export const sourceFieldDescriptorSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: reportColumnTypeSchema,
  /** Whether this field can appear in the filter zone. Defaults to true. */
  filterable: z.boolean().default(true),
  /** Whether this field can be the groupBy. Defaults to true for text/date,
   *  false for floating numerics where grouping is rarely useful. */
  groupable: z.boolean().default(true),
});
export type SourceFieldDescriptor = z.infer<typeof sourceFieldDescriptorSchema>;

export const sourceDescriptorSchema = z.object({
  sourceKey: z.string(),
  label: z.string(),
  description: z.string().default(''),
  /** Display group in the source picker (Sales / Procurement / Production / Quality / Inventory). */
  group: z.string(),
  fields: z.array(sourceFieldDescriptorSchema),
});
export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;

export const listSourcesResponseSchema = z.object({
  sources: z.array(sourceDescriptorSchema),
});
export type ListSourcesResponse = z.infer<typeof listSourcesResponseSchema>;

// ─── Saved report record + CRUD inputs ────────────────────────────────────

export const savedReportSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  ownerId: z.string().uuid(),
  /** Email of the owner — surfaced in the list view so users can tell who
   *  owns shared reports. Nullable when owner record was hard-deleted (rare). */
  ownerEmail: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  sourceKey: z.string(),
  spec: adHocSpecSchema,
  /** When true, anyone in the company can read + run; only owner / admin /
   *  manager can edit or delete. When false, only the owner sees it. */
  isShared: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedReport = z.infer<typeof savedReportSchema>;

export const createSavedReportInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  sourceKey: z.string().min(1).max(64),
  spec: adHocSpecSchema,
  isShared: z.boolean().default(false),
});
export type CreateSavedReportInput = z.infer<typeof createSavedReportInputSchema>;

export const updateSavedReportInputSchema = z.object({
  /** §20.4 — the version this form loaded; a save over someone else's newer
   *  edit is refused 409 `edit_conflict` (ADR-225). */
  expectedUpdatedAt: expectedUpdatedAtSchema,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  sourceKey: z.string().min(1).max(64).optional(),
  spec: adHocSpecSchema.optional(),
  isShared: z.boolean().optional(),
});
export type UpdateSavedReportInput = z.infer<typeof updateSavedReportInputSchema>;

export const listSavedReportsResponseSchema = z.object({
  reports: z.array(savedReportSchema),
  /** Every report matching search + sf (before limit/offset) — ADR-201 paging. */
  total: z.number().int().nonnegative(),
});
export type ListSavedReportsResponse = z.infer<typeof listSavedReportsResponseSchema>;

// GET /saved-reports (ADR-201): one page, searched and Sort & Filtered on the
// server. No `limit` → every visible report, as before.
export const listSavedReportsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListSavedReportsQuery = z.input<typeof listSavedReportsQuerySchema>;

// ─── Run-time response (mirrors RunReportResponse but with extra hooks) ──

export const adHocRowSchema = z.record(z.union([z.string(), z.number(), z.null()]));
export type AdHocRow = z.infer<typeof adHocRowSchema>;

export const adHocColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: reportColumnTypeSchema,
});
export type AdHocColumn = z.infer<typeof adHocColumnSchema>;

export const adHocSummaryRowSchema = z.object({
  /** GroupBy value rendered as the row label. */
  group: z.string(),
  /** Number of rows in the group. */
  count: z.number().int().nonnegative(),
  /** Aggregated sumCol value when sumCol is set; null otherwise.
   *  Stringified for numeric precision (matches dashboard pattern). */
  aggregate: z.string().nullable(),
});
export type AdHocSummaryRow = z.infer<typeof adHocSummaryRowSchema>;

export const runAdHocResponseSchema = z.object({
  /** Slug-style id for the run (saved-report id, or 'preview' for unsaved). */
  id: z.string(),
  title: z.string(),
  sourceKey: z.string(),
  columns: z.array(adHocColumnSchema),
  rows: z.array(adHocRowSchema),
  rowCount: z.number().int().nonnegative(),
  /** Summary section when spec.groupBy is set. Empty array otherwise. */
  summary: z.array(adHocSummaryRowSchema),
  /** Aggregator function used for `summary.aggregate`. Echoes spec.sumFn. */
  summaryFunction: aggFunctionSchema.nullable(),
  /** Aggregated column key (null when no sumCol). Echoes spec.sumCol. */
  summaryColumn: z.string().nullable(),
  generatedAt: z.string(),
});
export type RunAdHocResponse = z.infer<typeof runAdHocResponseSchema>;
