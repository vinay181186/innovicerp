// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11481-11521). Columns, in order: Sr No | Thumbnail | Item Code · Name |
// Description | Material | UOM | Source | Action.
//
// PHASE 4 — migrated onto apps/web/src/ui/ following the GROUP 1 reference
// implementation, modules/clients/routes/list.tsx. The composition is that
// file's, unchanged:
//
//   <ListHeader>            title · count · SearchInput · Source filter · ⟳ Updating… · primary
//     <StatStrip>           counts that double as the item-type filter
//   </ListHeader>
//   <Banner>                import error / import result (dismissible)
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint · Excel template / import
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand is gone: the sticky band, the
// search box, the <table>/<colgroup>/<thead>, the loading / error / empty rows,
// the badges, the row-action buttons, the count line, the 💡 hint, and
// `confirm()` on delete. What is left here is the DATA and the RULES — the
// query, the three count queries, the permission gates and the Excel import.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, the whole-master count queries (so the
// strip's numbers do not shrink as you type), perms -> canCreate/canEdit/
// canDelete, the one-request bulk import and its duplicate/failure buckets,
// row click -> detail, Item Code -> detail, the thumbnail's own click (the
// picture opens large; it never opens the row).
//
// The Item column is the shared <ItemBadge> (user decision 2026-09-21) with the
// picture in its OWN column before it (user decision 2026-09-22). It stays the
// APP badge from components/shared/item-badge, not ui/data's pure one: this
// list has a storage path, and resolving it to a signed URL plus owning the
// preview modal is exactly what the app wrapper does.
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
// Per-column sorting (the "Item Code ↕ · Name ↕" header toggles) was dropped
// with the sheet conversion — the SO master standard has none; rows come in
// the API's default order.
//
// Legacy delta now CLOSED (docs/ISSUES.md ISSUE-017): UOM was `.badge.b-grey`
// because legacy's `.tag` had no port. `.tag` exists today and <Tag> is the
// primitive named for it ("linked document refs, UOM, revisions"), so UOM is a
// neutral Tag again. Source (ADR-171) is a <Badge> — it is an item ATTRIBUTE,
// not a document status, so it is not a StatusBadge and gets no status map.

import {
  ITEM_PROCUREMENT_TYPES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPES,
  type Item,
  type ItemProcurementType,
  type ItemType,
  type ListItemsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { ItemBadge, ItemImageBox, THUMBNAIL_COL_WIDTH } from '@/components/shared/item-badge';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Badge, Button, Icon, Tag } from '@/ui/core';
import { DataTable, Panel, StatStrip, type DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateItems, useItemsList, useSoftDeleteItem } from '../api';
import { downloadItemTemplate, parseItemImportFile } from '../lib/import-export';

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
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
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
      setImportError(e instanceof Error ? e.message : 'Could not import file. Try again.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+8+22+24+15+7+9 = 89, + 11 = 100, so the
  // table never scrolls sideways. Centred by the standard; only the item code ·
  // name is left-aligned, so the code starts at the same x in every row.
  const columns = useMemo<DataTableColumn<Item>[]>(
    () => [
      { header: 'Sr No', width: '4%', className: 'text3', render: (_it, i) => i + 1 },
      {
        header: 'Thumbnail',
        width: THUMBNAIL_COL_WIDTH,
        // The picture fills the cell edge to edge, the gridlines being its
        // frame (user decision 2026-09-22). The negative margins cancel the
        // sheet's own cell padding (--sp-1 --sp-2) so the box reaches the
        // rules; `position: relative` is what `fill` pins itself to.
        // `stopRowClick` is NOT set: ItemImageBox already stops its own click,
        // and a dead cell around it should still open the row like any other.
        render: (it) => (
          <div
            style={{
              position: 'relative',
              height: 40,
              margin: 'calc(var(--sp-1) * -1) calc(var(--sp-2) * -1)',
            }}
          >
            <ItemImageBox imagePath={it.imagePath} size="row" alt={it.name} fill />
          </div>
        ),
      },
      {
        header: 'Item Code · Name',
        width: '22%',
        align: 'left',
        render: (it) => (
          // No item-level revision here, deliberately (see the header comment):
          // the badge gets the bare code, never `items.revision`. The picture
          // is the column to the left, so the badge is text only.
          <ItemBadge
            size="row"
            showImage={false}
            code={it.code}
            name={it.name}
            imagePath={it.imagePath}
            codeColor="var(--text)"
            nameMaxWidth="none"
            renderCode={(text) => (
              // A real link, so the code can be ctrl/middle-clicked into a new
              // tab. stopPropagation sits on the link so clicking the rest of
              // the cell still opens the row, exactly as before.
              <Link
                to="/items/$id"
                params={{ id: it.id }}
                className="td-code fw-700"
                style={{ color: 'var(--text)', textDecoration: 'none' }}
                onClick={(e) => e.stopPropagation()}
              >
                {text}
              </Link>
            )}
          />
        ),
      },
      // Description / Material are free text — clip at the column edge rather
      // than wrap, full value on hover (styling skill Rule 1's exception).
      {
        header: 'Description',
        width: '24%',
        className: 'text2',
        ellipsis: true,
        render: (it) => it.description ?? '—',
        title: (it) => it.description ?? '',
      },
      {
        header: 'Material',
        width: '15%',
        ellipsis: true,
        render: (it) => it.material ?? '—',
        title: (it) => it.material ?? '',
      },
      {
        header: 'UOM',
        width: '7%',
        nowrap: true,
        render: (it) => <Tag tone="neutral">{it.uom}</Tag>,
      },
      {
        header: 'Make / Buy',
        width: '9%',
        nowrap: true,
        // ADR-171 — Buy stands out (blue), Make is the quiet default.
        render: (it) => (
          <Badge tone={it.procurementType === 'buy' ? 'blue' : 'grey'}>
            {ITEM_PROCUREMENT_TYPE_LABEL[it.procurementType]}
          </Badge>
        ),
      },
    ],
    [],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, the Source filter, the
          primary action and the StatStrip stay put while the rows scroll
          underneath. */}
      <ListHeader
        title="Item Master"
        icon="◉"
        count={total}
        noun="item"
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        tools={
          <Select
            fieldWidth="md"
            value={search.procurementType ?? ''}
            onChange={(e) => {
              const v = e.target.value as ItemProcurementType | '';
              setSourceFilter(v === '' ? undefined : v);
            }}
            title="Make / Buy"
            aria-label="Make / Buy"
            options={[
              { value: '', label: 'All — Make / Buy' },
              ...ITEM_PROCUREMENT_TYPES.map((t) => ({
                value: t,
                label: ITEM_PROCUREMENT_TYPE_LABEL[t],
              })),
            ]}
          />
        }
        primary={
          canCreate ? (
            <Link to="/items/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Item
            </Link>
          ) : null
        }
      >
        {/* Counts double as the item-type filter (styling skill, Rule 3), and
            they are whole-master totals — not the size of the current search. */}
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
      </ListHeader>

      {importError ? (
        <Banner tone="error" role="alert" onDismiss={() => setImportError(null)}>
          ⚠ {importError}
        </Banner>
      ) : null}

      {importResult ? (
        <ImportResultBanner result={importResult} onClose={() => setImportResult(null)} />
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load items. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={
              search.search || search.itemType || search.procurementType
                ? 'No items match.'
                : 'No items yet.'
            }
            onRowClick={(it) => void navigate({ to: '/items/$id', params: { id: it.id } })}
            rowActionsWidth="11%"
            rowActions={(it) => (
              <RowActions
                // Row click opens the item (no separate View). Edit is a
                // ROUTE, so it stays a real link — ctrl/middle-click work.
                editTo={canEdit ? `/items/${it.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed: the confirm
                // dialog owns the wait, both its buttons go dead, and it
                // closes only once the item really is in the Trash. An
                // `if (softDelete.isPending) return;` here instead would close
                // the dialog and delete NOTHING — a silent no-op.
                onDelete={
                  canDelete ? (): Promise<void> => softDelete.mutateAsync(it.id) : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Move Item ${it.code} to Trash?`,
                  message: 'You can restore it from Trash.',
                  confirmLabel: 'Move to Trash',
                  pendingLabel: 'Moving to Trash…',
                }}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="item"
        limit={LIST_LIMIT}
        // Excel template + import sit below the count line (mirror of Client
        // and Vendor Master). The file input is hidden and only opened by the
        // button.
        actions={
          canCreate ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadItemTemplate()}
                title="Download Excel template"
              >
                Download Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                loading={importing}
                onClick={() => fileRef.current?.click()}
              >
                Import from Excel
              </Button>
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
            </>
          ) : null
        }
      />
    </div>
  );
}

