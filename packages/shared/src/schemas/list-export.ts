// ADR-310 — one shared "Export to Excel" on every list.
//
// The browser builds the file (same rows, filters and sort as the screen;
// the columns the user sees). Every export — the shared one, the 7 lists with
// their own export and the Reports downloads — writes ONE Activity Log row
// (action EXPORT) so the owner can see who took which list. The log never
// blocks the download: the file is made first, the log line is sent after.

import { z } from 'zod';

/** POST /activity-log/export — sent by the browser after a file is made. */
export const listExportLogInputSchema = z.object({
  /** The list's own title as on screen, e.g. "JWSO Master". */
  listTitle: z.string().trim().min(1).max(120),
  /** Rows on the first (main) sheet. */
  rowCount: z.number().int().nonnegative(),
  /** Rows on the second "Lines" sheet (document lists only). */
  lineCount: z.number().int().nonnegative().optional(),
  /** True when the 10,000-row limit cut the export short. */
  capped: z.boolean().default(false),
  /** Rows matching the filter before the cut (only when capped). */
  totalCount: z.number().int().nonnegative().optional(),
  /** Plain words for the search / filters / sort used, e.g. `search "L&T" · Status Open`. */
  filterSummary: z.string().trim().max(500).optional(),
});
export type ListExportLogInput = z.infer<typeof listExportLogInputSchema>;

/** The 10,000-row ceiling of every export (lines included). */
export const LIST_EXPORT_CAP = 10_000;
