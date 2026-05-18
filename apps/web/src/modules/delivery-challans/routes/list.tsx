import {
  DC_STATUSES,
  type DcStatus,
  type DeliveryChallanListItem,
  type ListDeliveryChallansQuery,
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
import { useDeliveryChallansList } from '../api';
import { DcStatusBadge } from '../components/dc-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(DC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const deliveryChallansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans',
  validateSearch: listSearchSchema,
  component: DeliveryChallansListPage,
});

function DeliveryChallansListPage() {
  const search = deliveryChallansListRoute.useSearch();
  const navigate = deliveryChallansListRoute.useNavigate();

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

  const query: ListDeliveryChallansQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useDeliveryChallansList(query);

  const columns = useMemo<ColumnDef<DeliveryChallanListItem>[]>(
    () => [
      {
        header: 'DC No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/delivery-challans/$id"
            params={{ id: row.original.id }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'dcDate',
        cell: ({ row }) => <span className="text-sm">{row.original.dcDate}</span>,
      },
      {
        header: 'Vendor',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.vendorName ?? row.original.vendorCodeText}</span>
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
            <span
              className="font-mono text-xs text-amber-700 dark:text-amber-300"
              title="po_code_text snapshot — PO not in DB"
            >
              {row.original.poCodeText}*
            </span>
          ),
      },
      {
        header: 'SO',
        cell: ({ row }) =>
          row.original.soCode ? (
            <span className="font-mono text-xs">{row.original.soCode}</span>
          ) : row.original.soRefText ? (
            <span
              className="font-mono text-xs text-muted-foreground"
              title="soRefId snapshot — SO line not in DB"
            >
              ref:{row.original.soRefText}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        header: 'Lines',
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.lineCount}</span>,
      },
      {
        header: 'Total qty',
        cell: ({ row }) => (
          <span className="font-mono text-sm">{Number(row.original.totalQty).toFixed(0)}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <DcStatusBadge status={row.original.status} />,
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
            <h1 className="text-2xl font-semibold tracking-tight">Delivery challans</h1>
            <p className="text-sm text-muted-foreground">
              Outbound DCs against JW POs — material sent for outsource processing. Issuing a DC
              flips the linked outsource op to <span className="font-mono">sent</span> and writes a
              stock OUT ledger row.
            </p>
          </div>
          <Button asChild>
            <Link to="/delivery-challans/new">
              <Plus />
              New DC
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search DC code, PO code, vendor…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as DcStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            className="md:max-w-[180px]"
          >
            <option value="">All statuses</option>
            {DC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
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
                    Loading delivery challans…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load delivery challans'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>
                  No delivery challans match these filters.
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
              ? 'No delivery challans'
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
