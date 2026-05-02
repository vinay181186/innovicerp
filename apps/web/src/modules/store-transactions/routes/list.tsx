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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

  const columns = useMemo<ColumnDef<StoreTransactionListItem>[]>(
    () => [
      {
        header: 'Date',
        accessorKey: 'txnDate',
        cell: ({ row }) => <span className="text-sm">{row.original.txnDate}</span>,
      },
      {
        header: 'Type',
        cell: ({ row }) => <TxnTypeBadge type={row.original.txnType} />,
      },
      {
        header: 'Item',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.itemCode ?? row.original.itemCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Item name',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.itemName ?? '—'}</span>
        ),
      },
      {
        header: 'Qty',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.qty}</span>,
      },
      {
        header: 'Source',
        cell: ({ row }) => (
          <span className="text-xs uppercase text-muted-foreground">
            {row.original.sourceType.replaceAll('_', ' ')}
          </span>
        ),
      },
      {
        header: 'Ref',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.sourceRef}</span>
        ),
      },
      {
        header: 'Stock before → after',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.stockBefore} → <b>{row.original.stockAfter}</b>
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Store Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Append-only stock-movement ledger. Rows land here via service-layer cascades —
            today, GRN QC accept; soon, dispatch and JW in/out.
          </p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search source ref or remarks…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.txnType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnType | '';
              void navigate({
                search: (prev) => ({ ...prev, txnType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[140px]"
          >
            <option value="">All types</option>
            {STORE_TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            value={search.sourceType ?? ''}
            onChange={(e) => {
              const v = e.target.value as StoreTxnSourceType | '';
              void navigate({
                search: (prev) => ({ ...prev, sourceType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[180px]"
          >
            <option value="">All sources</option>
            {STORE_TXN_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
          {isFetching && !isLoading ? (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </span>
          ) : null}
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading store transactions…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error
                      ? error.message
                      : 'Failed to load store transactions'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>
                  No store transactions match these filters.
                </TableEmpty>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total === 0
              ? 'No store transactions'
              : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                  replace: true,
                })
              }
            >
              <ChevronLeft />
              Prev
            </Button>
            <span className="font-medium text-foreground">
              Page {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                  replace: true,
                })
              }
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
