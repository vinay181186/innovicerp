// Vendor Master list (UI-003-02; legacy parity pass 2026-07-15).
// Ports legacy renderVendors (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L27734) to Innovic chrome. Legacy columns, in order: Code | Name | Contact |
// Phone | Email | GSTIN | Address | Rating | Status | PO/GRN | Actions.
//
// Two legacy columns/behaviours are DELTA (blocked on backend, not faked here):
//   * PO/GRN — legacy counts db.purchaseOrders/db.grn client-side because it
//     holds the whole DB in memory. Our Vendor payload carries no counts, and
//     deriving them here would mean fetching every PO+GRN to count in the
//     browser (Rule 1 / N+1). Needs an aggregate on the vendors list endpoint.
//   * Rating — legacy shows an auto-computed grade+score (_calcVendorRating,
//     L27784) and opens a scorecard modal (_showVendorScore, L27814). Our
//     `rating` is a manually-entered letter, so we render the badge only. The
//     legacy badge's cursor:pointer + title="Click for details" are deliberately
//     NOT copied — there is no scorecard to open.
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), which this screen is the twin of:
//
//   <ListHeader>            title · count · ⟳ Updating… · primary, then the
//                           filter bar: SearchInput · status (with counts) · Clear
//   <MasterImportDialog>    Excel import: Import Type → preview → import
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint · Excel template / import
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the <table>/<colgroup>/<thead>, the loading / error / empty rows, the two
// badges, the row-action buttons, the count line, the 💡 hint, the import
// notice and `confirm()` — now comes from apps/web/src/ui/. The only things
// left here are the DATA and the RULES: the query, the server status
// filter + counts, the permission gates and the import.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.

import type { ListVendorsQuery } from '@innovic/shared';
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
import { vendorListColumns } from '../components/vendor-list-columns';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateVendors, useSoftDeleteVendor, useVendorsList } from '../api';
import { TrashReasonDialog } from '@/modules/items/components/trash-reason-dialog';
import { downloadVendorTemplate, parseVendorImportFile } from '../lib/import-export';

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: pageSearchParam,
});

export const vendorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors',
  validateSearch: listSearchSchema,
  component: VendorsListPage,
});

function VendorsListPage(): React.JSX.Element {
  const search = vendorsListRoute.useSearch();
  const navigate = vendorsListRoute.useNavigate();

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
    // "  Shree  Steel " and "Shree Steel" are one query, one cache entry, one URL.
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

  // Paging (ADR-201): 25 rows per page; search, the Active / Inactive
  // dropdown (server `isActive`) and Sort & Filter (▾, ADR-200) all run on
  // the SERVER over the whole master. Any change of them → page 1.
  const sf = useServerSortFilter(TABLE_KEYS.vendorsList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });
  const offset = pageOffset(search.page);
  const isActive =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;
  const query: ListVendorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [search.search, isActive, sf.param, offset],
  );

  const { data, isLoading, isFetching, isError, error } = useVendorsList(query);
  const gotoPage = useCallback(
    (p: number): void => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);

  // Dropdown counts — server totals (limit 1) over the same search + ▾
  // filters, one per option, so they never count just the loaded page.
  const countQuery = (a: boolean | undefined): ListVendorsQuery => ({
    search: search.search,
    isActive: a,
    sf: sf.param,
    limit: 1,
    offset: 0,
  });
  const allCount = useVendorsList(countQuery(undefined)).data?.total ?? 0;
  const activeCount = useVendorsList(countQuery(true)).data?.total ?? 0;
  const inactiveCount = useVendorsList(countQuery(false)).data?.total ?? 0;
  // Tier-driven, per department (vendor_create sits in Purchase). Replaces the
  // old admin/manager flag, which collapsed all seven tiers into two.
  //   Add / Excel import (Insert new)      -> entry  (L2 Data Entry and up)
  //   Edit / Excel import (Update existing) -> edit   (L3 Editor and up; L2
  //     creates but cannot alter)
  //   Del                -> edit AND approve. Delete is not one of the four tier
  //     actions, so it is expressed as the pair only L5 Department Admin and
  //     above hold: L3 has edit without approve, L4 has approve without edit.
  //     Previously admin-only, which locked out the tier meant to run the dept.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'vendor_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status, page: 1 }), replace: true });
    },
    [navigate],
  );

  const softDelete = useSoftDeleteVendor();
  // ADR-197: Delete asks for a reason — the row's Delete opens this dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);

  // Excel import — ONE shared dialog (components/shared/master-import-dialog):
  // Import Type (Insert new / Update existing by Code) → preview (dryRun, the
  // server checks every row and writes nothing) → import. The whole sheet goes
  // in one request and the list reloads once at the end; a bad row (one bad
  // email, say) is left out with its reason and the rest go in (finding 35).
  const bulkCreate = useBulkCreateVendors();
  const [importOpen, setImportOpen] = useState(false);

  const visibleRows = useMemo(() => data?.vendors ?? [], [data?.vendors]);

  const total = data?.total ?? 0;

  const columns = useMemo(() => vendorListColumns(offset), [offset]);

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, primary action and the filter
          bar stay put while the rows scroll underneath. */}
      <ListHeader
        title="Vendor Master"
        icon="🚚"
        count={total}
        noun="vendor"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search code, vendor, contact, phone, email, GST, address…"
        updating={isFetching && !isLoading}
        filters={
          // Status with its counts in the option labels (owner decision
          // 2026-09-26: one filter bar, no capsule row). Counts are server
          // totals over the same search + ▾ filters.
          <select
            className="innovic-select"
            aria-label="Vendor status"
            title="Vendor status"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(v === 'active' || v === 'inactive' ? v : undefined);
            }}
          >
            <option value="">All Vendors ({allCount})</option>
            <option value="active">Active ({activeCount})</option>
            <option value="inactive">Inactive ({inactiveCount})</option>
          </select>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={sf.filtering || search.status !== undefined || searchInput !== ''}
        primary={
          canAdd ? (
            <Link to="/vendors/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Vendor
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load vendors. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.vendorsList}
            columns={columns}
            rows={visibleRows}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              sf.filtering || search.status || search.search
                ? 'No vendors match.'
                : 'No vendors yet.'
            }
            onRowClick={(v) => void navigate({ to: '/vendors/$id', params: { id: v.id } })}
            rowActionsWidth="11%"
            rowActions={(v) => (
              <RowActions
                // Row click opens the vendor (no separate View). Edit is a
                // ROUTE, so it stays a real link — ctrl/middle-click work.
                editTo={canEdit ? `/vendors/${v.id}/edit` : undefined}
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
                    onSelect: () => setDeleteTarget({ id: v.id, code: v.code }),
                  },
                ]}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="vendor"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
        // Legacy L27776-27779: Excel template + import sit below the count
        // line. Import opens the shared import dialog; Insert new needs Add,
        // Update existing needs Edit.
        actions={
          canAdd || canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadVendorTemplate()}
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
          title="Import Vendors from Excel"
          noun="vendor"
          codeLabel="Code"
          nameLabel="Vendor Name"
          allowInsert={canAdd}
          allowUpdate={canEdit}
          parse={parseVendorImportFile}
          submit={(rows, mode, dryRun, saveKey) =>
            bulkCreate.mutateAsync({ vendors: rows, mode, dryRun, saveKey })
          }
          onDownloadTemplate={downloadVendorTemplate}
          errorsFileName="Vendor Import Errors.xlsx"
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {deleteTarget ? (
        <TrashReasonDialog
          title={`Move Vendor ${deleteTarget.code} to Trash?`}
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
