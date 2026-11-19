// ADR-310 — the Customer Material Stock Ledger's shared Export (copies the
// JWSO pilot).
//
// One sheet: the ledger's own columns as the user sees them, every movement
// matching the search. The party store is zero-value, so there is no money.

import type { PartyStockLedgerListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPartyStockLedgerPage } from '../api';

export interface PartyStockLedgerExportArgs {
  columns: DataTableColumn<PartyStockLedgerListItem>[];
  tableKey: string;
  search: string | undefined;
}

export function partyStockLedgerExportSpec(
  a: PartyStockLedgerExportArgs,
): ListExportSpec<PartyStockLedgerListItem> {
  return {
    fileName: 'Customer Material Stock Ledger',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: a.search ? `search "${a.search}"` : undefined,
    fetchPage: (limit, offset) =>
      fetchPartyStockLedgerPage({ ...(a.search ? { search: a.search } : {}), limit, offset }),
  };
}
