import {
  type ListStoreTransactionsQuery,
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
  type StoreTransactionListItem,
  type StoreTxnSourceType,
  type StoreTxnType,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
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
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useStoreTransactionsList } from '../api';
import { TxnTypeBadge } from '../components/txn-type-badge';

const PAGE_SIZE = 50;

const listSearchSchema = z.object({
  search: z.string().optional(),
  txnType: z.enum(STORE_TXN_TYPES).optional(),
  sourceType: z.enum(STORE_TXN_SOURCE_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const storeTransactionsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'store-transactions',
  validateSearch: listSearchSchema,
  component: StoreTransactionsListPage,
});

// Legacy renderStockLedger L25087-25091: each tile is a `.panel` with inline
// min-width/padding/centring — no accent border, no uppercase label. The `Items`
// tile passes no colour, so its value renders in the default text colour.
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

function StoreTransactionsListPage() {
  const search = storeTransactionsListRoute.useSearch();
  const navigate = storeTransactionsListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListStoreTransactionsQuery = useMemo(
    () => ({
      search: search.search,
      txnType: search.txnType,
      sourceType: search.sourceType,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.txnType, search.sourceType, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useStoreTransactionsList(query);

  // Column order + per-cell styling mirror legacy renderStockLedger L25132-25140
  // and the header row at L25154: Date | Item Code | Name | Type | Qty | Source |
  // Ref No. | Remarks. `Stock before → after` is an ADDITION beyond legacy (see
  // report) — legacy carries stockBefore/stockAfter on the row (L25024) but never
  // renders them in this table.
  //
  // Cell classes that legacy puts on the <td> go through meta.tdClass — flexRender
  // renders only the inner content, so `td-ctr` inside a cell renderer would land
  // on a <span> and do nothing (ISSUE-020). Inherited properties (colour, weight,
  // font-size, font-family) are safe on the span.
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
        // Legacy L25137 renders the sign from the movement direction and colours
        // the cell green/red. qty is stored positive — the sign is implied by
        // txn_type (see STORE_TXN_TYPES). `adjust` has no legacy counterpart, so
        // it renders unsigned in the default colour.
        cell: ({ row }) => {
          const t = row.original.txnType;
          return (
            <span
              className="mono fw-700"
              style={
                t === 'in'
                  ? { color: 'var(--green)' }
                  : t === 'out'
                    ? { color: 'var(--red)' }
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
        // Legacy L25140 truncates at 250px with an ellipsis and a full-text title.
        // max-width/overflow are inert on an inline element, so the span is made
        // inline-block to reproduce legacy's rendered result through flexRender.
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
  const currentPage = search.page;

  return (
    <div>
      {/* Legacy L25149 */}
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📖 Stock Ledger
      </div>

      {/* Summary cards — legacy L25086-25092 */}
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

      {/* Filter bar — legacy L25096-25103. Legacy's Item / From / To filters are
          not reachable here (the Item picker needs an item_id lookup the page has
          no source for; From/To are query wiring, out of this pass's scope) — both
          are reported, not approximated. Search and Source have no legacy
          counterpart and are kept. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <label style={{ fontSize: 10, color: 'var(--text3)' }}>Search</label>
          <br />
          <input
            className="innovic-input"
            style={{ fontSize: 12, width: 220 }}
            placeholder="🔍 Search source ref or remarks..."
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
            value={search.txnType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnType | '';
              void navigate({
                search: (prev) => ({ ...prev, txnType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
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
            value={search.sourceType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnSourceType | '';
              void navigate({
                search: (prev) => ({ ...prev, sourceType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
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
            void navigate({ search: () => ({ page: 1 }), replace: true });
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

      {/* Main ledger table — legacy L25153-25157. Legacy uses a plain `tbl-wrap`
          here (no `tbl-frozen`). */}
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

      {/* Server-side pagination has no legacy counterpart — legacy caps the table
          at 500 rows (L25130) and warns below it (L25158). Kept: removing it would
          strand every row past the first page. */}
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
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={12} />
            Prev
          </button>
          <span className="text2">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
