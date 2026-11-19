// ADR-310 — the NC Register list's shared Export (copies the JWSO pilot).
//
// One sheet "NC Register": the list's own columns as the user sees them. The
// NC Status and Disposition chips are components, so they get their plain
// words (Draft for a pending edit, as the chip shows). There is no Lines
// sheet: an NC has no lines and the API no per-line list.

import {
  NC_DISPOSITION_LABELS,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  type ListNcRegisterQuery,
  type NcRegisterListItem,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchNcRegisterPage } from '../api';
import { NC_LIST_HIDDEN_COLUMNS } from '../components/nc-list-columns';

export function withNcExportValues(
  columns: DataTableColumn<NcRegisterListItem>[],
  draftIds?: Set<string>,
): DataTableColumn<NcRegisterListItem>[] {
  const values: Record<string, (nc: NcRegisterListItem) => string | number | null> = {
    nc_status: (nc) => (draftIds?.has(nc.id) ? 'Draft' : NC_STATUS_LABELS[nc.status]),
    disposition: (nc) => (nc.disposition ? NC_DISPOSITION_LABELS[nc.disposition] : null),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface NcExportArgs {
  columns: DataTableColumn<NcRegisterListItem>[];
  tableKey: string;
  /** The list's own query (search, NC status, reason, sf). */
  query: ListNcRegisterQuery;
}

export function ncExportSpec(a: NcExportArgs): ListExportSpec<NcRegisterListItem> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.status ? `NC Status ${NC_STATUS_LABELS[q.status]}` : null,
    q.reasonCategory ? `Reason ${NC_REASON_CATEGORY_LABELS[q.reasonCategory]}` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'NC Register',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: NC_LIST_HIDDEN_COLUMNS,
    rowKey: (nc) => nc.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchNcRegisterPage({ ...q, limit, offset }),
  };
}
