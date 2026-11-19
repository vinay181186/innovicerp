// ADR-310 — Tool Issue Register's shared Export (copies the JWSO Master pilot).
// One sheet: a tool issue is one item, and the API has no lines endpoint.

import type { ListToolIssuesQuery, ToolIssueListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchToolIssuesPage } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface ToolIssueExportArgs {
  columns: DataTableColumn<ToolIssueListItem>[];
  defaultHidden: string[];
  tableKey: string;
  filter: ListToolIssuesQuery['filter'];
  /** The Tool Issue Status word on screen; undefined for "all". */
  filterWord: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function toolIssueExportSpec(a: ToolIssueExportArgs): ListExportSpec<ToolIssueListItem> {
  const values: Record<string, (t: ToolIssueListItem) => string | number | null> = {
    // The cell stacks the item name under the code.
    item_code: (t) => t.itemCode ?? null,
    // The cell adds "n write-off pending" under the number.
    still_out: (t) => r3(t.stillOutQty),
  };
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.filterWord ? `Tool Issue Status ${a.filterWord}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Tool Issue Register',
    tableKey: a.tableKey,
    columns: a.columns.map((c) => {
      const fn = c.id ? values[c.id] : undefined;
      return fn ? { ...c, exportValue: fn } : c;
    }),
    defaultHidden: a.defaultHidden,
    rowKey: (t) => t.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchToolIssuesPage({ filter: a.filter, search: a.search, sf: a.sfParam, limit, offset }),
  };
}
