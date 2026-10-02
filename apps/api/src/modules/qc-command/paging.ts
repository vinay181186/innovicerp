// QC Command — server-side order + paging of the board's tables (ADR-201).
//
// getQcCommand builds every table over ALL rows (so the stats strip, FPY %,
// Pareto totals and the per-table counts are whole-set figures); this file
// fixes each table's order with a unique tie-break (so paging never skips or
// repeats a row) and cuts it to the page asked for. No `limit` = every row.

import type { QcCommandQueueRow, QcCommandQuery, QcQueueSort } from '@innovic/shared';

/** Queue order. Ties fall back to JC No. → op seq → op id (unique). */
export function sortQueue(rows: QcCommandQueueRow[], sort: QcQueueSort): QcCommandQueueRow[] {
  const tie = (a: QcCommandQueueRow, b: QcCommandQueueRow): number =>
    a.jcCode.localeCompare(b.jcCode) || a.opSeq - b.opSeq || a.jcOpId.localeCompare(b.jcOpId);
  return [...rows].sort((a, b) => {
    if (sort === 'age') return b.ageDays - a.ageDays || tie(a, b);
    if (sort === 'due') {
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      return tie(a, b);
    }
    return (a.customer ?? '').localeCompare(b.customer ?? '') || tie(a, b);
  });
}

/** One page of a fully-built, already-ordered table. */
export function pageOf<T>(rows: T[], limit: number | undefined, offset: number): T[] {
  return limit === undefined ? rows : rows.slice(offset, offset + limit);
}

/** The no-paging default (every row, oldest first) — callers that pass no query. */
export const QC_COMMAND_ALL: QcCommandQuery = {
  queueSort: 'age',
  queueOffset: 0,
  fpyOpOffset: 0,
  fpyInspOffset: 0,
  paretoOffset: 0,
  inspectorOffset: 0,
  reworkOffset: 0,
};
