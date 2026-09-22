// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11481-11521) to the Innovic chrome (.panel + .innovic-table + .badge + .btn).
// Columns: Sr No | Item (image + code · name) | Description | Material | UOM |
// Source | Action — laid out as the app's ruled sheet (`.innovic-table.tbl-grid`,
// the SO Master / Job Cards / Plans look, 2026-09-21). Fixed `%` widths that add
// up to 100 so nothing scrolls sideways; every column centred by the standard
// except the Item column, which reads from its left edge.
//
// The Item column is the shared <ItemBadge> (user decision 2026-09-21): the
// 40 px product image, the code (still a <Link> to the item) and the name under
// it. The Drawing No. and Drw (print) columns are gone with the item-level
// drawing — drawings live on the SO / JWSO line.
//
// Per-column sorting (the "Item Code ↕ · Name ↕" header toggles) was dropped
// with the sheet conversion — the SO master standard has none; rows come in
// the API's default order.
//
// NO Rev column, deliberately, and it must not come back (user direction
// 2026-09-10). Legacy had one here and `items.revision` still exists, but a
// revision is not a property of an ITEM — it is the revision of the drawing the
// customer sent for ONE order, which is why it is entered per SO line
// (`sales_order_lines.revision`, migration 0119 / ADR-158) and travels downstream
// as CODE/REV (ADR-160). Showing an item-level Rev beside those made the master
// look like the authority on a number it does not own, and the two disagreeing
// on screen is worse than one of them being absent.
//
// Styled to the `styling` skill, same as the SO Master list:
//  - One frozen header band (title, count line, search, Source filter, import
//    toolbar, + Add Item) with the counts as ONE <StatStrip> inside it (Rule 3)
//    — All / Component / Assembly, each a click-to-filter. It replaces the
//    "All types" dropdown, which set exactly the same query param but showed no
//    numbers.
//  - The whole <tr> opens the item (Rule 2). The Item Code stays a <Link> so
//    middle-click and open-in-new-tab keep working — the row handler is added
//    on top of it, not instead of it, which is how the SO list does it.
//  - Description / Material are free text, so they truncate with an ellipsis
//    and carry the full value in `title` (Rule 1's long-text exception) instead
//    of stretching the table sideways.
//  - One fetch, one scrolling list, no Prev/Next (Rule 4) — 25-per-page turned
//    44 items into two pages on a list you scan end to end.
//  - The Action column is icon buttons only (Eye / Pencil / Trash2), one row,
//    each with title + aria-label naming the action (user, 2026-09-21).
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-017):
//  - UOM uses .badge.b-grey; legacy's .tag class has no port in
//    innovic-theme.css and inventing one is not allowed.
//  - Fetching indicator and import banners are React-only additions with no
//    legacy counterpart; removing them would drop working behaviour.

import {
  ITEM_PROCUREMENT_TYPES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPES,
  type ItemProcurementType,
  type ItemType,
  type ListItemsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Eye, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ItemBadge,
  ItemThumbnailCell,
  ItemThumbnailHeader,
  THUMBNAIL_COL_WIDTH,
} from '@/components/shared/item-badge';
import { StatStrip } from '@/components/shared/stat-strip';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBulkCreateItems, useItemsList, useSoftDeleteItem } from '../api';
import { downloadItemTemplate, parseItemImportFile } from '../lib/import-export';

// No pagination — mirror the SO/WO list: one fetch, scroll (no Prev/Next),
// per the `styling` skill Rule 4. Item Master is a master list you scan end to
// end; 25-at-a-time made 44 items into two pages. The API caps `limit` at 1000
// (raised from 200 so item pickers could pull the whole master), and the count
// line below flags the rare case of a larger set.
const LIST_LIMIT = 1000;

