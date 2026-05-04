import type { ListOperatorsQuery, Operator } from '@innovic/shared';
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
import { useOperatorsList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const operatorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators',
  validateSearch: listSearchSchema,
  component: OperatorsListPage,
});

function OperatorsListPage() {
  const search = operatorsListRoute.useSearch();
  const navigate = operatorsListRoute.useNavigate();

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

  const isActiveFilter =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;

  const query: ListOperatorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useOperatorsList(query);

  const columns = useMemo<ColumnDef<Operator>[]>(
    () => [
      {
        header: 'Operator ID',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/operators/$id"
            params={{ id: row.original.id }}
            className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.code}
          </Link>
        ),
      },
      { header: 'Name', accessorKey: 'name' },
      {
        header: 'Department',
        accessorKey: 'department',
        cell: ({ row }) => row.original.department ?? '—',
      },
      {
        header: 'Skills / Machines',
        accessorKey: 'skills',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.skills ?? '—'}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <span
            className={
              row.original.isActive
                ? 'text-xs uppercase text-emerald-600'
                : 'text-xs uppercase text-muted-foreground'
            }
          >
            {row.original.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: data?.operators ?? [],
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
            <h1 className="text-2xl font-semibold tracking-tight">Operators</h1>
            <p className="text-sm text-muted-foreground">Shop-floor worker master.</p>
          </div>
          <Button asChild>
            <Link to="/operators/new">
              <Plus />
              New operator
            </Link>
          </Button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Search ID, name, department…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="md:max-w-sm"
          />
          <Select
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as 'active' | 'inactive' | '';
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
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
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
                    Loading operators…
                  </span>
                </TableEmpty>
              ) : isError ? (
                <TableEmpty colSpan={columns.length}>
                  <span className="text-destructive">
                    {error instanceof Error ? error.message : 'Failed to load operators'}
                  </span>
                </TableEmpty>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableEmpty colSpan={columns.length}>No operators match these filters.</TableEmpty>
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
              ? 'No operators'
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
