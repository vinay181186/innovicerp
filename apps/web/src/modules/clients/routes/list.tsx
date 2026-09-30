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
//   <ListHeader>            title · count · ⟳ Updating… · primary, then the
//                           filter bar: SearchInput · status (counts in the
//                           option labels) · Clear
//   <MasterImportDialog>    Excel import: Import Type → preview → import
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint · Excel template / import
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the <table>/<colgroup>/<thead>, the loading / error / empty rows, the badge,
// the row-action buttons, the count line, the 💡 hint, `confirm()` — now comes
// from apps/web/src/ui/. The only things left here are the DATA and the RULES:
// the query, the client-side status split, the permission gates and the import.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, the single un-filtered fetch (so the
// status dropdown can count all three options), perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.

import type { Client, ListClientsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { MasterImportDialog } from '@/components/shared/master-import-dialog';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateClients, useClientsList, useSoftDeleteClient } from '../api';
import { TrashReasonDialog } from '@/modules/items/components/trash-reason-dialog';
import { downloadClientTemplate, parseClientImportFile } from '../lib/import-export';

// No pagination — Clients is a master list, so it mirrors the SO/WO list: one
// fetch, everything in a single scrolling list (styling skill, Rule 4). The
// clients list endpoint caps `limit` at 1000 (packages/shared client schema,
// raised from 200 to match the SO master); ListFooter flags a larger set.
const LIST_LIMIT = 1000;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
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
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // One fetch of every client matching the search (no isActive server filter):
  // the Active/Inactive split is derived + filtered client-side so the status
  // dropdown can show real counts for all three options.
  const query: ListClientsQuery = useMemo(
    () => ({
      search: search.search,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search],
  );

  const { data, isLoading, isFetching, isError, error } = useClientsList(query);
  const softDelete = useSoftDeleteClient();
  // ADR-197: Delete asks for a reason — the row's Delete opens this dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null);
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // Excel import — ONE shared dialog (components/shared/master-import-dialog):
  // Import Type (Insert new / Update existing by Code) → preview (dryRun, the
  // server checks every row and writes nothing) → import. The whole sheet goes
  // in one request and the list reloads once at the end; a bad row is left out
  // with its reason and the rest go in.
  const bulkCreate = useBulkCreateClients();
  const [importOpen, setImportOpen] = useState(false);

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status }), replace: true });
    },
    [navigate],
  );

  // All rows matching the search; the Active/Inactive filter is client-side.
  const allRows = useMemo(() => data?.clients ?? [], [data?.clients]);
  const activeCount = useMemo(() => allRows.filter((c) => c.isActive).length, [allRows]);
  const inactiveCount = allRows.length - activeCount;
  const visibleRows = useMemo(() => {
    if (search.status === 'active') return allRows.filter((c) => c.isActive);
    if (search.status === 'inactive') return allRows.filter((c) => !c.isActive);
    return allRows;
  }, [allRows, search.status]);

  const total = data?.total ?? 0;

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+9+22+19+13+15+7 = 89, + 11 = 100, so the
  // table never scrolls sideways. Centred by the standard; only Customer is
  // left-aligned so the names share one edge, and the long free-text columns
  // ellipsize with the full value on hover rather than wrapping the row taller.
  const columns = useMemo<DataTableColumn<Client>[]>(
    () => [
      { header: 'Sr No', width: '4%', className: 'text3', render: (_c, i) => i + 1 },
      {
        header: 'Code',
        width: '9%',
        nowrap: true,
        // A real link, so the code can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (c) => (
          <Link
            to="/clients/$id"
            params={{ id: c.id }}
            className="td-code"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {c.code}
          </Link>
        ),
      },
      {
        header: 'Customer',
        width: '22%',
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'name',
      },
      {
        header: 'Address',
        width: '19%',
        className: 'text2',
        ellipsis: true,
        render: (c) => c.addressLine1 ?? '—',
        title: (c) => c.addressLine1 ?? '',
      },
      {
        header: 'Contact',
        width: '13%',
        className: 'text2',
        ellipsis: true,
        render: (c) => c.contactPerson ?? '—',
        title: (c) => c.contactPerson ?? '',
      },
      {
        header: 'Email',
        width: '15%',
        className: 'text2',
        ellipsis: true,
        render: (c) => c.email ?? '—',
        title: (c) => c.email ?? '',
      },
      {
        header: 'Active',
        width: '7%',
        nowrap: true,
        render: (c) => <StatusBadge kind="active" status={c.isActive ? 'active' : 'inactive'} />,
      },
    ],
    [],
  );

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
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
            <option value="">All Customers ({total})</option>
            <option value="active">Active ({activeCount})</option>
            <option value="inactive">Inactive ({inactiveCount})</option>
          </select>
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, status: undefined }),
            replace: true,
          });
        }}
        filtersActive={search.search != null || search.status != null || searchInput !== ''}
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
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={visibleRows}
            loading={isLoading}
            emptyText={search.status || search.search ? 'No Customers match.' : 'No Customers yet.'}
            onRowClick={(c) => void navigate({ to: '/clients/$id', params: { id: c.id } })}
            rowActionsWidth="11%"
            rowActions={(c) => (
              <RowActions
                // Row click opens the customer (ERPNext list); Edit is a
                // ROUTE, so it stays a real link for ctrl-click / new tab.
                editTo={canEdit ? `/clients/${c.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // Delete opens the Trash dialog below, which asks for a reason
                // (ADR-197) and owns the wait until the record is in the Trash.
                onDelete={canDelete ? () => setDeleteTarget({ id: c.id, code: c.code }) : undefined}
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
        shown={visibleRows.length}
        noun="customer"
        limit={LIST_LIMIT}
        // Excel template + import sit below the count line (mirror of Vendor
        // Master). Import opens the shared import dialog; Insert new needs Add,
        // Update existing needs Edit.
        actions={
          canAdd || canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadClientTemplate()}
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
