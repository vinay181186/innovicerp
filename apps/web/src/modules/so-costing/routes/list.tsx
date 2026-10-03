// SO Costing list — mirror of legacy renderSOCosting (L17249). Per-SO Material
// + Outsource + Machine-Time cost. Row → detail. Read-only. All money comes
// from so-costing/service.ts (25-row server pages; search / ▾ run on the server over ALL SOs) — nothing is summed
// in the browser.
//
// ADR-199 table standard (2026-10-01): the one ruled fit sheet <DataTable
// tableKey={TABLE_KEYS.soCosting}>. SO No. is the pinned first column; number /
// money columns are right-aligned (kind 'num'); the whole row opens the detail.
//
// ADR-201 (2026-10-02): 25 SOs a page. The search, Sort & Filter (▾ — server
// mode, so-costing/list-service.ts SO_COSTING_SF_COLUMNS) and the page run on
// the SERVER over every SO (search + page in the URL; any change → page 1).
//
// Legacy deltas kept deliberately:
//  - SO No is a <Link>; the whole row is also clickable to the same detail (see
//    ISSUE-017 — the link keeps middle-click / open-in-new-tab).
//  - Money renders 2dp via the shared inrFormat so the list and the detail agree.
//
// There is no SO Type / status column: the so-costing contract
// (ListSoCostingResponse.rows) carries neither, so none is invented here, and
// there is no real status to tint a "done" row by.

import type { ListSoCostingResponse, SoCostingRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { inrFormat } from '@/lib/print/doc-print';
import { soNoWithInternal } from '@/lib/so-number';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

export const soCostingListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-costing',
  validateSearch: z.object({ q: z.string().optional(), page: pageSearchParam }),
  component: SoCostingListPage,
});

const money = (v: number | null): string => (v != null && v > 0 ? `₹${inrFormat(v)}` : '—');

/** A right-aligned money cell in the colour its header carries. */
function moneyCell(v: number | null, color: string, bold = false): React.JSX.Element {
  return <span style={{ color, fontWeight: bold ? 700 : undefined }}>{money(v)}</span>;
}

function soCostingColumns(priceHidden: boolean): DataTableColumn<SoCostingRow>[] {
  const cols: DataTableColumn<SoCostingRow>[] = [
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      nowrap: true,
      sortFilterField: 'soNo',
      render: (r) => (
        <Link
          to="/so-costing/$id"
          params={{ id: r.soId }}
          className="td-code"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {soNoWithInternal(r.soNo, r.soInternalNo)}
        </Link>
      ),
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      sortFilterField: 'customer',
      ellipsis: true,
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'lines',
      kind: 'num',
      header: 'Lines',
      sortFilterField: 'lines',
      render: (r) => r.lineCount,
    },
    {
      id: 'total_qty',
      kind: 'num',
      header: 'Total Qty',
      sortFilterField: 'totalQty',
      className: 'mono fw-700',
      render: (r) => r.totalQty,
    },
  ];

  if (!priceHidden) {
    cols.push({
      id: 'subtotal',
      kind: 'num',
      header: 'Subtotal',
      sortFilterField: 'subtotal',
      headColor: 'var(--green2)',
      className: 'mono',
      filterValue: (r) => r.soValue,
      render: (r) => moneyCell(r.soValue, 'var(--green2)'),
    });
  }

  cols.push({
    id: 'cost_center',
    kind: 'code',
    header: 'Cost Centre',
    sortFilterField: 'costCenter',
    className: 'text2',
    filterValue: (r) => r.costCenter,
    render: (r) => (
      <span style={{ fontSize: 11, color: 'var(--teal2)' }}>
        {r.costCenter ? `${r.costCenter}${r.costCenterName ? ` — ${r.costCenterName}` : ''}` : '—'}
      </span>
    ),
  });

  if (!priceHidden) {
    cols.push(
      {
        id: 'material',
        kind: 'num',
        header: 'Material',
        sortFilterField: 'material',
        headColor: 'var(--blue2)',
        className: 'mono',
        filterValue: (r) => r.materialCost,
        render: (r) => moneyCell(r.materialCost, 'var(--blue2)'),
      },
      {
        id: 'outsource',
        kind: 'num',
        header: 'Outsource',
        sortFilterField: 'outsource',
        headColor: 'var(--amber2)',
        className: 'mono',
        filterValue: (r) => r.outsourceCost,
        render: (r) => moneyCell(r.outsourceCost, 'var(--amber2)'),
      },
      {
        id: 'machine_time',
        kind: 'num',
        header: 'Machine Time',
        sortFilterField: 'machineTime',
        headColor: 'var(--cyan)',
        className: 'mono',
        filterValue: (r) => r.machineTimeCost,
        render: (r) => moneyCell(r.machineTimeCost, 'var(--cyan)'),
      },
      {
        id: 'total_cost',
        kind: 'num',
        header: 'Total Cost',
        sortFilterField: 'totalCost',
        headColor: 'var(--green2)',
        className: 'mono fw-700',
        filterValue: (r) => r.totalCost,
        render: (r) => moneyCell(r.totalCost, 'var(--green2)', true),
      },
    );
  }

  return cols;
}

