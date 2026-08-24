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
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useStoreTransactionsList } from '../api';
import { TxnTypeBadge } from './txn-type-badge';

const PAGE_SIZE = 50;

function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
      <div className="mono fw-700" style={{ fontSize: 22, ...(color ? { color } : {}) }}>
        {value}
      </div>
    </div>
  );
}

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
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.txnDate}</span>,
      },
      {
        header: 'Item Code',
        id: 'item',
        accessorFn: (r) => r.itemCode ?? r.itemCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 12 }}>
            {row.original.itemCode ?? row.original.itemCodeText ?? ''}
          </span>
        ),
      },
      {
        header: 'Name',
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
        meta: { tdClass: 'td-ctr' },
        cell: ({ row }) => {
          const t = row.original.txnType;
          return (
            <span
              className="mono fw-700"
              style={
                t === 'in' ? { color: 'var(--green)' } : t === 'out' ? { color: 'var(--red)' } : undefined
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
            {row.original.sourceType.replaceAll('_', ' ').toUpperCase()}
          </span>
        ),
      },
      {
        header: 'Ref No.',
        accessorKey: 'sourceRef',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.sourceRef}</span>,
      },
      {
        header: 'Remarks',
        accessorKey: 'remarks',
        cell: ({ row }) => (
          <span
            className="text3"
            title={row.original.remarks ?? ''}
            style={{
              display: 'inline-block',
              maxWidth: 250,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
              fontSize: 11,
            }}
          >
            {row.original.remarks ?? ''}
          </span>
        ),
      },
      {
        header: 'Stock before → after',
        id: 'stockAfter',
        accessorFn: (r) => r.stockAfter,
        meta: { tdClass: 'mono' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
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
      {data?.summary ? (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <KpiTile label="Transactions" value={data.summary.txnCount} color="var(--cyan)" />
          <KpiTile label="Total IN" value={`+${data.summary.totalIn}`} color="var(--green)" />
          <KpiTile label="Total OUT" value={`-${data.summary.totalOut}`} color="var(--red)" />
          <KpiTile
            label="Net"
            value={`${data.summary.net >= 0 ? '+' : ''}${data.summary.net}`}
            color={data.summary.net >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <KpiTile label="Items" value={data.summary.itemCount} />
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text3)' }}>Search</label>
          <br />
          <input
            className="innovic-input"
            style={{ fontSize: 12, width: 220 }}
            placeholder="🔍 Search item, source ref, remarks..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text3)' }}>Type</label>
          <br />
          <select
            className="innovic-select"
            style={{ fontSize: 12, width: 110 }}
            value={txnType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnType | '';
              setTxnType(v === '' ? undefined : v);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {STORE_TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text3)' }}>Source</label>
          <br />
          <select
            className="innovic-select"
            style={{ fontSize: 12, width: 150 }}
            value={sourceType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnSourceType | '';
              setSourceType(v === '' ? undefined : v);
              setPage(1);
            }}
          >
            <option value="">All sources</option>
            {STORE_TXN_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => {
            setSearchInput('');
            setTxnType(undefined);
            setSourceType(undefined);
            setPage(1);
          }}
        >
          ↻ Clear
        </button>
        {isFetching && !isLoading ? (
          <span
            className="text3"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating…
          </span>
        ) : null}
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
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
                          sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                        }
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort ? (
                            <span
                              aria-hidden
                              style={{
                                fontSize: 9,
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
                    Loading store transactions…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <span style={{ color: 'var(--red)' }}>
                      {error instanceof Error ? error.message : 'Failed to load store transactions'}
                    </span>
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No stock movements found. Transactions are auto-recorded from GRN, Issues,
                    Dispatch, OSP DC.
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

      <div
        className="text3"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          marginTop: 6,
        }}
      >
        <span>
          {total === 0
            ? 'No store transactions'
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={12} />
            Prev
          </button>
          <span className="text2">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
