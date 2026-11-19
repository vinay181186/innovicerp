// ADR-310 — the Job Cards list's shared Export (copies the JWSO pilot).
//
// One sheet "Job Cards": the list's own columns as the user sees them, with
// the Columns ▾ defaults (JC_LIST_HIDDEN_COLUMNS). Cells drawn as a bar, a
// chip or a symbol get a plain `exportValue`. There is no Lines sheet: a Job
// Card is one item, and the API has no per-operation list endpoint.

import type { JobCardListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { type JobCardsListArgs, fetchJobCardsPage } from '../api';
import { JC_LIST_HIDDEN_COLUMNS, isJcCancelled } from '../components/jc-list-columns';
import { JC_STATUS_LABEL } from '../components/jc-status-badge';

export function withJcExportValues(
  columns: DataTableColumn<JobCardListItem>[],
  draftIds?: Set<string>,
): DataTableColumn<JobCardListItem>[] {
  const values: Record<string, (jc: JobCardListItem) => string | number | null> = {
    // A picture — nothing to write.
    image: () => null,
    // Bar + "done / qty · pct%": the words only.
    progress: (jc) => {
      const done = jc.lastOpCompletedQty;
      const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
      return `${done} / ${jc.orderQty} · ${pct}%`;
    },
    // The chip shows Draft for a pending edit and Cancelled for a cancelled card.
    jc_status: (jc) =>
      isJcCancelled(jc)
        ? 'Cancelled'
        : draftIds?.has(jc.id)
          ? 'Draft'
          : JC_STATUS_LABEL[jc.computedStatus],
    // "▶3" on screen.
    running: (jc) => (jc.runningCount > 0 ? jc.runningCount : null),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface JcExportArgs {
  columns: DataTableColumn<JobCardListItem>[];
  tableKey: string;
  /** The list's own query (search, JC Status, Overdue, Machine, Operator, dates, sf). */
  query: JobCardsListArgs;
}

export function jcExportSpec(a: JcExportArgs): ListExportSpec<JobCardListItem> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.status ? `JC Status ${JC_STATUS_LABEL[q.status]}` : null,
    q.overdue ? 'Overdue' : null,
    q.machineId ? 'Machine filter' : null,
    q.operatorId ? 'Operator filter' : null,
    q.fromDate ? `from ${fmtDate(q.fromDate)}` : null,
    q.toDate ? `to ${fmtDate(q.toDate)}` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Job Cards',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: [...JC_LIST_HIDDEN_COLUMNS],
    rowKey: (jc) => jc.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchJobCardsPage({ ...q, limit, offset }),
  };
}
