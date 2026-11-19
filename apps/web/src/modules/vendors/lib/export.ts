// ADR-310 — the Vendor Master's shared Export (copies the JWSO pilot).
//
// One sheet "Vendor Master": the list's own columns as the user sees them.
// Rating and Vendor Status are StatusBadges, so both get plain words. No
// money column (Payment Terms is days). The API answers `vendors`.

import type { ListVendorsQuery, Vendor } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchVendorsPage } from '../api';

export function withVendorExportValues(
  columns: DataTableColumn<Vendor>[],
): DataTableColumn<Vendor>[] {
  return columns.map((c) => {
    if (c.id === 'rating') return { ...c, exportValue: (v) => v.rating };
    if (c.id === 'is_active')
      return { ...c, exportValue: (v) => (v.isActive ? 'Active' : 'Inactive') };
    return c;
  });
}

export interface VendorExportArgs {
  columns: DataTableColumn<Vendor>[];
  tableKey: string;
  search: string | undefined;
  isActive: boolean | undefined;
  sfParam: string | undefined;
}

export function vendorExportSpec(a: VendorExportArgs): ListExportSpec<Vendor> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.isActive === undefined ? null : a.isActive ? 'Active only' : 'Inactive only',
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListVendorsQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.isActive === undefined ? {} : { isActive: a.isActive }),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Vendor Master',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const r = await fetchVendorsPage({ ...base, limit, offset });
      return { items: r.vendors, total: r.total };
    },
  };
}
