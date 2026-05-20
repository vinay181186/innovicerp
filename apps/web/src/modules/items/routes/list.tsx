// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3.html L11481) to
// the Innovic chrome (.panel + .innovic-table + .badge + .btn). Columns
// match legacy header order: Item Code | Name | Description | Drawing No.
// | Rev | Material | UOM | Drw | Actions. Uses TanStack Table for column
// defs (preserved per user direction 2026-05-20) but renders via plain
// <table className="innovic-table"> so the legacy CSS lights up.

import { type ItemType, ITEM_TYPES, type Item, type ListItemsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItemsList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const itemsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items',
  validateSearch: listSearchSchema,
  component: ItemsListPage,
});

function ItemsListPage(): React.JSX.Element {
  const search = itemsListRoute.useSearch();
  const navigate = itemsListRoute.useNavigate();
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListItemsQuery = useMemo(
    () => ({
      search: search.search,
      itemType: search.itemType,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.itemType, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useItemsList(query);

  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const columns = useMemo<ColumnDef<Item>[]>(
    () => [
      {
        header: 'Item Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/items/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--purple)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }) => <span className="fw-700">{row.original.name}</span>,
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.description ?? '—'}
          </span>
        ),
      },
      {
        header: 'Drawing No.',
        accessorKey: 'drawingNo',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11 }}>
            {row.original.drawingNo ?? '—'}
          </span>
        ),
      },
      {
        header: 'Rev',
        accessorKey: 'revision',
        cell: ({ row }) => <span className="td-ctr">{row.original.revision}</span>,
      },
      { header: 'Material', accessorKey: 'material', cell: ({ row }) => row.original.material ?? '—' },
      {
        header: 'UOM',
        accessorKey: 'uom',
        cell: ({ row }) => <span className="badge b-grey">{row.original.uom}</span>,
      },
      {
        header: 'Drw',
        cell: ({ row }) =>
          row.original.drawingFilePath ? (
            <span title="Drawing file attached" style={{ fontSize: 14 }}>
              📎
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }}>
            <Link to="/items/$id" params={{ id: row.original.id }} className="btn btn-ghost btn-sm">
              View
            </Link>
            {canWrite ? (
              <Link
                to="/items/$id/edit"
                params={{ id: row.original.id }}
                className="btn btn-ghost btn-sm"
              >
                Edit
              </Link>
            ) : null}
          </div>
        ),
      },
    ],
    [canWrite],
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
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Item Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, name, material…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.itemType ?? ''}
            onChange={(e) => {
              const v = e.target.value as ItemType | '';
              void navigate({
                search: (prev) => ({ ...prev, itemType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/items/new" className="btn btn-primary">
              <Plus size={14} /> Add Item
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ★ Item Master is for defining items only. Stock / Inventory is managed in{' '}
            <b>Store → Stock Ledger</b>.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="empty-state"
                    style={{ color: 'var(--red)' }}
                  >
                    {error instanceof Error ? error.message : 'Failed to load items'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No items
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
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

      <PaginationFooter
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        emptyLabel="No items"
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />
    </div>
  );
}

// Local PaginationFooter — same shape used across all UI-003 list pages.
function PaginationFooter(props: {
  total: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  emptyLabel: string;
  onPage: (page: number) => void;
}): React.JSX.Element {
  const { total, currentPage, totalPages, pageSize, emptyLabel, onPage } = props;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        fontSize: 12,
        color: 'var(--text3)',
      }}
    >
      <span>
        {total === 0
          ? emptyLabel
          : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} of ${total}`}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={currentPage <= 1}
          onClick={() => onPage(Math.max(1, currentPage - 1))}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
          Page {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
