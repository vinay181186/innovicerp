// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11481-11521) to the Innovic chrome (.panel + .innovic-table + .badge + .btn).
// Columns match legacy header order: Item Code | Name | Description | Drawing No.
// | Rev | Material | UOM | Drw | Actions. Uses TanStack Table for column
// defs (preserved per user direction 2026-05-20) but renders via plain
// <table className="innovic-table"> so the legacy CSS lights up.
//
// Styled to the `styling` skill, same as the SO Master list:
//  - Counts are ONE <StatStrip> (Rule 3) — All / Component / Assembly, each a
//    click-to-filter. It replaces the "All types" dropdown, which set exactly
//    the same query param but showed no numbers.
//  - The whole <tr> opens the item (Rule 2). The Item Code stays a <Link> so
//    middle-click and open-in-new-tab keep working — the row handler is added
//    on top of it, not instead of it, which is how the SO list does it.
//  - Description / Material are free text, so they truncate with an ellipsis
//    and carry the full value in `title` (Rule 1's long-text exception) instead
//    of stretching the table sideways.
//  - One fetch, one scrolling list, no Prev/Next (Rule 4) — 25-per-page turned
//    44 items into two pages on a list you scan end to end.
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-017):
//  - UOM uses .badge.b-grey; legacy's .tag class has no port in
//    innovic-theme.css and inventing one is not allowed.
//  - Fetching indicator and import banners are React-only additions with no
//    legacy counterpart; removing them would drop working behaviour.

import { type ItemType, ITEM_TYPES, type Item, type ListItemsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SortTh, nextSort } from '@/components/shared/sortable-th';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useCreateItem, useItemsList, useSoftDeleteItem } from '../api';
import { downloadItemTemplate, parseItemImportFile } from '../lib/import-export';
import { printItemDrawing } from '../lib/print-drawing';

// Legacy puts its cell classes on the <td> itself (e.g. `<td class="td-ctr">`),
// not on a wrapper span — td-ctr is text-align:center, which only takes effect
// on the block-level cell. Carry that class through the column def so the
// flexRender loop can put it where legacy has it.
// No pagination — mirror the SO/WO list: one fetch, scroll (no Prev/Next),
// per the `styling` skill Rule 4. Item Master is a master list you scan end to
// end; 25-at-a-time made 44 items into two pages. The API caps `limit` at 1000
// (raised from 200 so item pickers could pull the whole master), and the count
// line below flags the rare case of a larger set.
const LIST_LIMIT = 1000;

