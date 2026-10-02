// SO/JWSO Planning (PL-4b, rebuilt 2026-09-17 for ADR-170).
//
// Two levels, one screen:
//   Level 1 — the list of open orders (components/order-list.tsx, on the shared
//             FIT table). A SO | JWSO toggle in the header picks which source is
//             listed; the search box narrows it. Click a row to open the order.
//             While a term is typed, components/search-results.tsx shows every
//             matching LINE across the listed orders — also on the FIT table.
//   Level 2 — one order (components/order-detail.tsx): a compact header and ONE
//             table with EVERY line. Each row lists its plans as chips and
//             carries the "+ Plan" / BOM actions — the plan-create cascade, left
//             on its own fixed-layout table (it is not a plain list).
//
// "+ Plan" opens the Create Plan box (create-plan-modal.tsx): qty + remark,
// schedule, raw material — nothing else. The plan is stored with
// opsSource 'route_card'; operations come from the item's Route Card when a
// Production Order is raised. Old plans (opsSource 'plan') keep their Edit /
// Execute / View JC / PR links inside their chip.
//
// URL state: ?src=so|jw (toggle), ?soId= (level 2), ?openPlan= (edit modal).
//
// ADR-199 (table standard, 2026-10-01): the two list surfaces — the SO/JWSO list
// and the line-search results — now render on the shared FIT <DataTable>
// (TABLE_KEYS.planningList / .planningLineSearch). The file was split into the
// sibling components under ../components to stay under the 400-line rule.
//
// ADR-201 (2026-10-02): level 1 shows 25 orders a page with Prev / Next (?page=).
// The SO / JWSO source, the search and Sort & Filter run on the server over
// every open order; the header count is the server's total. The line search
// covers the orders on the page shown.
//
// ADR-203 (frozen header): level 1 is `page-fill` — the ONE table on screen
// fills the rest and is the only scrollbar. With no search the order list
// fills; while a term is set an "Orders | Matching lines" TabStrip appears
// (?tab=lines) and only the active tab's table renders. Level 2 is unchanged.

import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { usePlan } from '@/modules/plans/api';
import { soPlanningKeys, usePlanningSoList } from '../api';
import { EditPlanModal } from '../components/edit-plan-modal';
import { OrderDetail } from '../components/order-detail';
import { OrderList } from '../components/order-list';
import { SearchResults, useMatchingLines } from '../components/search-results';
import { type ModalState, type Source } from '../components/planning-shared';

const searchSchema = z.object({
  soId: z.string().uuid().optional(),
  openPlan: z.string().uuid().optional(),
  /** Which orders level 1 lists. Survives reload / Back. Default 'so'. */
  src: z.enum(['so', 'jw']).optional(),
  /** Level-1 page (ADR-201). */
  page: pageSearchParam,
  /** Level-1 tab while a search term is set (ADR-203); absent = Orders. */
  tab: z.enum(['orders', 'lines']).optional(),
});

export const soPlanningWorkflowRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning',
  validateSearch: searchSchema,
  component: PlanningWorkflowPage,
});

