// ADR-310 — every Excel export writes ONE Activity Log row (action EXPORT).
//
// Two writers, one row shape:
//   - the browser posts POST /activity-log/export after it built a list file;
//   - the server-built Reports downloads (reports / saved-reports export.xlsx)
//     call logExportSafely() after the workbook is built.
// The log never blocks or fails a download (owner D2): the server-side call is
// caught and only warned about on the request logger.

import { ActivityAction, type ListExportLogInput } from '@innovic/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthContext } from '../../db/with-user-context';
import { appendActivityLog } from './service';

/** Stored `activity_log.entity` for an export. Not a document type, so it has
 *  no page to open; spelled in words like the other non-document entities
 *  ('Day Log', 'Store Inventory') because the Entity column shows it as-is. */
export const LIST_EXPORT_ENTITY = 'List Export';

/** The one-line Detail: `JWSO Master — 120 rows / 340 lines (first 120 of 900) · search "L&T"`. */
export function listExportDetail(input: ListExportLogInput): string {
  const lines = input.lineCount != null ? ` / ${input.lineCount} lines` : '';
  const capped = input.capped
    ? ` (first ${input.rowCount} of ${input.totalCount ?? input.rowCount})`
    : '';
  const filters = input.filterSummary ? ` · ${input.filterSummary}` : '';
  return `${input.listTitle} — ${input.rowCount} rows${lines}${capped}${filters}`;
}

/** Write the EXPORT row. Throws on a DB failure — the caller decides. */
export async function logListExport(input: ListExportLogInput, user: AuthContext): Promise<void> {
  await appendActivityLog(
    {
      action: ActivityAction.Export,
      entity: LIST_EXPORT_ENTITY,
      detail: listExportDetail(input),
      qty: input.rowCount,
    },
    user,
  );
}

/** Report filters ({ key: value }) as plain words for the Detail line. */
export function reportFilterSummary(
  filters: Record<string, string> | undefined,
): string | undefined {
  if (!filters) return undefined;
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k} ${v}`);
  if (parts.length === 0) return undefined;
  const text = parts.join(' · ');
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

/** Server-built download: log, never throw. Not awaited by the caller so the
 *  file is sent without waiting on the log write. */
export async function logExportSafely(
  input: {
    listTitle: string;
    rowCount: number;
    filterSummary?: string | undefined;
  },
  user: AuthContext,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const title = input.listTitle.trim().slice(0, 120) || 'Report';
    await logListExport(
      {
        listTitle: title,
        rowCount: input.rowCount,
        capped: false,
        ...(input.filterSummary ? { filterSummary: input.filterSummary } : {}),
      },
      user,
    );
  } catch (err) {
    log.warn({ err, listTitle: input.listTitle }, 'export activity-log write failed');
  }
}
