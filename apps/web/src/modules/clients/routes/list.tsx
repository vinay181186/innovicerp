// Client Master list (UI-003-02).
// Ports legacy renderClients (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L12969-12995) to Innovic chrome. Legacy columns, in order:
// Code | Client Name | Address | Contact | Email | <blank actions th> (L12991).
// Status is a port-only column: legacy clients have no status field, ours carry
// isActive and the API filters on it (see ISSUES.md logged delta).
//
// PHASE 4 — this screen is the GROUP 1 reference implementation. It is the
// canonical LIST composition and nothing else:
//
//   <ListHeader>            title · count · Excel template / import ·
//                           ⟳ Updating… · primary, then the filter bar:
//                           SearchInput · status (counts in the option
//                           labels) · Clear
//   <MasterImportDialog>    Excel import: Import Type → preview → import
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the <table>/<colgroup>/<thead>, the loading / error / empty rows, the badge,
// the row-action buttons, the count line, the 💡 hint, `confirm()` — now comes
// from apps/web/src/ui/. The only things left here are the DATA and the RULES:
// the query, the server status filter + counts, the permission gates and the import.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.

import type { ListClientsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { MasterImportDialog } from '@/components/shared/master-import-dialog';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { clientListColumns } from '../components/client-list-columns';
import { useBulkCreateClients, useClientsList, useSoftDeleteClient } from '../api';
import { TrashReasonDialog } from '@/modules/items/components/trash-reason-dialog';
import { downloadClientTemplate, parseClientImportFile } from '../lib/import-export';

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: pageSearchParam,
});

export const clientsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients',
  validateSearch: listSearchSchema,
  component: ClientsListPage,
});

function ClientsListPage(): React.JSX.Element {
  const search = clientsListRoute.useSearch();
  const navigate = clientsListRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');

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
    // "  ACME  Engg " and "ACME Engg" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
    // SearchInput reports every keystroke into `searchInput`; this effect is
    // what waits 300ms before the route changes.
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
  const sf = useServerSortFilter(TABLE_KEYS.clientsList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });
  const offset = pageOffset(search.page);
  const isActive =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;
  const query: ListClientsQuery = useMemo(
    () => ({
      search: search.search,
      isActive,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [search.search, isActive, sf.param, offset],
  );

  const { data, isLoading, isFetching, isError, error } = useClientsList(query);
  const gotoPage = useCallback(
    (p: number): void => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);

  // Dropdown counts — server totals (limit 1) over the same search + ▾
  // filters, one per option, so they never count just the loaded page.
  const countQuery = (a: boolean | undefined): ListClientsQuery => ({
    search: search.search,
    isActive: a,
    sf: sf.param,
    limit: 1,
    offset: 0,
  });
  const allCount = useClientsList(countQuery(undefined)).data?.total ?? 0;
  const activeCount = useClientsList(countQuery(true)).data?.total ?? 0;
  const inactiveCount = useClientsList(countQuery(false)).data?.total ?? 0;
  const softDelete = useSoftDeleteClient();
  // ADR-197: Delete asks for a reason — the row's Delete opens this dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  // The clients service also needs role admin/manager to edit or delete
  // (requireWriteRole); a user with the tier but another role sees the two
  // ⋯ items greyed with the reason instead of a refusal after the click.
  const { data: me } = useSession();
  const roleBlock =
    !me || me.role === 'admin' || me.role === 'manager' ? undefined : 'Needs admin or manager role';

  // Excel import — ONE shared dialog (components/shared/master-import-dialog):
  // Import Type (Insert new / Update existing by Code) → preview (dryRun, the
  // server checks every row and writes nothing) → import. The whole sheet goes
  // in one request and the list reloads once at the end; a bad row is left out
  // with its reason and the rest go in.
  const bulkCreate = useBulkCreateClients();
  const [importOpen, setImportOpen] = useState(false);

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status, page: 1 }), replace: true });
    },
    [navigate],
  );

  const visibleRows = useMemo(() => data?.clients ?? [], [data?.clients]);

  const total = data?.total ?? 0;

  const columns = useMemo(() => clientListColumns(offset), [offset]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      {/* The frozen header band: title, count, primary action and the filter
          bar (search · status with counts · Clear) stay put while the rows
          scroll underneath. */}
      <ListHeader
        title="Customer Master"
        count={total}
        noun="customer"
        filterNote={
          search.status === 'active'
            ? 'Active'
            : search.status === 'inactive'
              ? 'Inactive'
              : undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="Customer status"
            title="Customer status"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(v === 'active' || v === 'inactive' ? v : undefined);
            }}
          >
            <option value="">All Customers ({allCount})</option>
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
        filtersActive={sf.filtering || search.search != null || search.status != null || searchInput !== ''}
        // Excel template + import are data tools, so they sit on the title row
        // (ZONE B) between the identity line and the primary action — visible
        // the moment the page opens. Import opens the shared import dialog;
        // Insert new needs Add, Update existing needs Edit.
        tools={
          canAdd || canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                title="Download a blank Excel template for Customer Master"
                onClick={() => downloadClientTemplate()}
              >
                Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                title="Add or update customers from a filled template"
                onClick={() => setImportOpen(true)}
              >
                Import from Excel
              </Button>
            </>
          ) : null
        }
        primary={
          canAdd ? (
            <Link to="/clients/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Customer
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load customers. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.clientsList}
            columns={columns}
            rows={visibleRows}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              sf.filtering || search.status || search.search
                ? 'No Customers match.'
                : 'No Customers yet.'
            }
            onRowClick={(c) => void navigate({ to: '/clients/$id', params: { id: c.id } })}
            rowActionsWidth="11%"
            rowActions={(c) => (
              <RowActions
                // Row click opens the customer (ERPNext list), so no View.
                // ⋯ menu: Edit · ─ · Move to Trash, both as `items` so they
                // can carry the role reason. Edit is a ROUTE, so it stays a
                // real link for ctrl-click / new tab.
                renderLink={(p) => <Link {...p} />}
                items={[
                  {
                    key: 'edit',
                    label: 'Edit',
                    icon: 'pencil',
                    to: `/clients/${c.id}/edit`,
                    hidden: !canEdit,
                    disabledReason: roleBlock,
                  },
                  {
                    // Opens the Trash dialog below, which asks for a reason
                    // (ADR-197) and owns the wait until it is in the Trash.
                    key: 'delete',
                    label: 'Move to Trash',
                    icon: 'trash-2',
                    group: 'danger',
                    hidden: !canDelete,
                    // Every OTHER row's Trash greys out while one is in flight,
                    // exactly as `disabled={softDelete.isPending}` did.
                    disabledReason: roleBlock ?? (softDelete.isPending ? 'Working…' : undefined),
                    onSelect: () => setDeleteTarget({ id: c.id, code: c.code }),
                  },
                ]}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="customer"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
      {importOpen ? (
        <MasterImportDialog
          title="Import Customers from Excel"
          noun="customer"
          codeLabel="Code"
          nameLabel="Customer Name"
          allowInsert={canAdd}
          allowUpdate={canEdit}
          parse={parseClientImportFile}
          submit={(rows, mode, dryRun, saveKey) =>
            bulkCreate.mutateAsync({ clients: rows, mode, dryRun, saveKey })
          }
          onDownloadTemplate={downloadClientTemplate}
          errorsFileName="Customer Import Errors.xlsx"
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {deleteTarget ? (
        <TrashReasonDialog
          title={`Move Customer ${deleteTarget.code} to Trash?`}
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