// One count query per stat. Module-level constants keep the query keys stable so
// these are fetched once and served from cache, and the counts stay whole-master
// totals — they don't shrink as you type in the search box.
const COUNT_ALL: ListItemsQuery = { limit: 1, offset: 0 };
const COUNT_COMPONENT: ListItemsQuery = { itemType: 'component', limit: 1, offset: 0 };
const COUNT_ASSEMBLY: ListItemsQuery = { itemType: 'assembly', limit: 1, offset: 0 };

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
  // Tier-driven, per department (Store). Was a single admin/manager write flag
  // covering create, edit and delete alike.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListItemsQuery = useMemo(
    () => ({
      search: search.search,
      itemType: search.itemType,
      sortBy: search.sortBy,
      sortDir: search.sortDir,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.itemType, search.sortBy, search.sortDir],
  );

  const { data, isLoading, isFetching, isError, error } = useItemsList(query);

  // Strip counts — whole-master totals, independent of the search box.
  const allCount = useItemsList(COUNT_ALL).data?.total ?? 0;
  const componentCount = useItemsList(COUNT_COMPONENT).data?.total ?? 0;
  const assemblyCount = useItemsList(COUNT_ASSEMBLY).data?.total ?? 0;

  const setTypeFilter = useCallback(
    (next: ItemType | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, itemType: next }), replace: true });
    },
    [navigate],
  );

  const canCreate = perms.entry;
  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3 has
  // edit without approve; L4 has approve without edit.
  const canDelete = perms.edit && perms.approve;

  const toggleSort = useCallback(
    (field: 'code' | 'name') => {
      const next = nextSort(field, { sortBy: search.sortBy, sortDir: search.sortDir });
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
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
        // Code is optional on import now (auto-assigned server-side), so fall
        // back to the name for the result lists the user sees.
        const label = p.code ?? p.name;
        try {
          await createItem.mutateAsync(p);
          imported.push(label);
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'failed';
          // The API rejects an existing code with `… already exists`; split those
          // out as duplicates so the user gets a clean list of what to remove.
          if (/already exists/i.test(reason)) duplicates.push(label);
          else failures.push(`${label}: ${reason}`);
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
        // Free text — clip it rather than let one long description stretch the
        // table sideways. Full value on hover (styling skill Rule 1).
        cell: ({ row }) => (
          <span
            className="text2"
            style={{
              fontSize: 11,
              maxWidth: 220,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
            }}
            title={row.original.description ?? ''}
          >
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
        meta: { tdClass: 'td-ctr' },
        cell: ({ row }) => row.original.revision,
      },
      {
        header: 'Material',
        accessorKey: 'material',
        cell: ({ row }) => (
          <span
            style={{
              maxWidth: 140,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
            }}
            title={row.original.material ?? ''}
          >
            {row.original.material ?? '—'}
          </span>
        ),
      },
      {
        header: 'UOM',
        accessorKey: 'uom',
        meta: { tdClass: 'td-ctr' },
        cell: ({ row }) => <span className="badge b-grey">{row.original.uom}</span>,
      },
      {
        header: 'Drw',
        meta: { tdClass: 'td-ctr' },
        cell: ({ row }) =>
          row.original.drawingFilePath ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              title="View/Print Drawing"
              onClick={(e) => {
                e.stopPropagation();
                void printDrawing(row.original);
              }}
            >
              🖨 Print
            </button>
          ) : (
            <span className="text3" style={{ fontSize: 11 }}>
              —
            </span>
          ),
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          // One stopPropagation on the wrapper covers Edit and Del; View goes to
          // the same page the row does, so it needs nothing.
          <div
            style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Link to="/items/$id" params={{ id: row.original.id }} className="btn btn-ghost btn-sm">
              View
            </Link>
            {canEdit ? (
              <Link
                to="/items/$id/edit"
                params={{ id: row.original.id }}
                className="btn btn-ghost btn-sm"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
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
    [canEdit, canDelete, softDelete, printDrawing, search.sortBy, search.sortDir, toggleSort],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

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
            placeholder="🔍 Search code, name, material…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canCreate ? (
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
                {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '📄'} Import
                Excel
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                }}
              />
              <Link to="/items/new" className="btn btn-primary">
                + Add Item
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {/* Counts + type filter in one strip (styling skill Rule 3). */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Items',
              count: allCount,
              color: 'var(--cyan)',
              active: search.itemType === undefined,
              onClick: () => setTypeFilter(undefined),
            },
            {
              key: 'component',
              label: 'Component',
              count: componentCount,
              color: 'var(--blue)',
              active: search.itemType === 'component',
              onClick: () => setTypeFilter('component'),
            },
            {
              key: 'assembly',
              label: 'Assembly',
              count: assemblyCount,
              color: 'var(--purple)',
              active: search.itemType === 'assembly',
              onClick: () => setTypeFilter('assembly'),
            },
          ]}
        />
      </div>

      {importError ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div
            className="panel-body"
            style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}
          >
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
                  <tr
                    key={row.id}
                    onClick={() =>
                      void navigate({ to: '/items/$id', params: { id: row.original.id } })
                    }
                    style={{ cursor: 'pointer' }}
                  >
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

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, padding: '0 4px' }}>
        💡 Click a row to open the item. · ★ Item Master is for defining items only. Stock /
        Inventory is managed in <b>Store → Store / Inventory</b>.
      </div>

      {/* Scroll footer (Rule 4): says whether you are seeing everything, so a
          truncated list can never look complete. */}
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
            ? 'No items'
            : total > LIST_LIMIT
              ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
              : `Showing all ${total} item${total === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}

// Excel-import result banner. Duplicates get their own clearly-labelled list so
// the user can see exactly which item codes already exist in Item Master.
function ImportResultBanner(props: {
  result: ImportResult;
  onClose: () => void;
}): React.JSX.Element {
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
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <span style={{ fontWeight: 700 }}>
            {imported.length > 0 ? '✅' : 'ℹ'} Imported {imported.length} of {total} item
            {total === 1 ? '' : 's'}
            {duplicates.length > 0
              ? ` · ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} skipped`
              : ''}
            {failures.length > 0 ? ` · ${failures.length} failed` : ''}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10 }}
            onClick={onClose}
          >
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--amber)' }}>
                ⚠ Duplicate item codes — already in Item Master ({duplicates.length})
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10 }}
                onClick={copyDuplicates}
              >
                📋 Copy codes
              </button>
            </div>
            <div style={{ color: 'var(--text3)', marginBottom: 6 }}>
              These were skipped (they already exist). Remove them from your sheet, or ignore —
              they’re already saved.
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
                  ⚠ These rows were rejected on save — the actual reason is shown next to each. Fix
                  the row in your sheet and re-import.
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
