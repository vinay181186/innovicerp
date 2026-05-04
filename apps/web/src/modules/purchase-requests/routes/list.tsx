import {
  type ListPurchaseRequestsQuery,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequestListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
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
import { usePurchaseRequestsList } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PR_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const purchaseRequestsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests',
  validateSearch: listSearchSchema,
  component: PurchaseRequestsListPage,
});

function PurchaseRequestsListPage() {
  const search = purchaseRequestsListRoute.useSearch();
  const navigate = purchaseRequestsListRoute.useNavigate();

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

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseRequestsList(query);

  const columns = useMemo<ColumnDef<PurchaseRequestListItem>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/purchase-requests/$id"
            params={{ id: row.original.id }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'prDate',
        cell: ({ row }) => <span className="text-sm">{row.original.prDate}</span>,
      },
      {
        header: 'Vendor',
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
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
        header: 'Operation',
        cell: ({ row }) => (
          <span className="text-xs uppercase text-muted-foreground">
            {row.original.operation ?? '—'}
          </span>
        ),
      },
      {
        header: 'Qty',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.qty}</span>,
      },
      {
        header: 'Source JC',
        cell: ({ row }) =>
          row.original.sourceJcCode ? (
            <span className="font-mono text-xs">
              {row.original.sourceJcCode} · op {row.original.sourceJcOpSeq}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        header: 'PO',
        cell: ({ row }) =>
          row.original.poCode ? (
            <span className="font-mono text-xs text-green-700 dark:text-green-300">
              {row.original.poCode}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <PrStatusBadge status={row.original.status} />,
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
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Purchase Requests</h1>
            <p className="text-sm text-muted-foreground">
              Procurement intent — bridges plan / outsource workflows to a PO.
            </p>
          </div>
          <Button asChild>
            <Link to="/purchase-requests/new">
              <Plus />
              New PR
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search code, operation, item name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as PrStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[180px]"
          >
            <option value="">All statuses</option>
            {PR_STATUSES.map((s) => (
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
                    Loading purchase requests…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load purchase requests'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>
                  No purchase requests match these filters.
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
              ? 'No purchase requests'
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
