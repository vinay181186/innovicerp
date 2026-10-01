// Item Master list (UI-003-01 + UI-003-02).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L11481-11521). Columns, in order: Sr No | Thumbnail | Item Code · Name |
// Description | Material | UOM | Source | Action.
//
// PHASE 4 — migrated onto apps/web/src/ui/ following the GROUP 1 reference
// implementation, modules/clients/routes/list.tsx. The composition is that
// file's, unchanged:
//
//   <ListHeader>            title · count · ⟳ Updating… · primary, then the filter
//                           bar: SearchInput · item type (with counts) · Source · Clear
//   <MasterImportDialog>    Excel import: Import Type → preview → import
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
// item-type dropdown's counts do not shrink as you type), perms -> canCreate/canEdit/
// canDelete, the one-request bulk import (now through the shared import dialog),
// row click -> detail, Item Code -> detail, the thumbnail's own click (the
// picture opens large; it never opens the row).
//
// Item Code and Item Name are separate one-line columns (ADR-199 table
// standard, 2026-10-01 — replaced the stacked <ItemBadge> cell), with the
// picture in its OWN column before them (user decision 2026-09-22). The
// picture is the APP ItemImageBox from components/shared/item-badge: this
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
  ITEM_TYPE_RULES,
  type Item,
  type ItemProcurementType,
  type ItemType,
  type ListItemsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ItemImageBox, THUMBNAIL_COL_WIDTH } from '@/components/shared/item-badge';
import { MasterImportDialog } from '@/components/shared/master-import-dialog';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Badge, Button, Icon, Tag } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateItems, useItemsList, useSoftDeleteItem } from '../api';
import { TrashReasonDialog } from '../components/trash-reason-dialog';
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
// One count per item type (ADR-193), built from the shared type list.
const COUNT_BY_TYPE: ReadonlyArray<readonly [ItemType, ListItemsQuery]> = ITEM_TYPES.map(
  (t) => [t, { itemType: t, limit: 1, offset: 0 }] as const,
);

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

  // Item-type counts — whole-master totals, independent of the search box.
  const allCount = useItemsList(COUNT_ALL).data?.total ?? 0;
  // Fixed-length list (one per type, a module constant), so the hook order
  // never changes between renders.
  const typeCounts = COUNT_BY_TYPE.map(([t, q]) => [t, useItemsList(q).data?.total ?? 0] as const);

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

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+8+22+24+15+7+9 = 89, + 11 = 100, so the
  // table never scrolls sideways. Centred by the standard; only the item code ·
  // name is left-aligned, so the code starts at the same x in every row.
  const columns = useMemo<DataTableColumn<Item>[]>(
    () => [
      {
        id: 'sr_no',
        header: 'Sr No',
        width: '4%',
        className: 'text3',
        render: (_it, i) => i + 1,
      },
      {
        id: 'thumbnail',
        header: 'Thumbnail',
        width: THUMBNAIL_COL_WIDTH,
        // The picture fills its cell and has no width of its own to measure.
        minWidth: 64,
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
              // Exactly one row high (28px Comfortable / 22px Compact); the
              // fit table gives this cell no vertical padding, and the
              // negative side margins cancel its horizontal padding.
              height: 'calc(var(--tbl-row-h, 28px) - 1px)',
              margin: '0 calc(var(--tbl-pad-x, var(--sp-2)) * -1)',
            }}
          >
            <ItemImageBox imagePath={it.imagePath} size="row" alt={it.name} fill />
          </div>
        ),
      },
      // Item Code and Item Name are two one-line columns (table standard,
      // ADR-199: every row one line) — the code no longer stacks over the name.
      // No item-level revision, deliberately (see the header comment).
      {
        id: 'item_code',
        header: 'Item Code',
        width: '10%',
        nowrap: true,
        render: (it) => (
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
            {it.code}
          </Link>
        ),
      },
      {
        id: 'item_name',
        header: 'Item Name',
        width: '12%',
        align: 'left',
        ellipsis: true,
        key: 'name',
      },
      // Description / Material are free text — clip at the column edge rather
      // than wrap, full value on hover (styling skill Rule 1's exception).
      {
        id: 'description',
        header: 'Description',
        width: '24%',
        className: 'text2',
        ellipsis: true,
        render: (it) => it.description ?? '—',
        title: (it) => it.description ?? '',
      },
      {
        id: 'material',
        header: 'Material',
        width: '15%',
        ellipsis: true,
        render: (it) => it.material ?? '—',
        title: (it) => it.material ?? '',
      },
      {
        id: 'uom',
        header: 'UOM',
        width: '7%',
        nowrap: true,
        render: (it) => <Tag tone="neutral">{it.uom}</Tag>,
      },
      {
        id: 'procurement_type',
        kind: 'badge',
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
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              itemType: undefined,
              procurementType: undefined,
            }),
            replace: true,
          });
        }}
        filtersActive={
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
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.itemsList}
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
                // Delete opens the Trash dialog below, which asks for a reason
                // (ADR-197) and owns the wait until the record is in the Trash.
                onDelete={
                  canDelete ? () => setDeleteTarget({ id: it.id, code: it.code }) : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
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
        // and Vendor Master). Import opens the shared import dialog; Insert
        // new needs Add, Update existing needs Edit.
        actions={
          canCreate || canEdit ? (
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
                onClick={() => setImportOpen(true)}
              >
                Import from Excel
              </Button>
            </>
          ) : null
        }
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
