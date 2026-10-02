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

import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader, PageState } from '@/ui/layout';
import { usePlan } from '@/modules/plans/api';
import { soPlanningKeys, usePlanningSoList } from '../api';
import { EditPlanModal } from '../components/edit-plan-modal';
import { OrderDetail } from '../components/order-detail';
import { OrderList } from '../components/order-list';
import { SearchResults } from '../components/search-results';
import { ORDER_STATUS_LABEL, type ModalState, type Source } from '../components/planning-shared';

const searchSchema = z.object({
  soId: z.string().uuid().optional(),
  openPlan: z.string().uuid().optional(),
  /** Which orders level 1 lists. Survives reload / Back. Default 'so'. */
  src: z.enum(['so', 'jw']).optional(),
});

export const soPlanningWorkflowRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning',
  validateSearch: searchSchema,
  component: PlanningWorkflowPage,
});

function PlanningWorkflowPage(): JSX.Element {
  const navigate = useNavigate();
  const { soId, openPlan, src: srcParam } = soPlanningWorkflowRoute.useSearch();
  const src: Source = srcParam ?? 'so';
  const soList = usePlanningSoList();
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

  const setSrc = (s: Source): void => {
    void navigate({
      to: '/planning',
      search: (prev) => ({ ...prev, src: s, soId: undefined }),
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

  // Client-side filter over the already-loaded list (it is fetched whole — it
  // scrolls, it does not page): the toggle picks the source, then the shared
  // matcher narrows within it — case-insensitive, partial, across every column
  // the row shows plus the item code + part name text behind it.
  const searchTerm = normalizeSearchTerm(soSearch);
  const visibleSos = useMemo(
    () =>
      (soList.data?.items ?? []).filter(
        (so) =>
          so.source === src &&
          matchesSearchTerm(
            [
              so.soCode,
              so.customerName,
              so.soType,
              so.dueDate,
              ORDER_STATUS_LABEL[so.planningStatus],
              so.itemsText,
            ],
            soSearch,
          ),
      ),
    [soList.data, src, soSearch],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed sees the no-access panel, not the page. `eff` is undefined
  // only while access is still loading — don't block then.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
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
            count={soList.data ? visibleSos.length : undefined}
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
              if (src !== 'so') setSrc('so');
            }}
            filtersActive={soSearch !== '' || src !== 'so'}
          />

          <OrderList
            src={src}
            items={visibleSos}
            loading={soList.isLoading}
            error={soList.error instanceof Error ? soList.error.message : null}
            onOpen={openOrder}
          />

          {/* Cross-order line search: while a term is typed, every LINE the
              term hits across the listed orders, under the order list. */}
          {searchTerm !== '' && visibleSos.length > 0 ? (
            <SearchResults term={searchTerm} sos={visibleSos} onPick={openOrder} />
          ) : null}
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
