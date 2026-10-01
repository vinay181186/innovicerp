// SO Costing list — mirror of legacy renderSOCosting (L17249). Per-SO Material
// + Outsource + Machine-Time cost. Row → detail. Read-only. All money comes
// from so-costing/service.ts (no LIMIT, so no silent cap) — nothing is summed
// in the browser.
//
// ADR-199 table standard (2026-10-01): the one ruled fit sheet <DataTable
// tableKey={TABLE_KEYS.soCosting}>. SO No. is the pinned first column; number /
// money columns are right-aligned (kind 'num'); the whole row opens the detail.
// Column sort + filter come from the table's own ▾ header menus (ADR-200).
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
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { inrFormat } from '@/lib/print/doc-print';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

export const soCostingListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-costing',
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
      render: (r) => (
        <Link
          to="/so-costing/$id"
          params={{ id: r.soId }}
          className="td-code"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {r.soNo}
        </Link>
      ),
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'lines',
      kind: 'num',
      header: 'Lines',
      render: (r) => r.lineCount,
    },
    {
      id: 'total_qty',
      kind: 'num',
      header: 'Total Qty',
      className: 'mono fw-700',
      render: (r) => r.totalQty,
    },
  ];

  if (!priceHidden) {
    cols.push({
      id: 'subtotal',
      kind: 'num',
      header: 'Subtotal',
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
        headColor: 'var(--blue2)',
        className: 'mono',
        filterValue: (r) => r.materialCost,
        render: (r) => moneyCell(r.materialCost, 'var(--blue2)'),
      },
      {
        id: 'outsource',
        kind: 'num',
        header: 'Outsource',
        headColor: 'var(--amber2)',
        className: 'mono',
        filterValue: (r) => r.outsourceCost,
        render: (r) => moneyCell(r.outsourceCost, 'var(--amber2)'),
      },
      {
        id: 'machine_time',
        kind: 'num',
        header: 'Machine Time',
        headColor: 'var(--cyan)',
        className: 'mono',
        filterValue: (r) => r.machineTimeCost,
        render: (r) => moneyCell(r.machineTimeCost, 'var(--cyan)'),
      },
      {
        id: 'total_cost',
        kind: 'num',
        header: 'Total Cost',
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
  const { data, isLoading, isFetching, isError, error } = useQuery<ListSoCostingResponse>({
    queryKey: ['so-costing'],
    queryFn: () => apiFetch<ListSoCostingResponse>('/so-costing'),
    staleTime: 30_000,
  });
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

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
  const columns = useMemo(() => soCostingColumns(priceHidden), [priceHidden]);

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
    <div>
      {header}
      <Panel bodyPadding="none">
        <DataTable<SoCostingRow>
          tableKey={TABLE_KEYS.soCosting}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.soId}
          loading={isLoading}
          empty={search.trim() ? 'No SOs match.' : 'No SOs yet.'}
          onRowClick={(r) => void navigate({ to: '/so-costing/$id', params: { id: r.soId } })}
        />
      </Panel>
      <ListFooter total={data.rows.length} shown={rows.length} noun="SO" />
    </div>
  );
}
