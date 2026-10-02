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
// ADR-199 (table-standard round): the Card View and the List/Card ViewToggle
// were retired — the fit table is the only view now, so the per-browser view
// memory and its localStorage key are gone too. Priority, Production Order No.,
// Pending, Ops, Running and Remarks (the card's extra facts) now ride the fit
// table as OFF-by-default columns (`defaultHidden`); the user turns them on from
// the Columns menu and they show in the ▸ detail row meanwhile. The filter
// controls live in components/jc-list-filters.tsx (kept this file under the cap).
//
// WHAT DID NOT CHANGE — this screen is the shop floor's board and every rule
// below is how the board is read:
//   · the route, its six search params and `page`; the 300ms debounce on the
//     URL write; normalizeSearchTerm; every filter writing page: 1;
//   · one fetch capped at 200, then CLIENT-SIDE paging at PAGE_SIZE — so only
//     a page's worth of product-image thumbnails load at a time (each is one
//     signed-URL fetch, cached). The thumbnail is the Item Master PRODUCT
//     IMAGE (items.image_path), NOT the drawing (user decision 2026-09-21);
//     the old drawing-based PartThumb wrote a drawing_view audit row per row
//     shown, and the product image is not a controlled document;
//   · (the Open / In Progress / Completed / Overdue strip was removed on
//     2026-09-26 — owner's filter-bar decision; the counts now sit in the JC
//     Status dropdown labels, still counting the LOADED list);
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
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDeleteJobCard, useJobCardsList } from '../api';
import { JC_STATUS_LABEL } from '../components/jc-status-badge';
import { JcRowMenu } from '../components/jc-row-menu';
import { JC_LIST_HIDDEN_COLUMNS, jobCardListColumns } from '../components/jc-list-columns';
import { JcListFilters } from '../components/jc-list-filters';

// One fetch, cap 200 (mirrors the SO/WO list).
const LIST_LIMIT = 200;
// One page = the whole loaded list (user, 2026-09-21: the sheet scrolls, no
// Prev / Next). The image badges lazy-load, so a long page costs nothing until
// a row is scrolled into view; the pager below still exists and simply never
// shows while everything fits one page.
const PAGE_SIZE = 200;

/** Late and unfinished — the Overdue filter and the Days Left colour rule. */
function isOverdueJc(jc: JobCardListItem, today: string): boolean {
  return (
    jc.dueDate != null &&
    jc.dueDate < today &&
    jc.computedStatus !== 'closed' &&
    jc.computedStatus !== 'complete'
  );
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(JC_COMPUTED_STATUSES).optional(),
  /** "Overdue" in the Status dropdown — not a stored status: past its due
   *  date and not complete / closed. Filtered on the loaded set. */
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
  page: z.coerce.number().int().positive().default(1),
});

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

  const query: ListJobCardsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [
      search.search,
      search.status,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
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
  const rows = useMemo(() => {
    const loaded = data?.items ?? [];
    return search.overdue ? loaded.filter((jc) => isOverdueJc(jc, today)) : loaded;
  }, [data?.items, search.overdue, today]);
  // Overdue is filtered in the browser, so its total is the rows shown.
  const total = search.overdue ? rows.length : (data?.total ?? 0);
  const filtered =
    !!search.search ||
    !!search.status ||
    !!search.overdue ||
    !!search.machineId ||
    !!search.operatorId ||
    !!search.fromDate ||
    !!search.toDate;
  const emptyText = filtered ? 'No Job Cards match.' : 'No Job Cards yet.';

  // Client-side pagination for the sheet. Keeps each page to PAGE_SIZE rows so
  // only a page's worth of thumbnails load.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(search.page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const gotoPage = (p: number): void => {
    void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
  };

  // Status counts for the JC Status dropdown labels ("Open (40)") — the
  // owner's 2026-09-26 filter-bar decision replaced the Open / In Progress /
  // Completed / Overdue strip with these. Counted over the list loaded WITHOUT
  // the status filter (every other filter and the search still apply), so
  // picking "Closed" does not turn every other option into "(0)". While no
  // status is picked this is the very same query as the list — one fetch,
  // shared cache entry. Like the old strip, it counts the LOADED set (cap 200).
  const countQuery: ListJobCardsQuery = useMemo(() => ({ ...query, status: undefined }), [query]);
  const { data: countData } = useJobCardsList(countQuery);
  const statusCounts = useMemo(() => {
    const c: Record<JcComputedStatus, number> = {
      open: 0,
      qc_pending: 0,
      complete: 0,
      closed: 0,
      no_ops: 0,
    };
    let overdue = 0;
    for (const jc of countData?.items ?? []) {
      c[jc.computedStatus] += 1;
      if (isOverdueJc(jc, today)) overdue += 1;
    }
    return { all: countData?.items.length ?? 0, byStatus: c, overdue };
  }, [countData?.items, today]);
  const countsReady = countData != null;

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
    searchInput.trim() !== '' ||
    search.status != null ||
    search.overdue === true ||
    search.machineId != null ||
    search.operatorId != null ||
    search.fromDate != null ||
    search.toDate != null;
  const clearFilters = (): void => {
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

  const columns = useMemo(
    () => jobCardListColumns((currentPage - 1) * PAGE_SIZE + 1, today),
    [currentPage, today],
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
            statusCounts={statusCounts}
            countsReady={countsReady}
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
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load Job Cards. Try again.'}
        />
      ) : (
        // ── THE SHEET (ADR-199 fit table — the sole view) ────────────────────
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jobCardsList}
            columns={columns}
            defaultHidden={[...JC_LIST_HIDDEN_COLUMNS]}
            rows={pagedRows}
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
              />
            )}
          />
        </Panel>
      )}

      {isError ? null : (
        <ListFooter
          // Scroll mode while everything fits one page — which it always does
          // while PAGE_SIZE equals the fetch cap — so the count line still
          // warns when the server truncated the set. The pager only appears if
          // the loaded list ever outgrows a page, and then the totals it
          // divides are the LOADED rows, not the server's count.
          total={totalPages > 1 ? rows.length : total}
          shown={rows.length}
          noun="job card"
          limit={LIST_LIMIT}
          // Overdue is picked from the loaded set; when the server matched
          // more than LIST_LIMIT cards, say so — otherwise the filtered count
          // (always ≤ the cap) would hide that later overdue cards are missing.
          {...(search.overdue && (data?.total ?? 0) > LIST_LIMIT
            ? {
                hint: `Overdue is checked in the first ${LIST_LIMIT} of ${data?.total ?? 0} job cards loaded — narrow with search, machine, operator or dates to see all of them.`,
              }
            : {})}
          {...(totalPages > 1 ? { page: currentPage, pageSize: PAGE_SIZE, onPage: gotoPage } : {})}
        />
      )}
    </div>
  );
}
