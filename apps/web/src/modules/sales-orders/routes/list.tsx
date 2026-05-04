import {
  type ListSalesOrdersQuery,
  type SalesOrderListItem,
  SO_STATUSES,
  SO_TYPES,
  type SoStatus,
  type SoType,
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
import { useSalesOrdersList } from '../api';
import { SoStatusBadge } from '../components/so-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  type: z.enum(SO_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const salesOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders',
  validateSearch: listSearchSchema,
  component: SalesOrdersListPage,
});

function SalesOrdersListPage() {
  const search = salesOrdersListRoute.useSearch();
  const navigate = salesOrdersListRoute.useNavigate();

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

  const query: ListSalesOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      type: search.type,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.type, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useSalesOrdersList(query);

  const columns = useMemo<ColumnDef<SalesOrderListItem>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/sales-orders/$id"
            params={{ id: row.original.id }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'soDate',
        cell: ({ row }) => <span className="text-sm">{row.original.soDate}</span>,
      },
      {
        header: 'Customer',
        cell: ({ row }) => <span className="text-sm">{row.original.customerName ?? '—'}</span>,
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ row }) => (
          <span className="text-xs uppercase text-muted-foreground">
            {row.original.type.replaceAll('_', ' ')}
          </span>
        ),
      },
      {
        header: 'Lines',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.lineCount}</span>,
      },
      {
        header: 'Total Qty',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.totalQty}</span>,
      },
      {
        header: 'JC Qty',
        cell: ({ row }) => {
          const jc = row.original.jcQty;
          const total = row.original.totalQty;
          const cls =
            jc >= total && total > 0
              ? 'text-green-600'
              : jc > 0
                ? 'text-amber-600'
                : 'text-muted-foreground';
          return (
            <span className={`font-mono text-sm ${cls}`}>
              {jc}
              <span className="text-xs text-muted-foreground"> /{total}</span>
            </span>
          );
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <SoStatusBadge status={row.original.status} />,
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
            <h1 className="text-2xl font-semibold tracking-tight">Sales Orders</h1>
            <p className="text-sm text-muted-foreground">Customer orders and job-work orders.</p>
          </div>
          <Button asChild>
            <Link to="/sales-orders/new">
              <Plus />
              New SO
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search code, customer, client PO…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as SoStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[160px]"
          >
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select
            value={search.type ?? ''}
            onChange={(e) => {
              const v = e.target.value as SoType | '';
              void navigate({
                search: (prev) => ({ ...prev, type: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[200px]"
          >
            <option value="">All types</option>
            {SO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
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
                    Loading sales orders…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load sales orders'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>
                  No sales orders match these filters.
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
              ? 'No sales orders'
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
