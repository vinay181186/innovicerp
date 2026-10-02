// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11481-11521). Columns, in order: Sr No | Thumbnail | Item Code · Name |
// Description | Material | UOM | Source | Action.
//
// PHASE 4 — migrated onto apps/web/src/ui/ following the GROUP 1 reference
// implementation, modules/clients/routes/list.tsx. The composition is that
// file's, with one owner-approved change (2026-10-02): the two Excel buttons
// moved out of the footer into the header's `tools` slot, so they are visible
// when the page opens instead of below 179 rows:
//
//   <ListHeader>            title · count · ⟳ Updating… · tools (Excel Template ·
//                           Import from Excel) · primary, then the filter
//                           bar: SearchInput · item type (with counts) · Source · Clear
//   <MasterImportDialog>    Excel import: Import Type → preview → import
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint
//   <PageState>             no-access and load-failure
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, the whole-master count queries (so the
// item-type dropdown's counts do not shrink as you type), perms -> canCreate/canEdit/
// canDelete, the one-request bulk import (now through the shared import dialog),
// row click -> detail, Item Code -> detail, the thumbnail's own click (the
// picture opens large; it never opens the row).
//
// Item Code and Item Name are separate one-line columns (ADR-199), the
// picture (app ItemImageBox) in its OWN column before them (2026-09-22).
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
// Paging (ADR-201): 25 rows per page, page in the URL; search, item type,
// Make / Buy and Sort & Filter (▾, ADR-200) run on the SERVER over the whole
// master, and any change of them goes back to page 1.
// UOM is a neutral <Tag>; Source (ADR-171) a <Badge> (an attribute, not a status).

import {
  ITEM_PROCUREMENT_TYPES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPES,
  ITEM_TYPE_RULES,
  type ItemProcurementType,
  type ItemType,
  type ListItemsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { MasterImportDialog } from '@/components/shared/master-import-dialog';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { itemListColumns } from '../components/item-list-columns';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateItems, useItemsList, useSoftDeleteItem } from '../api';
import { TrashReasonDialog } from '../components/trash-reason-dialog';
import { downloadItemTemplate, parseItemImportFile } from '../lib/import-export';

// One count query per stat. Module-level constants keep the query keys stable so
// these are fetched once and served from cache, and the counts stay whole-master
// totals — they don't shrink as you type in the search box.
const COUNT_ALL: ListItemsQuery = { limit: 1, offset: 0 };
// One count per item type (ADR-193), built from the shared type list.
const COUNT_BY_TYPE: ReadonlyArray<readonly [ItemType, ListItemsQuery]> = ITEM_TYPES.map(
  (t) => [t, { itemType: t, limit: 1, offset: 0 }] as const,
);

const listSearchSchema = z.object({
  search: z.string().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  // ADR-171 — Source (make / buy) filter, same URL-param shape as itemType.
  procurementType: z.enum(ITEM_PROCUREMENT_TYPES).optional(),
  page: pageSearchParam,
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
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
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
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter on the SERVER (ADR-200): the list is paged, so filtering
  // only the loaded page would miss items. Every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.itemsList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });
  const offset = pageOffset(search.page);

  const query: ListItemsQuery = useMemo(
    () => ({
      search: search.search,
      itemType: search.itemType,
      procurementType: search.procurementType,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [search.search, search.itemType, search.procurementType, sf.param, offset],
  );

  const { data, isLoading, isFetching, isError, error } = useItemsList(query);
  const gotoPage = useCallback(
    (p: number): void => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);

  // Item-type counts — whole-master totals, independent of the search box.
  const allCount = useItemsList(COUNT_ALL).data?.total ?? 0;
  // Fixed-length list (one per type, a module constant), so the hook order
  // never changes between renders.
  const typeCounts = COUNT_BY_TYPE.map(([t, q]) => [t, useItemsList(q).data?.total ?? 0] as const);

  const setTypeFilter = useCallback(
    (next: ItemType | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, itemType: next, page: 1 }), replace: true });
    },
    [navigate],
  );

  const setSourceFilter = useCallback(
    (next: ItemProcurementType | undefined): void => {
      void navigate({
        search: (prev) => ({ ...prev, procurementType: next, page: 1 }),
        replace: true,
      });
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
  // ADR-197: Delete asks for a reason — the row's Delete opens this dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);

  // Excel import — ONE shared dialog (components/shared/master-import-dialog):
  // Import Type (Insert new / Update existing by Item Code) → preview (dryRun,
  // the server checks every row and writes nothing) → import. The whole sheet
  // goes in one request and the list reloads once at the end; a bad row is
  // left out with its reason and the rest go in.
  const bulkCreate = useBulkCreateItems();
  const [importOpen, setImportOpen] = useState(false);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const columns = useMemo(() => itemListColumns(offset), [offset]);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is the
    // only scrollbox, so the column header cannot ride off the top at the last row.
    <div className="page-fill">
      {/* The frozen header band: title, count, primary action and the filter
          bar (search, item type, Source) stay put while the rows scroll
          underneath. */}
      <ListHeader
        title="Item Master"
        icon="◉"
        count={total}
        noun="item"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search code, name, description, material, UOM…"
        updating={isFetching && !isLoading}
        // Excel template + import sit on the title row, before the primary
        // action (owner decision 2026-10-02 — they used to be under the count
        // line, out of sight on a long list). Order is the order of use:
        // download the template, fill it, import it. Import opens the shared
        // import dialog; Insert new needs Add, Update existing needs Edit.
        tools={
          canCreate || canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadItemTemplate()}
                title="Download a blank Excel template for Item Master"
              >
                Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                onClick={() => setImportOpen(true)}
                title="Add or update items from a filled template"
              >
                Import from Excel
              </Button>
            </>
          ) : null
        }
        filters={
          <>
            {/* Item type, with the whole-master counts the old StatStrip
                showed in the option labels (owner decision 2026-09-26: one
                filter bar, no capsule row). Same `itemType` URL param. */}
            <Select
              value={search.itemType ?? ''}
              onChange={(e) => {
                const v = e.target.value as ItemType | '';
                setTypeFilter(v === '' ? undefined : v);
              }}
              title="Item type"
              aria-label="Item type"
              options={[
                { value: '', label: `All Items (${allCount})` },
                ...typeCounts.map(([t, n]) => ({
                  value: t,
                  label: `${ITEM_TYPE_RULES[t].label} (${n})`,
                })),
              ]}
            />
            <Select
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
          </>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              itemType: undefined,
              procurementType: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={
          sf.filtering ||
          search.itemType !== undefined ||
          search.procurementType !== undefined ||
          searchInput !== ''
        }
        primary={
          canCreate ? (
            <Link to="/items/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Item
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load items. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.itemsList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              sf.filtering || search.search || search.itemType || search.procurementType
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
                // ⋯ menu: Edit · ─ · Move to Trash. The Trash item opens the
                // dialog below, which asks for a reason (ADR-197) and owns the
                // wait until the record is in the Trash. It is an `items` entry
                // (not `onDelete`) so it carries the dialog's own words.
                items={[
                  {
                    key: 'delete',
                    label: 'Move to Trash',
                    icon: 'trash-2',
                    group: 'danger',
                    hidden: !canDelete,
                    // Every OTHER row's Trash greys out while one is in flight,
                    // exactly as `disabled={softDelete.isPending}` did.
                    disabledReason: softDelete.isPending ? 'Working…' : undefined,
                    onSelect: () => setDeleteTarget({ id: it.id, code: it.code }),
                  },
                ]}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="item"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
      {importOpen ? (
        <MasterImportDialog
          title="Import Items from Excel"
          noun="item"
          codeLabel="Item Code"
          nameLabel="Item Name"
          allowInsert={canCreate}
          allowUpdate={canEdit}
          parse={parseItemImportFile}
          submit={(rows, mode, dryRun, saveKey) =>
            bulkCreate.mutateAsync({ items: rows, mode, dryRun, saveKey })
          }
          onDownloadTemplate={downloadItemTemplate}
          errorsFileName="Item Import Errors.xlsx"
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {deleteTarget ? (
        <TrashReasonDialog
          title={`Move Item ${deleteTarget.code} to Trash?`}
          onConfirm={async (reason) => {
            await softDelete.mutateAsync({ id: deleteTarget.id, reason });
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}
