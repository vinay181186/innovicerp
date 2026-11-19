// ADR-310 — the SO Costing list's shared Export (copies the JWSO pilot).
//
// One sheet "SO Costing": the list's own columns as the user sees them, every
// SO matching the search and column sort / filter. Money: the server says
// whether this user may see prices (priceVisible); when not, every value /
// cost column is left out of the file — Total Cost included, which is not
// marked `money` on the column itself.

import type { SoCostingRow } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchSoCostingPage } from '../api';

export const SO_COSTING_MONEY_COLUMNS = [
  'subtotal',
  'material',
  'outsource',
  'machine_time',
  'total_cost',
];

export interface SoCostingExportArgs {
  columns: DataTableColumn<SoCostingRow>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  priceHidden: boolean;
}

export function soCostingExportSpec(a: SoCostingExportArgs): ListExportSpec<SoCostingRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'SO Costing',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.soId,
    hideMoney: a.priceHidden,
    moneyColumns: SO_COSTING_MONEY_COLUMNS,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchSoCostingPage({ search: a.search, sf: a.sfParam, limit, offset });
      return { items: res.rows, total: res.total };
    },
  };
}