// Excel-import result. Two notices, not one hand-painted panel: the outcome,
// and — when there are any — the duplicates on their own so the user can see
// exactly which item codes already exist in Item Master and copy them out.
function ImportResultBanner(props: {
  result: ImportResult;
  onClose: () => void;
}): React.JSX.Element {
  const { result, onClose } = props;
  const { total, imported, duplicates, failures, warnings } = result;
  const copyDuplicates = (): void => {
    void navigator.clipboard?.writeText(duplicates.join('\n'));
  };
  // The code chips are <Tag>s — the square mono chip, which is what a bare
  // document code is everywhere else in the app.
  const chips = (codes: string[]): React.JSX.Element => (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--sp-1)',
        maxHeight: 160,
        overflowY: 'auto',
        userSelect: 'text',
      }}
    >
      {codes.map((c) => (
        <Tag key={c} tone="neutral">
          {c}
        </Tag>
      ))}
    </div>
  );

  return (
    <>
      <Banner
        tone={imported.length > 0 ? 'success' : 'info'}
        onDismiss={onClose}
        title={
          <>
            {imported.length > 0 ? '✅' : 'ℹ'} Imported {imported.length} of {total} item
            {total === 1 ? '' : 's'}
            {duplicates.length > 0
              ? ` · ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} skipped`
              : ''}
            {failures.length > 0 ? ` · ${failures.length} not imported` : ''}
          </>
        }
      >
        {imported.length > 0 || failures.length > 0 ? (
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            {imported.length > 0 ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div
                  className="fw-700"
                  style={{ color: 'var(--green2)', marginBottom: 'var(--sp-1)' }}
                >
                  ✅ Added rows ({imported.length})
                </div>
                {chips(imported)}
              </div>
            ) : null}
            {failures.length > 0 ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div
                  className="fw-700"
                  style={{ color: 'var(--red2)', marginBottom: 'var(--sp-1)' }}
                >
                  ✕ Rows not imported ({failures.length})
                </div>
                {chips(failures)}
              </div>
            ) : null}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="text3" style={{ marginTop: 'var(--sp-2)' }}>
            <div className="fw-700" style={{ marginBottom: 'var(--sp-1)' }}>
              Row warnings ({warnings.length})
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 120, overflowY: 'auto' }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Banner>

      {duplicates.length > 0 ? (
        <Banner
          tone="warn"
          title={
            <>
              <span style={{ flex: 1 }}>
                ⚠ Duplicate item codes — already in Item Master ({duplicates.length})
              </span>
              <Button size="sm" variant="ghost" onClick={copyDuplicates}>
                📋 Copy codes
              </Button>
            </>
          }
        >
          {chips(duplicates)}
        </Banner>
      ) : null}
    </>
  );
}
