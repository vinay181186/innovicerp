// Stock Ledger (read-only) — folded in as the "Stock Ledger" tab of Store /
// Inventory (formerly the standalone /store-transactions screen). Auto-recorded
// stock movements from GRN / Issues / Dispatch / OSP DC. Uses local component
// state for its filters (the standalone route drove them off the URL).
//
// ADR-199 (table standard 2026-10-01): renders on the shared FIT table
// (<DataTable tableKey={TABLE_KEYS.stockLedger}>). The visible page of rows is
// already loaded, so columns sort in memory via useClientSort (no server
// round-trip), exactly as the old client-side TanStack sort did. The public
// signature is unchanged — this component still takes NO props, so both call
// sites (store-inventory, party-stock-ledger) keep working untouched.

import {
  type ListStoreTransactionsQuery,
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
  type StoreTxnSourceType,
  type StoreTxnType,
} from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';

import { StatStrip, DataTable, Panel, useClientSort } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

import { useStoreTransactionsList } from '../api';
import { STORE_TXN_SOURCE_LABELS, STORE_TXN_TYPE_LABELS } from '../lib/txn-labels';
import { stockLedgerColumns } from './stock-ledger-columns';

const PAGE_SIZE = 50;

export function StockLedger(): React.JSX.Element {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [txnType, setTxnType] = useState<StoreTxnType | undefined>(undefined);
  const [sourceType, setSourceType] = useState<StoreTxnSourceType | undefined>(undefined);
  const [page, setPage] = useState(1);

  // Debounce the search box into the query, resetting to page 1.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);

  const query: ListStoreTransactionsQuery = useMemo(
    () => ({
      search,
      txnType,
      sourceType,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [search, txnType, sourceType, page],
  );

  const { data, isLoading, isFetching, isError, error } = useStoreTransactionsList(query);

  const columns = useMemo(() => stockLedgerColumns(), []);
  const items = useMemo(() => data?.items ?? [], [data?.items]);

  // Client-side sort over the loaded page — same behaviour the old TanStack
  // getSortedRowModel gave, without a server round-trip. The Source column sorts
  // by its displayed label, not the raw enum key.
  const { rows, sortBy, sortDir, onSort } = useClientSort(items, {
    accessors: { sourceType: (r) => STORE_TXN_SOURCE_LABELS[r.sourceType] },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count, then the filter
          bar (search · Type / Source · Clear), with the movement counts pinned
          inside the same band. */}
      <ListHeader
        title="Stock Ledger"
        icon="📦"
        count={data ? total : undefined}
        noun="movement"
        filterNote={
          [
            txnType ? STORE_TXN_TYPE_LABELS[txnType] : null,
            sourceType ? STORE_TXN_SOURCE_LABELS[sourceType] : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search item, source ref, remarks…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="Movement type"
              title="Movement type"
              value={txnType ?? ''}
              onChange={(e) => {
                const v = e.target.value as StoreTxnType | '';
                setTxnType(v === '' ? undefined : v);
                setPage(1);
              }}
            >
              <option value="">All Types</option>
              {STORE_TXN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STORE_TXN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              aria-label="Source"
              title="Source"
              value={sourceType ?? ''}
              onChange={(e) => {
                const v = e.target.value as StoreTxnSourceType | '';
                setSourceType(v === '' ? undefined : v);
                setPage(1);
              }}
            >
              <option value="">All Sources</option>
              {STORE_TXN_SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {STORE_TXN_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        }
        onClearFilters={() => {
          setSearchInput('');
          setTxnType(undefined);
          setSourceType(undefined);
          setPage(1);
        }}
        filtersActive={txnType !== undefined || sourceType !== undefined || searchInput !== ''}
      >
        {data?.summary ? (
          <StatStrip
            items={[
              {
                key: 'movements',
                label: 'Movements',
                count: data.summary.txnCount,
                color: 'var(--cyan)',
              },
              // In / Out / Net only mean something for ONE item — across items
              // they would add kg, Nos and m together.
              ...(data.summary.itemCount === 1
                ? [
                    {
                      key: 'in',
                      label: 'Total In',
                      count: `+${data.summary.totalIn}`,
                      color: 'var(--green2)',
                    },
                    {
                      key: 'out',
                      label: 'Total Out',
                      count: `-${data.summary.totalOut}`,
                      color: 'var(--red2)',
                    },
                    {
                      key: 'net',
                      label: 'Net',
                      count: `${data.summary.net >= 0 ? '+' : ''}${data.summary.net}`,
                      color: data.summary.net >= 0 ? 'var(--green2)' : 'var(--red2)',
                    },
                  ]
                : []),
              { key: 'items', label: 'Items', count: data.summary.itemCount },
            ]}
          />
        ) : null}
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load stock movements. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.stockLedger}
            columns={columns}
            defaultHidden={['remarks']}
            rows={rows}
            loading={isLoading}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            empty={
              search || txnType || sourceType
                ? 'No stock movements match.'
                : 'No stock movements yet.'
            }
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="stock movement"
        page={page}
        pageSize={PAGE_SIZE}
        onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
      />
    </div>
  );
}
