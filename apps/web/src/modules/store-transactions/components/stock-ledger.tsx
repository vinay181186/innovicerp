// Stock Ledger (read-only) — folded in as the "Stock Ledger" tab of Store /
// Inventory (formerly the standalone /store-transactions screen). Auto-recorded
// stock movements from GRN / Issues / Dispatch / OSP DC. Uses local component
// state for its filters (the standalone route drove them off the URL).

import {
  type ListStoreTransactionsQuery,
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
  type StoreTransactionListItem,
  type StoreTxnSourceType,
  type StoreTxnType,
} from '@innovic/shared';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { StatStrip } from '@/ui/data';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useStoreTransactionsList } from '../api';
import { STORE_TXN_SOURCE_LABELS, STORE_TXN_TYPE_LABELS } from '../lib/txn-labels';
import { TxnTypeBadge } from './txn-type-badge';

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

  const columns = useMemo<ColumnDef<StoreTransactionListItem>[]>(
    () => [
      {
        header: 'Date',
        accessorKey: 'txnDate',
        cell: ({ row }) => (
          <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {fmtDate(row.original.txnDate)}
          </span>
        ),
      },
      {
        header: 'Item Code',
        id: 'item',
        accessorFn: (r) => r.itemCode ?? r.itemCodeText ?? '',
        cell: ({ row }) => (
          <span
            className="mono fw-700"
            style={{ color: 'var(--text)', fontSize: 12, whiteSpace: 'nowrap' }}
          >
            {row.original.itemCode ?? row.original.itemCodeText ?? ''}
          </span>
        ),
      },
      {
        header: 'Item Name',
        accessorKey: 'itemName',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.itemName ?? ''}</span>,
      },
      {
        header: 'Type',
        accessorKey: 'txnType',
        cell: ({ row }) => <TxnTypeBadge type={row.original.txnType} />,
      },
      {
        header: 'Qty',
        accessorKey: 'qty',
        meta: { tdClass: 'td-num', thClass: 'th-num' },
        cell: ({ row }) => {
          const t = row.original.txnType;
          return (
            <span
              className="mono fw-700"
              style={
                t === 'in'
                  ? { color: 'var(--green2)' }
                  : t === 'out'
                    ? { color: 'var(--red2)' }
                    : undefined
              }
            >
              {t === 'in' ? '+' : t === 'out' ? '-' : ''}
              {row.original.qty}
            </span>
          );
        },
      },
      {
        header: 'Source',
        accessorKey: 'sourceType',
        cell: ({ row }) => (
          <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>
            {STORE_TXN_SOURCE_LABELS[row.original.sourceType]}
          </span>
        ),
      },
      {
        header: 'Ref No.',
        accessorKey: 'sourceRef',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{row.original.sourceRef}</span>
        ),
      },
      {
        header: 'Remarks',
        accessorKey: 'remarks',
        cell: ({ row }) => (
          <span className="text3" title={row.original.remarks ?? ''} style={{ fontSize: 11 }}>
            {row.original.remarks ?? ''}
          </span>
        ),
      },
      {
        header: 'Stock Before → After',
        id: 'stockAfter',
        accessorFn: (r) => r.stockAfter,
        meta: { tdClass: 'mono td-num', thClass: 'th-num' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {row.original.stockBefore} → <b>{row.original.stockAfter}</b>
          </span>
        ),
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          Type / Source filters · Clear, with the movement counts pinned
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
        tools={
          <>
            <select
              className="innovic-select"
              aria-label="Movement type"
              style={{ width: 110 }}
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
              style={{ width: 150 }}
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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setSearchInput('');
                setTxnType(undefined);
                setSourceType(undefined);
                setPage(1);
              }}
            >
              ↻ Clear
            </button>
          </>
        }
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

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        style={canSort ? { cursor: 'pointer', userSelect: 'none' } : undefined}
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort ? (
                            <span
                              aria-hidden
                              style={{
                                fontSize: 11,
                                opacity: sorted ? 1 : 0.3,
                                color: sorted ? 'var(--cyan)' : 'inherit',
                              }}
                            >
                              {sorted === 'desc' ? '▼' : sorted === 'asc' ? '▲' : '↕'}
                            </span>
                          ) : null}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading stock movements…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <span style={{ color: 'var(--red2)' }}>
                      {error instanceof Error
                        ? error.message
                        : 'Could not load stock movements. Try again.'}
                    </span>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    {search || txnType || sourceType
                      ? 'No stock movements match.'
                      : 'No stock movements yet.'}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cell.column.columnDef.meta?.tdClass}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
