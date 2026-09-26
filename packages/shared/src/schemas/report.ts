// Reports engine shared shapes (T-041a).
//
// Each report is server-defined (TS function backed by hand-written SQL).
// User-customizable ad-hoc builder lands in T-041b layered on this engine.
//
// Two endpoints:
//   GET /reports               → list of available reports (slug + title + filter spec)
//   GET /reports/:slug?...     → run a report and return rows + columns + generatedAt
//
// Filter spec is small + intentional — date ranges + a few enum picks. A full
// query DSL is out of scope for the starter; reports that need richer params
// can ship their own filter shape via the /reports list response.

import { z } from 'zod';

export const reportColumnTypeSchema = z.enum(['text', 'number', 'date', 'datetime']);
export type ReportColumnType = z.infer<typeof reportColumnTypeSchema>;

export const reportColumnSchema = z.object({
  /** SQL column name in the row object (snake_case). Use as the React key + accessor. */
  key: z.string(),
  /** Display label rendered in the column header. */
  label: z.string(),
  /** Type drives the cell renderer (text left-aligned; number/date/datetime mono-right). */
  type: reportColumnTypeSchema,
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

export const reportFilterFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Date renders as a date input; enum as a Select; text as a free-text Input
   *  (substring match — case-insensitive against the report's chosen columns). */
  kind: z.enum(['date', 'enum', 'text']),
  /** Required only for kind='enum'. */
  options: z.array(z.string()).optional(),
  /** Default value pre-filled into the form. */
  defaultValue: z.string().optional(),
  /** Optional placeholder for kind='text'. */
  placeholder: z.string().optional(),
});
export type ReportFilterField = z.infer<typeof reportFilterFieldSchema>;

/** Makes one column a link to the document the row is about (ADR-190). The
 *  row carries that document's id under `idKey` — a key that is NOT a column,
 *  so the table and the Excel export never show it — and the web opens
 *  `route` with `$id` replaced by that id. Declared only where the id comes
 *  free with the query. */
export const reportRowLinkSchema = z.object({
  /** The column whose cell becomes the link, e.g. `so_code`. */
  column: z.string(),
  /** The page, TanStack-style, e.g. `/sales-orders/$id`. */
  route: z.string(),
  /** The row key holding the id, e.g. `so_id`. */
  idKey: z.string(),
});
export type ReportRowLink = z.infer<typeof reportRowLinkSchema>;

export const reportDefinitionSchema = z.object({
  /** Stable slug used in the URL path (`/reports/:slug`) and as a React key. */
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  /** Display group for the list page (e.g. "Operations" / "Procurement" / "Quality"). */
  group: z.string(),
  /** Access Control department that owns the report (an ACCESS_DEPTS key, e.g.
   *  'sales' / 'store'). The catalogue shows the report only to users with
   *  access to that department. Omitted = shown to every Reports user. */
  dept: z.string().optional(),
  /** True when any column is money (rate / value / amount). The catalogue then
   *  also needs the user's tier in `dept` to see prices (tierSeesPrice). */
  showsMoney: z.boolean().optional(),
  /** Filter form rendered on the run page. Empty array = no filters (run-immediately). */
  filters: z.array(reportFilterFieldSchema),
  /** Output columns in display order. */
  columns: z.array(reportColumnSchema),
  rowLink: reportRowLinkSchema.optional(),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const listReportsResponseSchema = z.object({
  reports: z.array(reportDefinitionSchema),
});
export type ListReportsResponse = z.infer<typeof listReportsResponseSchema>;

/** Each row is a JSON object with ReportColumn keys → primitive values.
 *  Values are typed loosely (string | number | null) since SQL types vary
 *  per report; the column.type drives the renderer. */
export const reportRowSchema = z.record(z.union([z.string(), z.number(), z.null()]));
export type ReportRow = z.infer<typeof reportRowSchema>;

export const runReportResponseSchema = z.object({
  slug: z.string(),
  title: z.string(),
  columns: z.array(reportColumnSchema),
  rows: z.array(reportRowSchema),
  /** Counts the rows in the result set; same as rows.length but explicit. */
  rowCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
  /** Echoes the filter values that produced this result, for header display. */
  filters: z.record(z.string()),
  /** The definition's rowLink, echoed so the run page needs no second read. */
  rowLink: reportRowLinkSchema.optional(),
});
export type RunReportResponse = z.infer<typeof runReportResponseSchema>;

/** Generic filter input for /reports/:slug?... — values are coerced strings.
 *  Per-report validation happens server-side before query execution. */
export const runReportQuerySchema = z.record(z.string()).default({});
export type RunReportQuery = z.infer<typeof runReportQuerySchema>;
