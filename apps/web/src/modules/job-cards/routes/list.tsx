// Job cards list (UI-003-07).
//
// PHASE 4 — migrated onto apps/web/src/ui/ following the GROUP 1 reference
// implementation, modules/clients/routes/list.tsx:
//
//   <ListHeader>            row 1: title · count … + New JWSO JC · + Plan &
//                           Create (primary); row 2 (filter bar): search · status
//                           (counts in the labels) · machine · operator · dates ·
//                           Clear — all inside the ONE sticky band
//   <Panel><DataTable>      THE SHEET — the ADR-199 fit table, the sole view
//   <ListFooter>            count line · pager · 💡 hint
//   <PageState>             no-access and load failure
//
// ADR-199: the fit table is the only view (Card View retired); the card's
// extra facts are OFF-by-default columns (`defaultHidden`). The filter
// controls live in components/jc-list-filters.tsx (kept this file under the cap).
//
// WHAT DID NOT CHANGE — this screen is the shop floor's board and every rule
// below is how the board is read:
//   · the route, its six search params and `page`; the 300ms debounce on the
//     URL write; normalizeSearchTerm; every filter writing page: 1;
//   · ADR-201 (2026-10-02): 25 rows per page loaded from the SERVER (was one
//     200-row fetch paged in the browser) — Overdue and the JC Status counts
//     are worked out on the server over ALL matching cards. Only a page's
//     worth of product-image thumbnails load at a time (each is one
//     signed-URL fetch, cached). The thumbnail is the Item Master PRODUCT
//     IMAGE (items.image_path), NOT the drawing (user decision 2026-09-21);
//     the old drawing-based PartThumb wrote a drawing_view audit row per row
//     shown, and the product image is not a controlled document;
//   · (the Open / In Progress / Completed / Overdue strip was removed on
//     2026-09-26 — owner's filter-bar decision; the counts now sit in the JC
//     Status dropdown labels, counted on the server — ADR-201);
//   · the Days Left colour rule — no date or done: muted · late: red ·
//     5 days or less: amber · otherwise green;
//   · the permission expressions: create = entry, edit = edit, delete = the
//     edit+approve pair only L5 Department Admin and above hold.
//
// JC STATUS COLOURS are now <StatusBadge kind="jc">, whose map
// (open grey · qc_pending amber · complete green · closed green · no_ops red)
// is the SAME map the local jc-status-badge.tsx carries, checked value by
// value — nothing about what a colour means has changed. That file stays: the
// Job Card detail view, the stat tiles and two Production Order screens still
// import it, and they are other screens' migrations.

import {
  JC_COMPUTED_STATUSES,
  type JcStatusCountsQuery,
  type JcStatusCountsResponse,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { usePendingEditIds } from '@/modules/document-edits/api';
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDeleteJobCard, useJcStatusCounts, useJobCardsList } from '../api';
import { JC_STATUS_LABEL } from '../components/jc-status-badge';
import { JcRowMenu } from '../components/jc-row-menu';
import { JC_LIST_HIDDEN_COLUMNS, jobCardListColumns } from '../components/jc-list-columns';
import { JcListFilters } from '../components/jc-list-filters';

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(JC_COMPUTED_STATUSES).optional(),
  /** "Overdue" in the Status dropdown — not a stored status: past its due
   *  date and not complete / closed. Filtered on the server (ADR-201). */
  overdue: z.boolean().optional(),
  machineId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: pageSearchParam,
});

/** Placeholder while the server counts load (labels show no numbers then). */
const NO_COUNTS: JcStatusCountsResponse = {
  all: 0,
  byStatus: { open: 0, qc_pending: 0, complete: 0, closed: 0, no_ops: 0 },
  overdue: 0,
};

export const jobCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards',
  validateSearch: listSearchSchema,
  component: JobCardsListPage,
});

