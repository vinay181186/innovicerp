// Operator Master list (UI-003-02).
// Ports legacy renderOperators (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13699-13725) to Innovic chrome. Legacy columns, in order (L13721):
// Operator ID | Name | Department | Skills / Machines | Status | Actions.
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference. The composition is the
// canonical one and nothing else:
//
//   <ListHeader>            title · count · Excel template / import ·
//                           SearchInput · status filter · primary
//   <MasterImportDialog>    Excel import: Import Type → preview → import
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · Prev / Next
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the status <select>, the <table>/<colgroup>/<thead>, the loading / error /
// empty rows, the badge, the row-action buttons, the count line, the pager, the
// import notice, `confirm()` — now comes from ui/. What is left here is the
// DATA and the RULES: the query, the permission gates, the delete and the
// Excel import.
//
// What did NOT change: the route and its search params (search, status, page),
// the 300ms debounce on the URL write, normalizeSearchTerm, the 25-row server
// page, the status -> isActive mapping, perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.
//
// THE ONE BEHAVIOUR THAT DID CHANGE, deliberately: Delete no longer runs on a
// browser `confirm()`. It raises the shared ConfirmDialog through RowActions,
// which owns the wait — both buttons go dead, the button reads "Moving to
// Trash…", and it closes only once the operator really is in the Trash.

import type { ListOperatorsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { MasterImportDialog } from '@/components/shared/master-import-dialog';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { operatorListColumns } from '../components/operator-list-columns';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateOperators, useOperatorsList, useSoftDeleteOperator } from '../api';
import { downloadOperatorTemplate, parseOperatorImportFile } from '../lib/import-export';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const operatorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators',
  validateSearch: listSearchSchema,
  component: OperatorsListPage,
});

function OperatorsListPage(): React.JSX.Element {
  const search = operatorsListRoute.useSearch();
  const navigate = operatorsListRoute.useNavigate();
  // Tier-driven, per department (operator_create sits in Production). Add/Import
  // = entry; Edit = edit; Del = the edit+approve pair only L5+ hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'operator_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

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
    // "  Ramesh   Patel " and "Ramesh Patel" are one query, one cache entry, one URL.
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

  const isActiveFilter =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss rows. Every change goes back to
  // page 1.
  const sf = useServerSortFilter(TABLE_KEYS.operatorsList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListOperatorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      sf: sf.param,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, sf.param, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useOperatorsList(query);
  const softDelete = useSoftDeleteOperator();

  // Excel import — ONE shared dialog (components/shared/master-import-dialog),
  // the same one Item / Vendor / Customer Master use: Import Type (Insert new /
  // Update existing by Code) → preview (dryRun, the server checks every row and
  // writes nothing) → import. The whole sheet goes in one request and the list
  // reloads once at the end; a bad row is left out with its reason and the rest
  // go in.
  //
  // Operator was the last master still writing straight away, insert-only, with
  // no preview — and a retry after a timeout could create every operator a
  // second time. The dialog's save key (one per open, reused on retry) is what
  // stops that, and it is passed for the real import only.
  const bulkCreate = useBulkCreateOperators();
  const [importOpen, setImportOpen] = useState(false);

  const rows = data?.operators ?? [];
  const total = data?.total ?? 0;
  const currentPage = search.page;

  const columns = useMemo(
    () => operatorListColumns((currentPage - 1) * PAGE_SIZE + 1),
    [currentPage],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      {/* The frozen header band: title, count, search, the status filter and
          the primary action stay put while the rows scroll underneath. */}
      <ListHeader
        title="Operator Master"
        icon="👷"
        // Count comes from the list response's `total` — the only aggregate
        // GET /operators returns.
        count={total}
        noun="operator"
        filterNote={search.status}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search code, name, department, skills…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={searchInput.trim() !== '' || search.status != null}
        filters={
          <Select
            aria-label="Active"
            value={search.status ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            onChange={(e) => {
              const v = e.target.value as 'active' | 'inactive' | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          />
        }
        // Excel template + import are data tools, so they sit on the title row
        // (ZONE B) between the identity line and the primary action — visible
        // the moment the page opens.
        //
        // PERMISSION CHANGE, deliberate (not a tidy-up): the gate was `canAdd`
        // alone, because this import could only INSERT. The server now also
        // supports Update existing (by Code), which is the page's EDIT right —
        // so the pair shows for `canAdd || canEdit`, exactly as Item / Vendor /
        // Customer Master do. The dialog itself then offers only the Import
        // Types the user actually holds (allowInsert / allowUpdate below), so an
        // edit-only user cannot create operators and an entry-only user cannot
        // overwrite saved ones.
        tools={
          canAdd || canEdit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                title="Download a blank Excel template for Operator Master"
                onClick={() => downloadOperatorTemplate()}
              >
                Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                title="Add or update operators from a filled template"
                onClick={() => setImportOpen(true)}
              >
                Import from Excel
              </Button>
            </>
          ) : null
        }
        primary={
          canAdd ? (
            <Link to="/operators/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> Add Operator
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load operators. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.operatorsList}
            sortFilterServer={sf}
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={
              search.search || search.status || sf.param
                ? 'No Operators match.'
                : 'No Operators yet.'
            }
            onRowClick={(op) => void navigate({ to: '/operators/$id', params: { id: op.id } })}
            rowActionsWidth="1%"
            rowActions={(op) => (
              <RowActions
                // Row click opens the operator (ERPNext list), so no View.
                // Edit is a ROUTE, so it stays a real link.
                editTo={canEdit ? `/operators/${op.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed: the confirm dialog
                // then owns the wait and closes only once the operator really
                // is in the Trash. An `if (softDelete.isPending) return;` here
                // would close the dialog and delete NOTHING.
                onDelete={
                  canDelete ? (): Promise<void> => softDelete.mutateAsync(op.id) : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Move Operator ${op.code} to Trash?`,
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
        noun="operator"
        // Server-paged register: `page` switches the footer to the Prev/Next
        // pager, the same one this screen drew by hand.
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />

      {importOpen ? (
        <MasterImportDialog
          title="Import Operators from Excel"
          noun="operator"
          codeLabel="Code"
          nameLabel="Operator Name"
          allowInsert={canAdd}
          allowUpdate={canEdit}
          parse={parseOperatorImportFile}
          // The save key reaches the REAL import only — the dialog passes it on
          // the dryRun: false call and never on the preview.
          submit={(importRows, mode, dryRun, saveKey) =>
            bulkCreate.mutateAsync({ operators: importRows, mode, dryRun, saveKey })
          }
          onDownloadTemplate={downloadOperatorTemplate}
          errorsFileName="Operator Import Errors.xlsx"
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </div>
  );
}
