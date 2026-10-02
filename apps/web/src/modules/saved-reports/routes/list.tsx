// Saved Reports list — composed like every other house list (SO Master is the
// reference): ListHeader · Panel › DataTable · RowActions. It used to be a
// shadcn Card stack with its own look; the data, routes and delete call are
// unchanged. Row click runs the report (ERPNext list → open the record); Edit
// and Delete stay as row actions.
//
// ADR-201: 25 reports a page (page in the URL); the search box and the
// column ▾ Sort & Filter run on the server over every visible report, and
// any change of them goes back to page 1.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useDeleteSavedReport, useSavedReportsList, useSourceCatalog } from '../api';

const SHARED_OPTIONS = [
  { value: 'true', label: 'Shared' },
  { value: 'false', label: 'Private' },
];

export const savedReportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports',
  validateSearch: z.object({ page: pageSearchParam }),
  component: SavedReportsListPage,
});

function SavedReportsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { page } = savedReportsListRoute.useSearch();
  const routeNavigate = savedReportsListRoute.useNavigate();
  const gotoPage = useCallback(
    (p: number): void => {
      void routeNavigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [routeNavigate],
  );
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(term);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.savedReportsList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useSavedReportsList({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  useClampPage(page, data?.total, gotoPage);
  const { data: catalog } = useSourceCatalog();
  const deleteMutation = useDeleteSavedReport();
  // The server lets only the report's owner or role admin/manager edit or
  // delete it (saved-reports service, assertCanWrite). Other users' shared
  // reports show both ⋯ items greyed with the reason.
  const { data: me } = useSession();
  const ownerBlock = (ownerId: string): string | undefined =>
    !me || me.id === ownerId || me.role === 'admin' || me.role === 'manager'
      ? undefined
      : 'Only the owner can change this';

  // Source label ("Sales Orders"), never the raw source key.
  const sourceLabel = useMemo(
    () => new Map((catalog?.sources ?? []).map((s) => [s.sourceKey, s.label])),
    [catalog],
  );

  // The server searches name, description, data source and owner.
  const rows = useMemo(() => data?.reports ?? [], [data?.reports]);
  const total = data?.total ?? 0;
  const sourceOptions = useMemo(
    () => (catalog?.sources ?? []).map((s) => ({ value: s.sourceKey, label: s.label })),
    [catalog],
  );

  const columns = useMemo<DataTableColumn<(typeof rows)[number]>[]>(
    () => [
      {
        id: 'sr_no',
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        render: (_r, i) => offset + i + 1,
      },
      {
        id: 'name',
        header: 'Report Name',
        width: '30%',
        align: 'left',
        ellipsis: true,
        title: (r) => r.name,
        render: (r) => <span className="fw-700">{r.name}</span>,
        sortFilterField: 'name',
      },
      {
        id: 'description',
        header: 'Description',
        width: '27%',
        align: 'left',
        ellipsis: true,
        className: 'text2',
        title: (r) => r.description ?? '',
        render: (r) => r.description || '—',
        sortFilterField: 'description',
      },
      {
        id: 'source',
        header: 'Source',
        width: '14%',
        nowrap: true,
        render: (r) => sourceLabel.get(r.sourceKey) ?? '—',
        sortFilterField: 'source',
        filterType: 'list',
        filterOptions: sourceOptions,
      },
      {
        id: 'is_shared',
        header: 'Shared',
        width: '9%',
        nowrap: true,
        render: (r) =>
          r.isShared ? (
            <span className="badge b-green">Shared</span>
          ) : (
            <span className="badge b-grey">Private</span>
          ),
        sortFilterField: 'isShared',
        filterType: 'list',
        filterOptions: SHARED_OPTIONS,
      },
      {
        id: 'owner',
        header: 'Owner',
        width: '15%',
        ellipsis: true,
        className: 'text3',
        title: (r) => r.ownerEmail ?? '',
        render: (r) => r.ownerEmail ?? '—',
        sortFilterField: 'owner',
      },
    ],
    [sourceLabel, sourceOptions, offset],
  );

  return (
    <div>
      <ListHeader
        title="Saved Reports"
        icon="✨"
        count={data ? total : undefined}
        noun="saved report"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search report name, description, source, owner…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setTerm('');
        }}
        filtersActive={sf.filtering || term !== ''}
        primary={
          <Link to="/saved-reports/new" className="btn btn-primary">
            <Icon name="plus" size={14} /> New Report
          </Link>
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load saved reports. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.savedReportsList}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              term.trim() || sf.filtering ? 'No Saved Reports match.' : 'No Saved Reports yet.'
            }
            onRowClick={(r) => void navigate({ to: '/saved-reports/$id', params: { id: r.id } })}
            rowActionsWidth="10%"
            rowActions={(r) => (
              <RowActions
                // Row click runs the report, so no View. ⋯ menu: Edit · ─ ·
                // Delete; without the owner right both are greyed `items`
                // (Delete then has no handler).
                editTo={ownerBlock(r.ownerId) ? undefined : `/saved-reports/${r.id}/edit`}
                renderLink={(p) => <Link {...p} />}
                items={[
                  {
                    key: 'edit-owner',
                    label: 'Edit',
                    icon: 'pencil',
                    hidden: !ownerBlock(r.ownerId),
                    disabledReason: ownerBlock(r.ownerId),
                  },
                  {
                    key: 'delete-owner',
                    label: 'Delete',
                    icon: 'trash-2',
                    group: 'danger',
                    hidden: !ownerBlock(r.ownerId),
                    disabledReason: ownerBlock(r.ownerId),
                  },
                ]}
                onDelete={
                  ownerBlock(r.ownerId) ? undefined : () => deleteMutation.mutateAsync(r.id)
                }
                deleteDisabled={deleteMutation.isPending}
                deleteConfirm={{
                  title: `Delete saved report ${r.name}?`,
                  message: r.isShared ? 'It is removed for everyone it is shared with.' : undefined,
                  confirmLabel: 'Delete',
                  pendingLabel: 'Deleting…',
                }}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="saved report"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
