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
import { ChevronLeft, ChevronRight, Loader2, Plus, Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SortTh, nextSort } from '@/components/shared/sortable-th';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useCreateItem, useItemsList, useSoftDeleteItem } from '../api';
import { downloadItemTemplate, parseItemImportFile } from '../lib/import-export';
import { printItemDrawing } from '../lib/print-drawing';

const PAGE_SIZE = 25;

/** Outcome of an Excel import, bucketed so each group is shown on its own. */
interface ImportResult {
  total: number;
  /** Item codes that were added to Item Master. */
  imported: string[];
  /** Item codes that already exist in Item Master (skipped). */
  duplicates: string[];
  /** Item codes that failed for a non-duplicate reason (bad data, etc.). */
  failures: string[];
  /** Row-level parse warnings from the workbook. */
  warnings: string[];
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  sortBy: z.enum(['code', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
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
      sortBy: search.sortBy,
      sortDir: search.sortDir,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.itemType, search.sortBy, search.sortDir, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useItemsList(query);

  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const toggleSort = useCallback(
    (field: 'code' | 'name') => {
      const next = nextSort(field, { sortBy: search.sortBy, sortDir: search.sortDir });
      void navigate({ search: (prev) => ({ ...prev, ...next, page: 1 }), replace: true });
    },
    [navigate, search.sortBy, search.sortDir],
  );

  const softDelete = useSoftDeleteItem();
  const { data: company } = useMyCompany();

  // Drw column print — opens the stored drawing in a print window (legacy
  // printDrawingFile). Company gives the letterhead; falls back gracefully.
  const printDrawing = useCallback(
    async (item: Item): Promise<void> => {
      try {
        const ok = await printItemDrawing({ item, company });
        if (!ok) window.alert('Allow popups to print.');
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Could not open drawing for printing');
      }
    },
    [company],
  );

  // Excel import — parse the workbook, then create each item sequentially
  // (each success invalidates the list via the mutation hook).
  const createItem = useCreateItem();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const { payloads, errors } = await parseItemImportFile(file);
      const imported: string[] = [];
      const duplicates: string[] = [];
      const failures: string[] = [];
      for (const p of payloads) {
        try {
          await createItem.mutateAsync(p);
          imported.push(p.code);
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'failed';
          // The API rejects an existing code with `… already exists`; split those
          // out as duplicates so the user gets a clean list of what to remove.
          if (/already exists/i.test(reason)) duplicates.push(p.code);
          else failures.push(p.code);
        }
      }
      setImportResult({ total: payloads.length, imported, duplicates, failures, warnings: errors });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const columns = useMemo<ColumnDef<Item>[]>(
    () => [
      {
        header: () => (
          <SortTh
            label="Item Code"
            field="code"
            sortBy={search.sortBy}
            sortDir={search.sortDir}
            onSort={toggleSort}
          />
        ),
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
        header: () => (
          <SortTh
            label="Name"
            field="name"
            sortBy={search.sortBy}
            sortDir={search.sortDir}
            onSort={toggleSort}
          />
        ),
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
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              title="View/Print drawing"
              onClick={() => void printDrawing(row.original)}
            >
              <Printer size={12} /> Print
            </button>
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
            {canWrite ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={softDelete.isPending}
                onClick={() => {
                  if (confirm(`Move item ${row.original.code} — ${row.original.name} to Trash?`)) {
                    softDelete.mutate(row.original.id);
                  }
                }}
              >
                Del
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [canWrite, softDelete, printDrawing, search.sortBy, search.sortDir, toggleSort],
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
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                title="Download Excel template"
                onClick={() => downloadItemTemplate()}
              >
                ⬇ Template
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                disabled={importing}
                onClick={() => fileRef.current?.click()}
              >
                {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '📄'} Import Excel
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                }}
              />
              <Link to="/items/new" className="btn btn-primary">
                <Plus size={14} /> Add Item
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {importError ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>
            ⚠ {importError}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 10 }}
              onClick={() => setImportError(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {importResult ? (
        <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      ) : null}

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

// Excel-import result banner. Duplicates get their own clearly-labelled list so
// the user can see exactly which item codes already exist in Item Master.
function ImportResultBanner(props: { result: ImportResult; onClose: () => void }): React.JSX.Element {
  const { result, onClose } = props;
  const { total, imported, duplicates, failures, warnings } = result;
  const copyDuplicates = (): void => {
    void navigator.clipboard?.writeText(duplicates.join('\n'));
  };
  const chip = (code: string): React.JSX.Element => (
    <span
      key={code}
      className="mono"
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        background: 'var(--bg4)',
        border: '1px solid var(--border)',
        fontSize: 11,
      }}
    >
      {code}
    </span>
  );
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-body" style={{ padding: '12px 14px', fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 700 }}>
            {imported.length > 0 ? '✅' : 'ℹ'} Imported {imported.length} of {total} item{total === 1 ? '' : 's'}
            {duplicates.length > 0 ? ` · ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} skipped` : ''}
            {failures.length > 0 ? ` · ${failures.length} failed` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={onClose}>
            ✕
          </button>
        </div>

        {duplicates.length > 0 ? (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: 'var(--amber)' }}>
                ⚠ Duplicate item codes — already in Item Master ({duplicates.length})
              </span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={copyDuplicates}>
                📋 Copy codes
              </button>
            </div>
            <div style={{ color: 'var(--text3)', marginBottom: 6 }}>
              These were skipped (they already exist). Remove them from your sheet, or ignore — they’re already saved.
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 160,
                overflowY: 'auto',
                userSelect: 'text',
              }}
            >
              {duplicates.map(chip)}
            </div>
          </div>
        ) : null}

        {imported.length > 0 || failures.length > 0 ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
            {imported.length > 0 ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: 6 }}>
                  ✅ Added rows ({imported.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', userSelect: 'text' }}>
                  {imported.map(chip)}
                </div>
              </div>
            ) : null}
            {failures.length > 0 ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
                  ✕ Failed rows ({failures.length})
                </div>
                <div style={{ color: 'var(--text3)', marginBottom: 6 }}>
                  ⚠ These break the item-code format rule — a code may contain only letters, digits, dot (.), underscore (_) and hyphen (-). No spaces or brackets. Fix the code in your sheet and re-import.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', userSelect: 'text' }}>
                  {failures.map(chip)}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div style={{ marginTop: 10, color: 'var(--text3)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Row warnings ({warnings.length})</div>
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 120, overflowY: 'auto' }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
