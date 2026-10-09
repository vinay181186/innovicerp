// JWSO Master list — ONE ROW PER JWSO on the shared FIT table (ADR-199:
// <DataTable tableKey=…>), the fit engine sizing columns to the screen and
// dropping the rightmost unpinned ones into a ▸ detail row when it is too narrow.
// Row click opens the JWSO; the ▸ reveals the JWSO's line items + remarks (own
// fetch, JwsoExpandedLines). Replaces the hand-built card list.
//
// Columns (first pinned): JWSO No. · JWSO Date · Customer · Client PO No. ·
// Order Qty · JC Qty · Dispatched · Pending · Customer Material · Due ·
// JWSO Status — see components/jwso-list-columns.tsx.
//
// Row actions (RowActions prop): Edit (edit tier) · Delete (edit+approve tier).
// Delete reuses the reason-required DeleteJwsoModal (ADR-197) unchanged.
//
// Row tint by overdue / status (rowClassName + ROW_TINT): overdue (open + past
// its earliest due) = late, closed / dispatched = done, cancelled = cancelled;
// draft and open carry no tint.
//
// NOT ported — the Client PO 📎 attachment link: JW carries no clientPoFilePath
// (SO does), so the link would need a DB column + upload route (ISSUE-031).

import {
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
  SO_STATUSES,
  type SoStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { usePendingEditIds } from '@/modules/document-edits/api';
import { SO_STATUS_LABEL } from '@/modules/sales-orders/lib/so-status-label';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useJobWorkOrdersList } from '../api';
import { DeleteJwsoModal } from '../components/delete-jwso-modal';
import { JwsoExpandedLines } from '../components/jwso-expanded-lines';
import { jwsoListColumns } from '../components/jwso-list-columns';

// 25 rows a page (ADR-201): only the page on screen is loaded; search, the
// status filter and Sort & Filter (▾) run on the server over every JWSO.

// JWSO status / overdue → row tint (ADR-199 ROW_TINT). Overdue (still open past
// its earliest due) reads as late and wins; closed and dispatched are done;
// cancelled is cancelled; draft and open stay untinted.
function rowTint(jw: JobWorkOrderListItem, today: string): string | undefined {
  if (jw.earliestDueDate != null && jw.earliestDueDate < today && jw.status === 'open') {
    return ROW_TINT.late;
  }
  if (jw.status === 'closed' || jw.status === 'dispatched') return ROW_TINT.done;
  if (jw.status === 'cancelled') return ROW_TINT.cancelled;
  return undefined;
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  page: pageSearchParam,
});

export const jobWorkOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders',
  validateSearch: listSearchSchema,
  component: JobWorkOrdersListPage,
});

function JobWorkOrdersListPage(): React.JSX.Element {
  const search = jobWorkOrdersListRoute.useSearch();
  const navigate = jobWorkOrdersListRoute.useNavigate();

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
    // "  IN-JW  00012 " and "IN-JW 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter on the SERVER (ADR-200): the list is paged, so filtering only
  // the loaded page would miss JWSOs. Every change goes back to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.jwsoList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const offset = pageOffset(search.page);
  const query: ListJobWorkOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [search.search, search.status, sf.param, offset],
  );

  const { data, isLoading, isFetching, isError, error } = useJobWorkOrdersList(query);
  // Access matrix (jw_create, dept Sales) replaces the old admin/manager flag.
  //   New JWSO -> entry; Edit -> edit; whole-JWSO delete -> edit AND approve.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const canCreate = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  const today = todayIst();

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row so a closed JWSO never fetches its lines.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The JWSO the Move-to-Trash dialog is asking about, or null when closed.
  const [trashTarget, setTrashTarget] = useState<{ id: string; code: string } | null>(null);

  // ADR-202 — JWSO ids with a pending edit; their status cell reads "Draft".
  const draftIds = usePendingEditIds('JobWorkOrder');
  const columns = useMemo(() => jwsoListColumns(today, draftIds), [today, draftIds]);

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage);

  // Row actions — Edit · Delete, with the gates the retired card used, unchanged.
  // No View button: the row click opens the JWSO. Delete reuses the
  // reason-required DeleteJwsoModal (ADR-197), so onDelete just opens it.
  const rowActions = (jw: JobWorkOrderListItem): React.JSX.Element => (
    <RowActions
      editTo={canEdit ? `/job-work-orders/${jw.jwId}/edit` : undefined}
      renderLink={(p) => <Link {...p} />}
      onDelete={canDelete ? () => setTrashTarget({ id: jw.jwId, code: jw.code }) : undefined}
    />
  );

  // Hide-page: a user whose VIEW was removed for JWSO Master sees the no-access
  // panel, not the list. `eff` undefined only while access loads — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  const emptyText =
    sf.filtering || search.search || search.status ? 'No JWSOs match.' : 'No JWSOs yet.';

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header stays on screen down
    // to the last row.
    <div className="page-fill">
      {/* The ONE list header (ui/layout ListHeader) — same URL params, same
          query as before; the status filter stays a select. */}
      <ListHeader
        title="JWSO Master"
        icon="🔧"
        count={total}
        noun="JWSO"
        filterNote={search.status ? SO_STATUS_LABEL[search.status] : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JWSO no., customer, client PO, part, item code…"
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="JWSO status"
            title="JWSO status"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as SoStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          >
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SO_STATUS_LABEL[s]}
              </option>
            ))}
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
        filtersActive={
          sf.filtering || search.search != null || search.status != null || searchInput !== ''
        }
        primary={
          canCreate ? (
            <Link to="/job-work-orders/new" className="btn btn-primary">
              + New JWSO
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load JWSOs. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jwsoList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={emptyText}
            rowKey={(jw) => jw.jwId}
            onRowClick={(jw) =>
              void navigate({ to: '/job-work-orders/$id', params: { id: jw.jwId } })
            }
            rowClassName={(jw) => rowTint(jw, today)}
            rowActions={(jw) => rowActions(jw)}
            // The lines are fetched only for a row that is actually open —
            // returning null for a collapsed row means JwsoExpandedLines (and
            // its detail query) never mounts for it.
            renderExpanded={(jw) =>
              expandedIds.has(jw.jwId) ? <JwsoExpandedLines jwId={jw.jwId} /> : null
            }
            // The fit table's ▸ is the row's one expand control: it opens the
            // line items too.
            onToggleExpanded={(jw) => toggleExpand(jw.jwId)}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="JWSO"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {trashTarget ? (
        <DeleteJwsoModal
          id={trashTarget.id}
          code={trashTarget.code}
          onClose={() => setTrashTarget(null)}
        />
      ) : null}
    </div>
  );
}
