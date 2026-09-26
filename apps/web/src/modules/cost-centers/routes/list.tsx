// Cost Centre Master list — Phase A item 4.
// Ports legacy renderCostCenters (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L17165-17189) to Innovic chrome. Legacy columns, in order (L17186):
// Code | Name | Department | Type | Description | Status | Actions.
// Actions (L17176): ✏ edit + ✖ delete, both gated on write access.
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference. The composition is the
// canonical one and nothing else:
//
//   <ListHeader>            title · count · ⟳ Updating… · primary, then the
//                           filter bar: SearchInput · filters · Clear
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            the count line and the Prev / Page n / Next pager
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the three filter <select>s, the <table>/<colgroup>/<thead>, the loading /
// error / empty rows, the badge, the row-action buttons, the count line and
// the pager, `confirm()` — now comes from ui/. What is left here is the DATA
// and the RULES: the query, the permission gates and the delete.
//
// What did NOT change: the route and its search params (search, isActive,
// department, type, page), the 300ms debounce on the URL write,
// normalizeSearchTerm, the 25-row server page, perms -> canAdd/canEdit/
// canDelete, row click -> detail, Code cell -> detail, the column set and the
// column widths.
//
// THE ONE BEHAVIOUR THAT DID CHANGE, deliberately: Delete no longer runs on a
// browser `confirm()`. It raises the shared ConfirmDialog through RowActions,
// which owns the wait — both buttons go dead, the button reads "Deleting…",
// and it closes only once the row really is gone.

import {
  COST_CENTER_DEPARTMENTS,
  COST_CENTER_TYPES,
  type CostCenter,
  type ListCostCentersQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useCostCentersList, useSoftDeleteCostCenter } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  department: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const costCentersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers',
  validateSearch: listSearchSchema,
  component: CostCentersListPage,
});

function CostCentersListPage(): React.JSX.Element {
  const search = costCentersListRoute.useSearch();
  const navigate = costCentersListRoute.useNavigate();
  // Tier-driven (cc_create sits in Finance). Add -> entry, Edit -> edit, Delete
  // -> edit AND approve (the pair only L5 Department Admin and above hold).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'cc_create');
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
    // "  MACHINE  SHOP " and "MACHINE SHOP" are one query, one cache entry, one URL.
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

  const query: ListCostCentersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      department: search.department,
      type: search.type,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.department, search.type, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useCostCentersList(query);
  const softDelete = useSoftDeleteCostCenter();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentPage = search.page;

  // The sheet's columns, unchanged from the hand-written <colgroup>: the widths
  // are `%` and must sum to 100 WITH the Action column (rowActionsWidth below):
  // 5+11+22+12+10+20+10 = 90, + 10 = 100, so the table never scrolls sideways.
  // Centred by the standard; only Name is left-aligned (a name reads from its
  // left edge), and the long free-text columns ellipsize with the full value on
  // hover rather than wrapping the row taller.
  const columns = useMemo<DataTableColumn<CostCenter>[]>(
    () => [
      {
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        // Server-paged list: the serial number continues across pages.
        render: (_cc, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'Code',
        width: '11%',
        nowrap: true,
        // A real link, so the code can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (cc) => (
          <Link
            to="/cost-centers/$id"
            params={{ id: cc.id }}
            className="td-code"
            title="Open this cost centre"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {cc.code}
          </Link>
        ),
      },
      {
        header: 'Name',
        width: '22%',
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'name',
      },
      {
        header: 'Department',
        width: '12%',
        render: (cc) => cc.department ?? '—',
      },
      {
        header: 'Cost Centre Type',
        width: '10%',
        render: (cc) => cc.type ?? '—',
      },
      {
        header: 'Description',
        width: '20%',
        className: 'text3',
        ellipsis: true,
        render: (cc) => cc.description ?? '—',
        title: (cc) => cc.description ?? '',
      },
      {
        header: 'Active',
        width: '10%',
        nowrap: true,
        // kind="active" — the same chip the cost-centre DETAIL page draws, so
        // the two cannot disagree, and the same one the Client Master
        // reference list uses for a master's Active flag. The hand-written
        // chip this replaces was green / GREY here and green / amber on the
        // detail page; they are now one map (green / red).
        render: (cc) => <StatusBadge kind="active" status={String(cc.isActive)} />,
      },
    ],
    [currentPage],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed sees the no-access panel, not the page. `eff` is undefined
  // only while access is still loading — don't block then.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count and the primary action, then the
          filter bar (search, the three filters, Clear), stay put while the
          rows scroll underneath. */}
      <ListHeader
        title="Cost Centre Master"
        icon="🏢"
        // Count comes from the list response's `total` — the only aggregate
        // GET /cost-centers returns.
        count={total}
        noun="cost centre"
        filterNote={
          search.isActive === undefined ? undefined : search.isActive ? 'active' : 'inactive'
        }
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        filters={
          <>
            <Select
              aria-label="Department"
              value={search.department ?? ''}
              options={[
                { value: '', label: 'All departments' },
                ...COST_CENTER_DEPARTMENTS.map((d) => ({ value: d, label: d })),
              ]}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    department: e.target.value === '' ? undefined : e.target.value,
                    page: 1,
                  }),
                  replace: true,
                })
              }
            />
            <Select
              aria-label="Cost Centre Type"
              value={search.type ?? ''}
              options={[
                { value: '', label: 'All types' },
                ...COST_CENTER_TYPES.map((t) => ({ value: t, label: t })),
              ]}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    type: e.target.value === '' ? undefined : e.target.value,
                    page: 1,
                  }),
                  replace: true,
                })
              }
            />
            <Select
              aria-label="Active"
              value={search.isActive === undefined ? '' : String(search.isActive)}
              options={[
                { value: '', label: 'All' },
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
              onChange={(e) => {
                const v = e.target.value;
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    isActive: v === '' ? undefined : v === 'true',
                    page: 1,
                  }),
                  replace: true,
                });
              }}
            />
          </>
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              department: undefined,
              type: undefined,
              isActive: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={
          search.search != null ||
          search.department != null ||
          search.type != null ||
          search.isActive != null ||
          searchInput !== ''
        }
        primary={
          canAdd ? (
            <Link to="/cost-centers/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> Add Cost Centre
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load cost centres. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText="No cost centres. Click + Add Cost Centre."
            onRowClick={(cc) => void navigate({ to: '/cost-centers/$id', params: { id: cc.id } })}
            rowActionsWidth="10%"
            rowActions={(cc) => (
              <RowActions
                // View and Edit are ROUTES, so they stay real links —
                // ctrl-click / middle-click still open a new tab.
                viewTo={`/cost-centers/${cc.id}`}
                editTo={canEdit ? `/cost-centers/${cc.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed: the confirm dialog
                // then owns the wait and closes only once the cost centre is
                // really gone. An `if (softDelete.isPending) return;` here
                // would close the dialog and delete NOTHING.
                onDelete={
                  canDelete ? (): Promise<void> => softDelete.mutateAsync(cc.id) : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Move cost centre ${cc.code} to Trash?`,
                  message: `${cc.code} — ${cc.name} stops appearing in the Cost Centre Master and in every cost centre picker. You can restore it from Trash.`,
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
        noun="cost centre"
        // Server-paged register: `page` switches the footer to the Prev/Next
        // pager, the same one this screen drew by hand.
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />
    </div>
  );
}
