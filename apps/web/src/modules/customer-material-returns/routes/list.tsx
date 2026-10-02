// Customer Material Return register (ADR-203, owner decision D3) — the
// numbered challans (IN-CMR-#####) that send the customer's OWN raw material
// back: spare good material and pieces Incoming QC rejected on a Party GRN.
// Store department, gated by party_create.
//
// Built on the Party GRN list's pattern: ListHeader band, the shared FIT
// DataTable (ADR-199) with server Sort & Filter (ADR-200), 25 rows a page from
// the server (ADR-201), ▸ expand for the lines + History, row ⋯ for Print and
// Cancel. The search term lives in the `search` URL param (survives refresh
// and Back), mirrored by the box, debounced back with replace + page 1 — the
// SO Master shape. No detail page, so a row is not clickable.

import type { CustomerMaterialReturn } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useCustomerMaterialReturnsList } from '../api';
import { CancelCmrModal } from '../components/cancel-cmr-modal';
import { cmrColumns } from '../components/cmr-columns';
import { CmrExpand } from '../components/cmr-expand';
import { NewCmrModal } from '../components/new-cmr-modal';
import { usePrintCmr } from '../components/use-print-cmr';

/** The fit table's saved-layout key (kebab-case, stable — never rename). */
const CMR_TABLE_KEY = 'customer-material-returns';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const customerMaterialReturnsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-material-returns',
  validateSearch: searchSchema,
  component: CustomerMaterialReturnsListPage,
});

function CustomerMaterialReturnsListPage(): React.JSX.Element {
  // party_create (Store): + New Return -> entry; Cancel -> edit AND approve
  // (reverses stock, so only the tiers that hold both — as Party GRN Cancel).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canCreate = perms.entry;
  const canCancel = perms.edit && perms.approve;

  const routeSearch = customerMaterialReturnsListRoute.useSearch();
  const navigate = customerMaterialReturnsListRoute.useNavigate();
  const page = routeSearch.page;

  const [searchInput, setSearchInput] = useState(routeSearch.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link).
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (routeSearch.search ?? '') ? prev : (routeSearch.search ?? ''),
    );
  }, [routeSearch.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === routeSearch.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, routeSearch.search, navigate]);

  const setPage = useCallback(
    (p: number) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  // Sort & Filter on the SERVER (ADR-200); any change goes back to page 1.
  const sf = useServerSortFilter(CMR_TABLE_KEY, () => setPage(1));

  const { data, isLoading, isFetching, isError, error } = useCustomerMaterialReturnsList({
    ...(routeSearch.search ? { search: routeSearch.search } : {}),
    ...(sf.param ? { sf: sf.param } : {}),
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));
  const rows = data?.items ?? [];
  const columns = useMemo(() => cmrColumns(), []);

  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<CustomerMaterialReturn | null>(null);
  const printCmr = usePrintCmr();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "Hide page" (Access Control): once access has loaded, no VIEW → no page.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Customer Material Returns. Ask an admin.
      </div>
    );
  }

  return (
    <div className="page-fill">
      <ListHeader
        title="Customer Material Return"
        icon="📤"
        count={data?.total}
        noun="return"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search return no., JWSO, customer, vehicle no.…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
        }}
        filtersActive={sf.filtering || searchInput !== ''}
        primary={
          canCreate ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Return
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error
              ? error.message
              : 'Could not load customer material returns. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={CMR_TABLE_KEY}
            sortFilterServer={sf}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            emptyText={
              routeSearch.search || sf.filtering
                ? 'No Customer Material Returns match.'
                : 'No Customer Material Returns yet.'
            }
            rowClassName={(r) => (r.status === 'cancelled' ? ROW_TINT.cancelled : undefined)}
            renderExpanded={(r) => (expanded.has(r.id) ? <CmrExpand r={r} /> : null)}
            onToggleExpanded={(r) => toggleExpand(r.id)}
            rowMenu={(r) => [
              {
                key: 'print',
                label: 'Print',
                icon: 'printer',
                hidden: r.status === 'cancelled',
                onSelect: () => printCmr(r.id),
              },
              {
                key: 'cancel',
                label: 'Cancel Return',
                icon: 'x',
                group: 'danger',
                hidden: !canCancel,
                disabledReason: r.status === 'cancelled' ? 'Already Cancelled' : undefined,
                onSelect: () => setCancelRow(r),
              },
            ]}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="return"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showModal && canCreate ? (
        <NewCmrModal onClose={() => setShowModal(false)} onPrint={printCmr} />
      ) : null}
      {cancelRow ? <CancelCmrModal row={cancelRow} onClose={() => setCancelRow(null)} /> : null}
    </div>
  );
}