function SoCostingListPage(): React.JSX.Element {
  const urlSearch = soCostingListRoute.useSearch();
  const routeNavigate = soCostingListRoute.useNavigate();
  const navigate = useNavigate();
  const gotoPage = useCallback(
    (p: number) => void routeNavigate({ search: (s) => ({ ...s, page: p }) }),
    [routeNavigate],
  );

  // Typed search → URL after a short pause; the server matches SO no.,
  // customer, cost centre code + name over EVERY SO (page 1).
  const [search, setSearch] = useState(urlSearch.q ?? '');
  useEffect(() => {
    setSearch((prev) =>
      normalizeSearchTerm(prev) === (urlSearch.q ?? '') ? prev : (urlSearch.q ?? ''),
    );
  }, [urlSearch.q]);
  useEffect(() => {
    const t = normalizeSearchTerm(search);
    const next = t === '' ? undefined : t;
    if (next === urlSearch.q) return;
    const id = window.setTimeout(() => {
      void routeNavigate({ search: (p) => ({ ...p, q: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, urlSearch.q, routeNavigate]);

  const sf = useServerSortFilter(TABLE_KEYS.soCosting, () => {
    void routeNavigate({ search: (p) => ({ ...p, page: 1 }), replace: true });
  });
  const offset = pageOffset(urlSearch.page);
  const qs = useMemo(() => {
    const q = new URLSearchParams();
    if (urlSearch.q) q.set('search', urlSearch.q);
    if (sf.param) q.set('sf', sf.param);
    q.set('limit', String(LIST_PAGE_SIZE));
    q.set('offset', String(offset));
    return q.toString();
  }, [urlSearch.q, sf.param, offset]);
  const { data, isLoading, isFetching, isError, error } = useQuery<ListSoCostingResponse>({
    queryKey: ['so-costing', 'list', qs],
    queryFn: () => apiFetch<ListSoCostingResponse>(`/so-costing?${qs}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  useClampPage(urlSearch.page, data?.total, gotoPage);
  const rows = data?.rows ?? [];

  // Money hidden for L1 Viewers: the API nulls every cost, so the 5 value
  // columns are dropped (Cost Center stays).
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;
  const columns = useMemo(() => soCostingColumns(priceHidden), [priceHidden]);

  const header = (
    <ListHeader
      title="SO Costing"
      icon="💰"
      count={data ? data.total : undefined}
      noun="SO"
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search SO no., customer, cost centre…"
      updating={isFetching && !isLoading}
    />
  );

  if (isError || !data) {
    return (
      <div>
        {header}
        {isLoading ? (
          <PageState state="loading" />
        ) : (
          <PageState
            state="error"
            message={
              error instanceof Error ? error.message : 'Could not load SO costing. Try again.'
            }
          />
        )}
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header stays on screen down
    // to the last row.
    <div className="page-fill">
      {header}
      <Panel fill bodyPadding="none">
        <DataTable<SoCostingRow>
          tableKey={TABLE_KEYS.soCosting}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.soId}
          loading={isLoading}
          sortFilterServer={sf}
          empty={search.trim() || sf.filtering ? 'No SOs match.' : 'No SOs yet.'}
          onRowClick={(r) => void navigate({ to: '/so-costing/$id', params: { id: r.soId } })}
        />
      </Panel>
      <ListFooter
        total={data.total}
        noun="SO"
        page={urlSearch.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
