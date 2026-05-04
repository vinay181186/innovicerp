import type { ListMachinesQuery, Machine } from '@innovic/shared';
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
import { useMachinesList } from '../api';

const PAGE_SIZE = 25;
const STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['Idle', 'Running', 'Down', 'Maintenance']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const machinesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines',
  validateSearch: listSearchSchema,
  component: MachinesListPage,
});

function MachinesListPage() {
  const search = machinesListRoute.useSearch();
  const navigate = machinesListRoute.useNavigate();

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

  const query: ListMachinesQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useMachinesList(query);

  const columns = useMemo<ColumnDef<Machine>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/machines/$id"
            params={{ id: row.original.id }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      { header: 'Name', accessorKey: 'name' },
      {
        header: 'Type',
        accessorKey: 'machineType',
        cell: ({ row }) => row.original.machineType ?? '—',
      },
      {
        header: 'Cap / shift',
        accessorKey: 'capacityPerShift',
        cell: ({ row }) => row.original.capacityPerShift ?? '—',
      },
      { header: 'Shifts', accessorKey: 'shiftsPerDay' },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <span className="text-xs uppercase">{row.original.status}</span>,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: data?.machines ?? [],
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
            <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
            <p className="text-sm text-muted-foreground">Shop-floor equipment master.</p>
          </div>
          <Button asChild>
            <Link to="/machines/new">
              <Plus />
              New machine
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search code or name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as (typeof STATUSES)[number] | '';
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: v === '' ? undefined : v,
                  page: 1,
                }),
                replace: true,
              });
            }}
            className="md:max-w-[180px]"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
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
                    Loading machines…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load machines'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>No machines match these filters.</TableEmpty>
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
              ? 'No machines'
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
