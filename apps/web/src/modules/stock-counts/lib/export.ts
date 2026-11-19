// ADR-310 — Stock Count's shared Export (copies the JWSO Master pilot).
// One sheet: the API has no per-line list endpoint for stock counts.

import type { ListStockCountsQuery, StockCount } from '@innovic/shared';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchStockCountsPage } from '../api';

export interface StockCountExportArgs {
  columns: DataTableColumn<StockCount>[];
  tableKey: string;
  search: string | undefined;
  status: ListStockCountsQuery['status'];
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function stockCountExportSpec(a: StockCountExportArgs): ListExportSpec<StockCount> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `Count Status ${statusText(String(a.status))}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Stock Count',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (c) => c.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchStockCountsPage({ search: a.search, status: a.status, sf: a.sfParam, limit, offset }),
  };
}
