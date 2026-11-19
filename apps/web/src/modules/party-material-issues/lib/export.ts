// ADR-310 — Customer Material Issue's shared Export (copies the JWSO pilot).
// One sheet: an issue is one material, and the API has no lines endpoint.

import type { PartyMaterialIssueListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPartyMaterialIssuesPage } from '../api';

export interface PmiExportArgs {
  columns: DataTableColumn<PartyMaterialIssueListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function pmiExportSpec(a: PmiExportArgs): ListExportSpec<PartyMaterialIssueListItem> {
  const values: Record<string, (it: PartyMaterialIssueListItem) => string | number | null> = {
    // The cell shows "—" for nothing returned; Excel gets the number.
    returned_to_store_qty: (it) => it.returnedToStoreQty,
  };
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Customer Material Issue',
    tableKey: a.tableKey,
    columns: a.columns.map((c) => {
      const fn = c.id ? values[c.id] : undefined;
      return fn ? { ...c, exportValue: fn } : c;
    }),
    rowKey: (it) => it.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchPartyMaterialIssuesPage({
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        includeCancelled: true,
        limit,
        offset,
      }),
  };
}
