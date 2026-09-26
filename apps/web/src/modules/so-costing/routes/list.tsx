// SO Costing list — mirror of legacy renderSOCosting (L17249). Per-SO Material
// + Outsource + Machine-Time cost. Row → detail. Read-only. All money comes
// from so-costing/service.ts (no LIMIT, so no silent cap) — nothing is summed
// in the browser.
//
// Legacy deltas kept deliberately:
//  - SO No is a <Link>; legacy L17286 makes the whole <tr> clickable via
//    onclick=_soCostDetail. Same destination — see ISSUE-017, which settled
//    this pattern (the link keeps middle-click / open-in-new-tab).
//  - Money renders 2dp via the shared inrFormat; legacy L17291-96 uses
//    toFixed(0) here but toFixed(2) on the detail, so legacy's own list and
//    detail disagree on the same figure. 2dp keeps them consistent.

import type { ListSoCostingResponse } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { inrFormat } from '@/lib/print/doc-print';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

export const soCostingListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-costing',
  component: SoCostingListPage,
});

const money = (v: number | null): string => (v != null && v > 0 ? `₹${inrFormat(v)}` : '—');

function SoCostingListPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useQuery<ListSoCostingResponse>({
    queryKey: ['so-costing'],
    queryFn: () => apiFetch<ListSoCostingResponse>('/so-costing'),
    staleTime: 30_000,
  });
  const [search, setSearch] = useState('');

  // The list is fetched whole (no LIMIT), so the search matches in the browser
  // across the text columns the row shows — SO no., customer, cost centre code
  // + name. Shared matcher: case-insensitive, partial.
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((r) =>
        matchesSearchTerm([r.soNo, r.customer, r.costCenter, r.costCenterName], search),
      ),
    [data?.rows, search],
  );

  // Money hidden for L1 Viewers: the API nulls every cost, so the 5 value
  // columns are dropped (Cost Center stays).
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;

  const header = (
    <ListHeader
      title="SO Costing"
      icon="💰"
      count={data ? rows.length : undefined}
      noun="SO"
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search SO no., customer, cost centre…"
      updating={isFetching && !isLoading}
    />
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <PageState state="loading" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div>
        {header}
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load SO costing. Try again.'}
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>SO No.</th>
                <th>Customer</th>
                <th className="th-num">Lines</th>
                <th className="th-num">Total Qty</th>
                {priceHidden ? null : (
                  <th className="th-num" style={{ color: 'var(--green2)' }}>
                    SO Value
                  </th>
                )}
                <th>Cost Centre</th>
                {priceHidden ? null : (
                  <>
                    <th className="th-num" style={{ color: 'var(--blue2)' }}>
                      Material
                    </th>
                    <th className="th-num" style={{ color: 'var(--amber2)' }}>
                      Outsource
                    </th>
                    <th className="th-num" style={{ color: 'var(--cyan)' }}>
                      Machine Time
                    </th>
                    <th className="th-num" style={{ color: 'var(--green2)' }}>
                      Total Cost
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 5 : 10} className="empty-state">
                    No SOs found
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.soId}>
                    <td className="mono fw-700" style={{ whiteSpace: 'nowrap' }}>
                      <Link
                        to="/so-costing/$id"
                        params={{ id: r.soId }}
                        style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                      >
                        {r.soNo}
                      </Link>
                    </td>
                    <td>{r.customer ?? '—'}</td>
                    <td className="td-num">{r.lineCount}</td>
                    <td className="mono fw-700 td-num">{r.totalQty}</td>
                    {priceHidden ? null : (
                      <td className="mono td-num" style={{ color: 'var(--green2)' }}>
                        {money(r.soValue)}
                      </td>
                    )}
                    <td style={{ fontSize: 11, color: 'var(--teal2)' }}>
                      {r.costCenter
                        ? `${r.costCenter}${r.costCenterName ? ` — ${r.costCenterName}` : ''}`
                        : '—'}
                    </td>
                    {priceHidden ? null : (
                      <>
                        <td className="mono td-num" style={{ color: 'var(--blue2)' }}>
                          {money(r.materialCost)}
                        </td>
                        <td className="mono td-num" style={{ color: 'var(--amber2)' }}>
                          {money(r.outsourceCost)}
                        </td>
                        <td className="mono td-num" style={{ color: 'var(--cyan)' }}>
                          {money(r.machineTimeCost)}
                        </td>
                        <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                          {money(r.totalCost)}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <ListFooter
        total={data.rows.length}
        shown={rows.length}
        noun="SO"
        hint="Click an SO for the line-level breakdown. Material = with-material POs, Outsource = job-work/OSP POs, Machine Time = cycle-time × completed × machine rate."
      />
    </div>
  );
}