function PlanningWorkflowPage(): JSX.Element {
  const navigate = useNavigate();
  const {
    soId,
    openPlan,
    src: srcParam,
    page,
    tab: tabParam,
  } = soPlanningWorkflowRoute.useSearch();
  const src: Source = srcParam ?? 'so';
  const qc = useQueryClient();
  // Page + write gate (plan_create, Planning dept). Writes on this page (create
  // plan, edit, execute, BOM planning) live in the plans module; here we hide
  // their entry points by tier and hide the whole page if VIEW was removed.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  const [soSearch, setSoSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(
    openPlan ? { kind: 'edit', planId: openPlan } : { kind: 'none' },
  );
  // ?openPlan= deep link (from the Plans list): the edit modal needs only the
  // plan id, so it lives at page level and works on either level.
  const editingPlan = usePlan(modal.kind === 'edit' ? modal.planId : '');

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ to: '/planning', search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const setSrc = (s: Source): void => {
    void navigate({
      to: '/planning',
      search: (prev) => ({ ...prev, src: s, soId: undefined, page: 1 }),
      replace: true,
    });
  };
  const openOrder = (id: string): void => {
    void navigate({ to: '/planning', search: (prev) => ({ ...prev, soId: id }) });
  };
  const backToList = (): void => {
    void navigate({ to: '/planning', search: (prev) => ({ ...prev, soId: undefined }) });
  };
  const refreshPlanning = (): void => {
    void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
  };

  // The server filters by source and matches the term (case-insensitive,
  // partial) across every column the row shows plus the item code + part name
  // behind it — over every open order, then sends one 25-row page. The term
  // goes 300 ms after typing stops, back to page 1.
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => {
    const next = normalizeSearchTerm(soSearch);
    if (next === searchTerm) return;
    const id = window.setTimeout(() => {
      setSearchTerm(next);
      // Back to page 1; a cleared search also drops the Matching-lines tab, so
      // the next search opens on Orders (one navigate, no clash).
      void navigate({
        to: '/planning',
        search: (prev) => ({ ...prev, page: 1, ...(next === '' ? { tab: undefined } : {}) }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [soSearch, searchTerm, navigate]);
  const sf = useServerSortFilter(TABLE_KEYS.planningList, () => gotoPage(1));
  const soList = usePlanningSoList({
    src,
    search: searchTerm || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, soId ? undefined : soList.data?.total, gotoPage);
  const visibleSos = soList.data?.items ?? [];
  const total = soList.data?.total ?? 0;

  // Matching lines (ADR-203 tab): looked up only while a term is set on level 1,
  // so the tab can carry its count whichever tab is open.
  const searching = searchTerm !== '' && !soId;
  const match = useMatchingLines(searchTerm, searching ? visibleSos : []);
  const tab = searching && tabParam === 'lines' ? 'lines' : 'orders';
  // The term lives only in page state, so a Refresh starts with none: a
  // leftover ?tab=lines is dropped so the URL never names a tab not shown.
  useEffect(() => {
    if (searchTerm === '' && tabParam === 'lines') {
      void navigate({
        to: '/planning',
        search: (prev) => ({ ...prev, tab: undefined }),
        replace: true,
      });
    }
  }, [searchTerm, tabParam, navigate]);
  const setTab = (t: string): void => {
    void navigate({
      to: '/planning',
      search: (prev) => ({ ...prev, tab: t === 'lines' ? 'lines' : undefined }),
      replace: true,
    });
  };

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed sees the no-access panel, not the page. `eff` is undefined
  // only while access is still loading — don't block then.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // Level 1 is `page-fill` (ADR-202/203); level 2 keeps its own layout.
    <div className={soId ? undefined : 'page-fill'}>
      {soId ? (
        <OrderDetail
          soId={soId}
          perms={perms}
          modal={modal}
          setModal={setModal}
          onBack={backToList}
          onChanged={refreshPlanning}
        />
      ) : (
        <>
          {/* ── Level 1 header: the ONE list header (ui/layout ListHeader) —
              title · count, then the filter bar: client-side search · SO /
              JWSO source dropdown · Clear. ── */}
          <ListHeader
            title="SO/JWSO Planning"
            icon="📋"
            count={soList.data ? total : undefined}
            noun={src === 'jw' ? 'JWSO' : 'SO'}
            search={soSearch}
            onSearch={setSoSearch}
            searchPlaceholder="Search SO / JWSO No., customer, item code or name, due date, status…"
            updating={soList.isFetching && !soList.isLoading}
            filters={
              <select
                className="innovic-select"
                aria-label="Order source"
                title="Order source"
                value={src}
                onChange={(e) => setSrc(e.target.value === 'jw' ? 'jw' : 'so')}
              >
                <option value="so">SO</option>
                <option value="jw">JWSO</option>
              </select>
            }
            onClearFilters={() => {
              setSoSearch('');
              setSearchTerm('');
              sf.clearFilters();
              if (src !== 'so') setSrc('so');
              else gotoPage(1);
            }}
            filtersActive={soSearch !== '' || src !== 'so' || sf.filtering}
          />

          {searching ? (
            <TabStrip
              label="Planning search"
              tabs={[
                { key: 'orders', label: 'Orders', count: soList.data ? total : null },
                {
                  key: 'lines',
                  label: 'Matching lines',
                  count: match.anyLoading ? null : match.rows.length,
                },
              ]}
              activeKey={tab}
              onChange={setTab}
            />
          ) : null}

          {/* Only the active tab's table renders and fills. The pager stays
              under both: the matching lines are the lines of the orders on the
              page shown, so Next moves both. */}
          {tab === 'lines' ? (
            // The term's orders are still loading (or the list still shows the
            // last term's page): never claim "no lines match" yet.
            soList.isLoading || soList.isPlaceholderData ? (
              <PageState state="loading" message="Loading…" />
            ) : visibleSos.length > 0 ? (
              <SearchResults
                term={searchTerm}
                sos={visibleSos}
                totalOrders={total}
                onPick={openOrder}
                match={match}
              />
            ) : (
              <PageState state="empty" message={`No lines match “${searchTerm}”`} />
            )
          ) : (
            <OrderList
              src={src}
              items={visibleSos}
              loading={soList.isLoading}
              error={soList.error instanceof Error ? soList.error.message : null}
              onOpen={openOrder}
              sf={sf}
            />
          )}
          <ListFooter
            total={total}
            noun={src === 'jw' ? 'JWSO' : 'SO'}
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
        </>
      )}

      {modal.kind === 'edit' && editingPlan.data ? (
        <EditPlanModal
          plan={editingPlan.data}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refreshPlanning();
            void editingPlan.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