function JobCardsListPage(): React.JSX.Element {
  const search = jobCardsListRoute.useSearch();
  const navigate = jobCardsListRoute.useNavigate();

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
    // "  IN-JC  26 " and "IN-JC 26" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on the search box: what is being delayed
    // is the URL write, and the box must show the keystroke at once. The
    // ListHeader box reports every keystroke into `searchInput`; this effect
    // is what waits 300ms before the route changes.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss cards. Every change goes back
  // to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.jobCardsList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const offset = pageOffset(search.page);
  const query: ListJobCardsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      overdue: search.overdue ? true : undefined,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [
      sf.param,
      search.search,
      search.status,
      search.overdue,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
      offset,
    ],
  );

  const { data, isLoading, isFetching, isError, error } = useJobCardsList(query);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: operatorsData } = useOperatorsList({ limit: 200, offset: 0 });
  const machines = machinesData?.machines ?? [];
  const operators = operatorsData?.operators ?? [];
  // Tier-driven, per department (jc_create sits in Production). Creating a Job
  // Card is `entry` (L2 Data Entry and up); Edit needs `edit` (L3+); Delete
  // needs the edit+approve pair only L5 Department Admin and above hold. The
  // last two used to be read inside JcRowWriteActions, which this file
  // replaced with <RowActions> — the expressions are carried over unchanged.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jc_create');
  const canWrite = perms.entry;
  const canEditJc = perms.edit;
  const canDeleteJc = perms.edit && perms.approve;
  const del = useDeleteJobCard();

  const today = todayIst();
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const filtered =
    sf.filtering ||
    !!search.search ||
    !!search.status ||
    !!search.overdue ||
    !!search.machineId ||
    !!search.operatorId ||
    !!search.fromDate ||
    !!search.toDate;
  const emptyText = filtered ? 'No Job Cards match.' : 'No Job Cards yet.';

  // Server paging (ADR-201): 25 cards a page, page in the URL.
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);

  // Status counts for the JC Status dropdown labels ("Open (40)") — the
  // owner's 2026-09-26 filter-bar decision replaced the Open / In Progress /
  // Completed / Overdue strip with these. Counted on the SERVER over EVERY
  // card matching the other filters and the search — without the status /
  // Overdue pick and without a JC Status ▾ filter, so picking "Closed" does
  // not turn every other option into "(0)" (ADR-201).
  const sfNoStatus = sf.paramWithout('status');
  const countQuery: JcStatusCountsQuery = useMemo(
    () => ({
      search: search.search,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      sf: sfNoStatus,
    }),
    [
      search.search,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
      sfNoStatus,
    ],
  );
  const { data: statusCounts } = useJcStatusCounts(countQuery);

  const setNav = (
    update: Partial<
      Pick<typeof search, 'status' | 'overdue' | 'machineId' | 'operatorId' | 'fromDate' | 'toDate'>
    >,
  ): void => {
    void navigate({
      search: (prev) => ({ ...prev, ...update, page: 1 }),
      replace: true,
    });
  };

  const filtersActive =
    sf.filtering ||
    searchInput.trim() !== '' ||
    search.status != null ||
    search.overdue === true ||
    search.machineId != null ||
    search.operatorId != null ||
    search.fromDate != null ||
    search.toDate != null;
  const clearFilters = (): void => {
    sf.clearFilters();
    setSearchInput('');
    void navigate({
      search: (prev) => ({
        ...prev,
        search: undefined,
        status: undefined,
        overdue: undefined,
        machineId: undefined,
        operatorId: undefined,
        fromDate: undefined,
        toDate: undefined,
        page: 1,
      }),
      replace: true,
    });
  };

  // ADR-202 — JC ids with a pending edit; their status cell reads "Draft".
  const draftIds = usePendingEditIds('JobCard');
  const columns = useMemo(
    () => jobCardListColumns(offset + 1, today, draftIds),
    [offset, today, draftIds],
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
      {/* The frozen header band: title, count, the create buttons AND the
          filter bar stay pinned while the list scrolls
          underneath, so the filters stay reachable. */}
      <ListHeader
        title="Job Cards"
        icon="▭"
        count={total}
        noun="job card"
        filterNote={
          search.overdue ? 'Overdue' : search.status ? JC_STATUS_LABEL[search.status] : undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., item code / name, customer, SO no.…"
        updating={isFetching && !isLoading}
        onClearFilters={clearFilters}
        filtersActive={filtersActive}
        filters={
          <JcListFilters
            status={search.status}
            overdue={search.overdue}
            machineId={search.machineId}
            operatorId={search.operatorId}
            fromDate={search.fromDate}
            toDate={search.toDate}
            machines={machines}
            operators={operators}
            statusCounts={statusCounts ?? NO_COUNTS}
            countsReady={statusCounts != null}
            setNav={setNav}
          />
        }
        tools={
          canWrite ? (
            <Link
              to="/job-cards/new"
              className="btn btn-ghost"
              title="JWSO only. Sales Order items: Planning → Production Order."
            >
              + New JWSO Job Card
            </Link>
          ) : null
        }
        primary={
          canWrite ? (
            <Link to="/planning" className="btn btn-primary">
              + Plan &amp; Create Job Card
            </Link>
          ) : null
        }
      />

      {isError ? (
        <>
          <PageState
            state="error"
            message={
              error instanceof Error ? error.message : 'Could not load Job Cards. Try again.'
            }
          />
          {/* A sort / filter the server refused is kept for the tab — offer the way out. */}
          {sf.param ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => sf.onChange({ sort: null, filters: {} })}
            >
              Clear Sort &amp; Filter
            </button>
          ) : null}
        </>
      ) : (
        // ── THE SHEET (ADR-199 fit table — the sole view) ────────────────────
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jobCardsList}
            sortFilterServer={sf}
            columns={columns}
            defaultHidden={[...JC_LIST_HIDDEN_COLUMNS]}
            rows={rows}
            loading={isLoading}
            emptyText={emptyText}
            onRowClick={(jc) => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
            frozen
            rowActionsWidth="1%"
            rowActions={(jc) => (
              <JcRowMenu
                jc={jc}
                canEdit={canEditJc}
                onDelete={canDeleteJc ? (): Promise<void> => del.mutateAsync(jc.id) : undefined}
                deleteDisabled={del.isPending}
                draft={draftIds.has(jc.id)}
              />
            )}
          />
        </Panel>
      )}

      {isError ? null : (
        <ListFooter
          total={total}
          noun="job card"
          page={search.page}
          pageSize={LIST_PAGE_SIZE}
          onPage={gotoPage}
        />
      )}
    </div>
  );
}
