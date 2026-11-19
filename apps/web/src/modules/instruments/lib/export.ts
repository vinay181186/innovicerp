// ADR-310 — the Instrument Register's shared Export (copies the JWSO pilot).
//
// One sheet "Instrument Register": the list's own columns as the user sees
// them. Instrument Status and Held By draw two chips side by side, so they
// export as one line of words with a separator.

import {
  INSTRUMENT_STATUS_LABELS,
  type InstrumentListItem,
  type ListInstrumentsQuery,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchInstrumentsPage } from '../api';

function withInstrumentExportValues(
  columns: DataTableColumn<InstrumentListItem>[],
): DataTableColumn<InstrumentListItem>[] {
  return columns.map((c) => {
    if (c.id === 'status') {
      return {
        ...c,
        exportValue: (r: InstrumentListItem) =>
          INSTRUMENT_STATUS_LABELS[r.status] + (r.writeoffPending ? ' · Write-off pending' : ''),
      };
    }
    if (c.id === 'held_by') {
      return {
        ...c,
        exportValue: (r: InstrumentListItem) =>
          [r.heldBy, r.toolIssueCode].filter((w) => Boolean(w)).join(' · ') || null,
      };
    }
    return c;
  });
}

const DUE_WORDS = { week: 'Calibration due this week', overdue: 'Calibration overdue' } as const;

export interface InstrumentExportArgs {
  columns: DataTableColumn<InstrumentListItem>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListInstrumentsQuery;
}

export function instrumentExportSpec(a: InstrumentExportArgs): ListExportSpec<InstrumentListItem> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.status ? `Instrument Status ${INSTRUMENT_STATUS_LABELS[q.status]}` : null,
    q.due ? DUE_WORDS[q.due] : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Instrument Register',
    tableKey: a.tableKey,
    columns: withInstrumentExportValues(a.columns),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchInstrumentsPage({ ...q, limit, offset }),
  };
}
