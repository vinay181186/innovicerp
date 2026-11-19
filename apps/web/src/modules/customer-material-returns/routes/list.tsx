// Customer Material Return register (ADR-203, owner decision D3) — the
// numbered challans (IN-CMR-#####) that send the customer's OWN raw material
// back: spare good material and pieces Incoming QC rejected on a Party GRN.
// Store department, gated by party_create.
//
// Built on the Party GRN list's pattern: ListHeader band, the shared FIT
// DataTable (ADR-199) with server Sort & Filter (ADR-200), 25 rows a page from
// the server (ADR-201), row ⋯ for Print and Cancel. ADR-303: ONE ROW PER
// RETURN (GET /customer-material-returns; the /lines endpoint stays for other
// readers); no under-row panel (ADR-294) — Remarks and the lines are on the
// return's print (⋯ Preview); the count is returns. The search
// term lives in the `search` URL param (survives refresh
// and Back), mirrored by the box, debounced back with replace + page 1 — the
// SO Master shape. No detail page, so a row is not clickable.

import { Icon } from '@/ui/core';
import type { CustomerMaterialReturn } from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { OrderSfFilter } from '@/modules/order-options/components/order-sf-filter';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useCustomerMaterialReturnsList } from '../api';
import { cmrColumns } from '../components/cmr-columns';
import { usePrintCmr } from '../components/use-print-cmr';
import { cmrExportSpec } from '../lib/export';

/** The fit table's saved-layout key (kebab-case, stable — never rename). */
const CMR_TABLE_KEY = 'customer-material-returns-doc'; // ADR-303: new key, one row per document

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
  // party_create (Store): + New Return -> entry; Cancel Return -> Edit OR
  // Approve (ADR-235, the ONE standard Cancel: Edit requests, Approve decides).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canCreate = perms.entry;
  const canCancel = perms.edit || perms.approve;

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
  const columns = useMemo(() => cmrColumns(pageOffset(page) + 1), [page]);
  // ADR-310 — the shared Export: every row matching the search / filters /
  // Sort & Filter, in the columns the user sees.
  const exportSpec = useMemo(
    () =>
      cmrExportSpec({
        columns,
        tableKey: CMR_TABLE_KEY,
        search: routeSearch.search,
        sfParam: sf.param,
        hideMoney: !perms.price,
      }),
    [columns, routeSearch.search, sf.param, perms.price],
  );

  const [cancelRow, setCancelRow] = useState<CustomerMaterialReturn | null>(null);
  const printCmr = usePrintCmr();

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
        exportSpec={exportSpec}
        orderFilter={<OrderSfFilter sf={sf} field="jwCode" kind="jwso" />}
        title="Customer Material Return"
        icon="📤"
        count={data?.total}
        noun="return"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search return no., JWSO, POL, item code, customer, vehicle no.…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
        }}
        filtersActive={sf.filtering || searchInput !== ''}
        primary={
          canCreate ? (
            <Link to="/customer-material-returns/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Return
            </Link>
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
            rowMenu={(r) => [
              {
                key: 'preview',
                label: 'Preview',
                icon: 'eye',
                onSelect: () => printCmr.preview(r.id, r.code),
              },
              {
                key: 'download',
                label: 'Download PDF',
                icon: 'download',
                onSelect: () => printCmr.download(r.id, r.code),
              },
              {
                key: 'cancel',
                label: 'Cancel Return',
                icon: 'x',
                group: 'danger',
                hidden: !canCancel || r.status === 'cancelled',
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

      {cancelRow ? (
        <CancelDocDialog
          docType="customer_material_return"
          docId={cancelRow.id}
          docCode={cancelRow.code}
          onClose={() => setCancelRow(null)}
        />
      ) : null}
    </div>
  );
}
