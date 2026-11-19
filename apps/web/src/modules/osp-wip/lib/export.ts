// ADR-310 — the At-Vendor Register's shared Export (copies the JWSO pilot).
//
// One sheet "At-Vendor Register": the register's own columns as the user sees
// them, every op matching the search, the Bucket and the column sort / filter.
// No money on this register, so nothing is held back for a no-price user.

import type { ListOspWipQuery, OspWipRow } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchOspWipPage } from '../api';

export interface OspAtVendorExportArgs {
  columns: DataTableColumn<OspWipRow>[];
  tableKey: string;
  filter: ListOspWipQuery['filter'];
  filterLabel: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function ospAtVendorExportSpec(a: OspAtVendorExportArgs): ListExportSpec<OspWipRow> {
  const words = [
    a.filterLabel ? `bucket ${a.filterLabel}` : null,
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'At-Vendor Register',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.jcOpId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchOspWipPage({
        filter: a.filter,
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        limit,
        offset,
      });
      return { items: res.rows, total: res.total };
    },
  };
}