/** Column count — the loading / error / empty rows' <td colSpan> must always
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 8;

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
  // ADR-171 — Source (make / buy) filter, same URL-param shape as itemType.
  procurementType: z.enum(ITEM_PROCUREMENT_TYPES).optional(),
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
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  SHAFT  50 " and "SHAFT 50" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
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
      procurementType: search.procurementType,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.itemType, search.procurementType],
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

  const setSourceFilter = useCallback(
    (next: ItemProcurementType | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, procurementType: next }), replace: true });
    },
    [navigate],
  );

  const canCreate = perms.entry;
  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3 has
  // edit without approve; L4 has approve without edit.
  const canDelete = perms.edit && perms.approve;

  const softDelete = useSoftDeleteItem();

  // Excel import — parse the workbook, then send the WHOLE sheet in one request.
  // It used to POST one item at a time and wait for each answer, and every
  // answer invalidated the list below, so the browser re-downloaded the entire
  // item master after every row. On the identical vendor import that measured
  // about one row a second — nine minutes for a 500-row sheet. Now: one request,
  // one list reload at the end.
  const bulkCreate = useBulkCreateItems();
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
      if (payloads.length === 0) {
        setImportResult({
          total: 0,
          imported: [],
          duplicates: [],
          failures: [],
          warnings: errors,
        });
        return;
      }
      const res = await bulkCreate.mutateAsync({ items: payloads });
      const duplicates: string[] = [];
      const failures: string[] = [];
      for (const skip of res.skipped) {
        // `index` is the 1-based position in the array we sent, so it maps
        // straight back to the parsed row and its code. Code is optional on
        // import (auto-assigned server-side), so fall back to the name.
        const label = payloads[skip.index - 1]?.code ?? skip.name;
        // A code that is already taken is a duplicate — the user's fix is to
        // remove that row. Anything else is a genuine failure worth its reason.
        if (/already exists|deleted item/i.test(skip.reason)) duplicates.push(label);
        else failures.push(`${label}: ${skip.reason}`);
      }
      // `codes` are the codes actually assigned, in insert order — including the
      // ITM-#### the server generated for rows that left the code blank.
      setImportResult({
        total: payloads.length,
        imported: res.codes,
        duplicates,
        failures,
        warnings: errors,
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const rows = data?.items ?? [];
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
      {/* Frozen header band — title, count line, toolbar and the StatStrip stay
          put while the rows scroll underneath (the SO Master band). Opaque
          `--bg` background so rows don't show through as they pass under it. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              Item Master
            </div>
            {/* Count comes from the list response's `total` — the size of the
                list under the current search + filters. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} item{total === 1 ? '' : 's'}
              {search.itemType ? (
                <>
                  {' '}
                  · <span className="text2">{search.itemType}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search this list…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.procurementType ?? ''}
              onChange={(e) => {
                const v = e.target.value as ItemProcurementType | '';
                setSourceFilter(v === '' ? undefined : v);
              }}
              title="Source — Make / Buy"
              style={{ width: 130, fontSize: 12 }}
            >
              <option value="">All sources</option>
              {ITEM_PROCUREMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_PROCUREMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
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
        {/* The sheet look (tbl-grid): bold blue column names, gridlines, cream /
            white rows, fixed widths that add up to 100% so nothing scrolls
            sideways. Every column is centred by the standard; only Item is
            left-aligned (the picture box must sit at the same x in every row). */}
        <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
          <table className="innovic-table tbl-grid">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: THUMBNAIL_COL_WIDTH }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Sr No</th>
                <ItemThumbnailHeader />
                <th style={{ textAlign: 'left' }}>Item Code · Name</th>
                <th>Description</th>
                <th>Material</th>
                <th>UOM</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td
                    colSpan={COLUMN_COUNT}
                    className="empty-state"
                    style={{ color: 'var(--red)' }}
                  >
                    {error instanceof Error ? error.message : 'Failed to load items'}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="empty-state">
                    No items
                  </td>
                </tr>
              ) : (
                rows.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => void navigate({ to: '/items/$id', params: { id: item.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="text3">{i + 1}</td>
                    {/* Thumbnail column before the code · name (user decision
                        2026-09-22, every list). */}
                    <ItemThumbnailCell imagePath={item.imagePath} alt={item.name} />
                    <td style={{ textAlign: 'left' }}>
                      {/* No item-level revision here, deliberately (see the
                          header comment): the badge gets the bare code, never
                          `items.revision`. The name clips at the column edge. */}
                      <ItemBadge
                        size="row"
                        showImage={false}
                        code={item.code}
                        name={item.name}
                        imagePath={item.imagePath}
                        codeColor="var(--purple)"
                        nameMaxWidth="none"
                        renderCode={(text) => (
                          <Link
                            to="/items/$id"
                            params={{ id: item.id }}
                            className="td-code"
                            style={{ color: 'var(--purple)', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {text}
                          </Link>
                        )}
                      />
                    </td>
                    {/* Description / Material are free text — clip at the
                        column edge rather than wrap; full value on hover
                        (styling skill Rule 1). */}
                    <td>
                      <span
                        className="text2"
                        style={{
                          fontSize: 11,
                          maxWidth: '100%',
                          display: 'inline-block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                        title={item.description ?? ''}
                      >
                        {item.description ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          maxWidth: '100%',
                          display: 'inline-block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                        title={item.material ?? ''}
                      >
                        {item.material ?? '—'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="badge b-grey">{item.uom}</span>
                    </td>
                    {/* ADR-171 — Source: Buy stands out (blue), Make is the
                        quiet default. */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span
                        className={`badge ${item.procurementType === 'buy' ? 'b-blue' : 'b-grey'}`}
                      >
                        {ITEM_PROCUREMENT_TYPE_LABEL[item.procurementType]}
                      </span>
                    </td>
                    <td>
                      {/* Icon buttons only, one row, each named on hover. One
                          stopPropagation on the wrapper covers all three; View
                          goes where the row does, Edit / Delete do not. */}
                      <div
                        style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          to="/items/$id"
                          params={{ id: item.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          style={{ padding: '3px 6px' }}
                          title="View"
                          aria-label="View"
                        >
                          <Eye size={14} />
                        </Link>
                        {canEdit ? (
                          <Link
                            to="/items/$id/edit"
                            params={{ id: item.id }}
                            className="btn btn-ghost btn-sm btn-icon"
                            style={{ padding: '3px 6px' }}
                            title="Edit"
                            aria-label="Edit"
                          >
                            <Pencil size={14} />
                          </Link>
                        ) : null}
                        {canDelete ? (
                          // The sheet paints every .btn-sm on paper (theme rule),
                          // which would leave btn-danger's white icon invisible —
                          // so the icon is told to be red here, tokens only.
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            style={{ color: 'var(--red)', padding: '3px 6px' }}
                            title="Delete"
                            aria-label="Delete"
                            disabled={softDelete.isPending}
                            onClick={() => {
                              if (confirm(`Move item ${item.code} — ${item.name} to Trash?`)) {
                                softDelete.mutate(item.id);
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
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
