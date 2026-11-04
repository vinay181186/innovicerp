// SO/JWSO Planning (PL-4b, rebuilt 2026-09-17 for ADR-170).
//
// Two levels, one screen:
//   Level 1 — one row per open SO / JWSO LINE (ADR-268, components/line-list.tsx,
//             on the shared FIT table). A source dropdown in the header picks
//             what is listed; the search box narrows it. Click a row to open
//             its order.
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
// URL state: ?src=so|jw (absent = all), ?soId= (level 2), ?openPlan= (edit modal).
//
// ADR-201 (2026-10-02): level 1 shows 25 rows a page with Prev / Next (?page=).
// The SO / JWSO source, the search and Sort & Filter run on the server over
// every open line (GET /so-planning/lines, ADR-268); the header count is the
// server's total.
//
// ADR-203 (frozen header): level 1 is `page-fill` — the ONE table on screen
// fills the rest and is the only scrollbar. Level 2 is unchanged.

import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePlan } from '@/modules/plans/api';
import { soPlanningKeys, usePlanningLineList } from '../api';
import { EditPlanModal } from '../components/edit-plan-modal';
import { LineList } from '../components/line-list';
import { OrderDetail } from '../components/order-detail';
import { type ModalState, type SourceFilter, sourceNoun } from '../components/planning-shared';

const searchSchema = z.object({
  soId: z.string().uuid().optional(),
  openPlan: z.string().uuid().optional(),
  /** Which lines level 1 lists. Survives reload / Back. Absent = 'all'. */
  src: z.enum(['all', 'so', 'jw']).optional(),
  /** Level-1 page (ADR-201). */
  page: pageSearchParam,
});

export const soPlanningWorkflowRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning',
  validateSearch: searchSchema,
  component: PlanningWorkflowPage,
});

function PlanningWorkflowPage(): JSX.Element {
  const navigate = useNavigate();
  const { soId, openPlan, src: srcParam, page } = soPlanningWorkflowRoute.useSearch();
  const src: SourceFilter = srcParam ?? 'all';
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
  const setSrc = (s: SourceFilter): void => {
    void navigate({
      to: '/planning',
      search: (prev) => ({
        ...prev,
        src: s === 'all' ? undefined : s,
        soId: undefined,
        page: 1,
      }),
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
  // partial) across every column the row shows — over every open line, then
  // sends one 25-row page. The term goes 300 ms after typing stops, back to
  // page 1.
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => {
    const next = normalizeSearchTerm(soSearch);
    if (next === searchTerm) return;
    const id = window.setTimeout(() => {
      setSearchTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [soSearch, searchTerm, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.planningLineList, () => gotoPage(1));
  const lineList = usePlanningLineList(
    {
      src: src === 'all' ? undefined : src,
      search: searchTerm || undefined,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    },
    !soId,
  );
  useClampPage(page, soId ? undefined : lineList.data?.total, gotoPage);
  // Sr No follows the rows on screen: while the next page loads the old rows stay,
  // and must keep their old numbers.
  const shownOffset = useRef(pageOffset(page));
  if (!lineList.isPlaceholderData) shownOffset.current = pageOffset(page);
  const total = lineList.data?.total ?? 0;

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
            count={lineList.data ? total : undefined}
            noun={sourceNoun(src)}
            search={soSearch}
            onSearch={setSoSearch}
            searchPlaceholder="Search SO / JWSO No., POL, item code or name, customer, RC, PRO, JC…"
            updating={lineList.isFetching && !lineList.isLoading}
            filters={
              <select
                className="innovic-select"
                aria-label="Order source"
                title="Order source"
                value={src}
                onChange={(e) => {
                  const v = e.target.value;
                  setSrc(v === 'jw' ? 'jw' : v === 'so' ? 'so' : 'all');
                }}
              >
                <option value="all">All</option>
                <option value="so">SO</option>
                <option value="jw">JWSO</option>
              </select>
            }
            onClearFilters={() => {
              setSoSearch('');
              setSearchTerm('');
              sf.clearFilters();
              if (src !== 'all') setSrc('all');
              else gotoPage(1);
            }}
            filtersActive={soSearch !== '' || src !== 'all' || sf.filtering}
          />

          <LineList
            src={src}
            items={lineList.data?.items ?? []}
            firstRowNo={shownOffset.current + 1}
            loading={lineList.isLoading}
            error={lineList.error instanceof Error ? lineList.error.message : null}
            searching={searchTerm !== ''}
            onOpen={openOrder}
            sf={sf}
          />
          <ListFooter
            total={total}
            noun={sourceNoun(src)}
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
