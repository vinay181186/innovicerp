// ADR-310 — the Customer Material Master's shared Export (copies the JWSO pilot).
//
// One sheet "Customer Material Master": the list's own columns as the user
// sees them. Every cell already shows plain words, so no exportValue is
// needed. No money on this master.

import type { ListPartyMaterialsQuery, PartyMaterialListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPartyMaterialsPage } from '../api';

export interface PartyMaterialsExportArgs {
  columns: DataTableColumn<PartyMaterialListItem>[];
  tableKey: string;
  defaultHidden: string[];
  search: string | undefined;
  sfParam: string | undefined;
}

export function partyMaterialsExportSpec(
  a: PartyMaterialsExportArgs,
): ListExportSpec<PartyMaterialListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListPartyMaterialsQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Customer Material Master',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchPartyMaterialsPage({ ...base, limit, offset }),
  };
}
