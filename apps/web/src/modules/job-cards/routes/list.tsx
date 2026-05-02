import {
  JC_COMPUTED_STATUSES,
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
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
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCardsList } from '../api';
import { JcSourceLink } from '../components/jc-source-link';
import { JcStatusBadge } from '../components/jc-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(JC_COMPUTED_STATUSES).optional(),
  machineId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards',
  validateSearch: listSearchSchema,
  component: JobCardsListPage,
});

function JobCardsListPage() {
  const search = jobCardsListRoute.useSearch();
  const navigate = jobCardsListRoute.useNavigate();

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

  const query: ListJobCardsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [
      search.search,
      search.status,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
      search.page,
    ],
  );

  const { data, isLoading, isFetching, isError, error } = useJobCardsList(query);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: operatorsData } = useOperatorsList({ limit: 200, offset: 0 });
  const machines = machinesData?.machines ?? [];
  const operators = operatorsData?.operators ?? [];

  const columns = useMemo<ColumnDef<JobCardListItem>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/op-entry"
            search={{ jc: row.original.code }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
            title="Open in Op Entry"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'jcDate',
        cell: ({ row }) => <span className="text-sm">{row.original.jcDate}</span>,
      },
      {
        header: 'Item',
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.itemCode}
            {row.original.itemName ? (
              <span className="ml-1 text-muted-foreground">— {row.original.itemName}</span>
            ) : null}
          </span>
        ),
      },
      {
        header: 'Customer',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.customerName ?? '—'}</span>
        ),
      },
      {
        header: 'Source',
        cell: ({ row }) => <JcSourceLink sourceLink={row.original.sourceLink} />,
      },
      {
        header: 'Qty',
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.orderQty}</span>
        ),
      },
      {
        header: 'Ops',
        cell: ({ row }) => {
          const r = row.original;
          const cls =
            r.totalOps > 0 && r.doneOps >= r.totalOps
              ? 'text-green-600'
              : r.doneOps > 0
                ? 'text-amber-600'
                : 'text-muted-foreground';
          return (
            <span className={`font-mono text-sm ${cls}`}>
              {r.doneOps}
              <span className="text-xs text-muted-foreground"> /{r.totalOps}</span>
            </span>
          );
        },
      },
      {
        header: 'Due',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.dueDate ?? '—'}</span>
        ),
      },
      {
        header: 'Priority',
        cell: ({ row }) => (
          <span
            className={`text-xs font-medium uppercase ${
              row.original.priority === 'high' ? 'text-red-600' : 'text-muted-foreground'
            }`}
          >
            {row.original.priority}
          </span>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => <JcStatusBadge status={row.original.computedStatus} />,
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

  const setNav = (
    update: Partial<Pick<typeof search, 'status' | 'machineId' | 'operatorId' | 'fromDate' | 'toDate'>>,
  ) => {
    void navigate({
      search: (prev) => ({ ...prev, ...update, page: 1 }),
      replace: true,
    });
  };

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Job cards</h1>
            <p className="text-sm text-muted-foreground">
              Production batches with computed status, ops progress, and source SO/JW link.
              Click a code to open in Op Entry.
            </p>
          </div>
        </div>

        {/* Filter row 1: search + status + priority indicator */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search code, item, customer, SO/JW…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as JcComputedStatus | '';
              setNav({ status: v === '' ? undefined : v });
            }}
            className="md:max-w-[180px]"
          >
            <option value="">All statuses</option>
            {JC_COMPUTED_STATUSES.map((s) => (
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

        {/* Filter row 2: machine + operator + date range */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select
            value={search.machineId ?? ''}
            onChange={(e) => setNav({ machineId: e.target.value || undefined })}
          >
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </Select>
          <Select
            value={search.operatorId ?? ''}
            onChange={(e) => setNav({ operatorId: e.target.value || undefined })}
          >
            <option value="">All operators</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={search.fromDate ?? ''}
            onChange={(e) => setNav({ fromDate: e.target.value || undefined })}
            placeholder="From date"
          />
          <Input
            type="date"
            value={search.toDate ?? ''}
            onChange={(e) => setNav({ toDate: e.target.value || undefined })}
            placeholder="To date"
          />
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
                    Loading job cards…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load job cards'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>
                  No job cards match these filters.
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
              ? 'No job cards'
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
