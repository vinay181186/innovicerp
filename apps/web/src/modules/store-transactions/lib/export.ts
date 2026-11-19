// ADR-310 — the Stock Ledger's shared Export (copies the JWSO pilot).
//
// One sheet "Stock Ledger": the ledger's own columns as the user sees them,
// every movement matching the search, Type, Source and column sort / filter.
// The Type cell is a badge component, so it gets its plain word. The ledger
// shows no rate or value column, so there is no money to hold back.

import type { ListStoreTransactionsQuery, StoreTransactionListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchStoreTransactionsPage } from '../api';
import { STORE_TXN_SOURCE_LABELS, STORE_TXN_TYPE_LABELS } from './txn-labels';

export function withStockLedgerExportValues(
  columns: DataTableColumn<StoreTransactionListItem>[],
): DataTableColumn<StoreTransactionListItem>[] {
  return columns.map((c) =>
    c.id === 'txnType'
      ? { ...c, exportValue: (r: StoreTransactionListItem) => STORE_TXN_TYPE_LABELS[r.txnType] }
      : c,
  );
}

export interface StockLedgerExportArgs {
  columns: DataTableColumn<StoreTransactionListItem>[];
  tableKey: string;
  defaultHidden: string[];
  query: Omit<ListStoreTransactionsQuery, 'limit' | 'offset'>;
}

export function stockLedgerExportSpec(
  a: StockLedgerExportArgs,
): ListExportSpec<StoreTransactionListItem> {
  const q = a.query;
  const words = [
    q.txnType ? `type ${STORE_TXN_TYPE_LABELS[q.txnType]}` : null,
    q.sourceType ? `source ${STORE_TXN_SOURCE_LABELS[q.sourceType]}` : null,
    q.search ? `search "${q.search}"` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Stock Ledger',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchStoreTransactionsPage({ ...q, limit, offset }),
  };
}
