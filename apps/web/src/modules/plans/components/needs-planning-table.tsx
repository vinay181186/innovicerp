// Needs Planning table — unplanned SO lines, shown on the Plans screen when the
// "Needs Planning" KPI tile is active. Folded in from the former Planning
// Dashboard (legacy renderPlanDashboard L10024–10041).
//
// PHASE 4 — migrated with the Plans list it lives inside: the hand-written
// <table>/<thead>, the three panel-wrapped state blocks and the bare search
// <input> are now Panel + DataTable + PageState + SearchInput. The local
// filter, the columns and the copy are unchanged. The Plan action sits in
// the row's ⋯ menu and opens Planning on that very order (?soId=).
//
// ADR-201 (2026-10-02): 25 lines a page with Prev / Next (page kept in this
// panel's state — it has no route of its own). The search and Sort & Filter
// run on the server over every unplanned line; the title count is the
// server's total.

import type { UnplannedOrderRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { SearchInput } from '@/ui/forms';
import { ListFooter, PageState } from '@/ui/layout';
import { useUnplannedOrders } from '../api';

export function NeedsPlanningTable(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  // The server searches the code AS DISPLAYED (CODE/REV), SO No., POL, item
  // name and customer — over every line, not just this page.
  useEffect(() => {
    const next = normalizeSearchTerm(search);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term]);
  const sf = useServerSortFilter(TABLE_KEYS.plansNeedsPlanning, () => setPage(1));
  const { data, isLoading, isError, error } = useUnplannedOrders(true, {
    search: term || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  const gotoPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, data?.total, gotoPage);
  const rows = data?.rows ?? ([] as UnplannedOrderRow[]);
  const total = data?.total ?? 0;
  // Planning writes need plan_create entry — a view-only user gets no Plan.
  const { data: eff } = useMyAccess();
  const canPlan = effectiveFormPerms(eff, 'plan_create').entry;

  // Widths are `%` (10+4+5+12+16+6+6+6+8+12 = 85); the fit engine sizes the
  // ⋯ column itself.
  const columns = useMemo<DataTableColumn<UnplannedOrderRow>[]>(
    () => [
      {
        id: 'so_code',
        sortFilterField: 'soCode',
        filterType: 'text',
        header: 'SO / JWSO No.',
        width: '10%',
        nowrap: true,
        render: (r) => (
          <Link to="/sales-orders/$id" params={{ id: r.soId }} className="td-code">
            {r.soCode}
          </Link>
        ),
      },
      {
        header: 'Ln',
        width: '4%',
        nowrap: true,
        key: 'lineNo',
        sortFilterField: 'lineNo',
        filterType: 'num',
      },
      {
        // POL — the CUSTOMER's own PO line number. Not the "Ln" column to its
        // left, which is OUR SO line number.
        id: 'client_po_line_no',
        sortFilterField: 'clientPoLineNo',
        filterType: 'text',
        header: 'POL',
        width: '5%',
        className: 'mono fw-700',
        headColor: 'var(--purple)',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
      },
      {
        // `CODE/REV` — the customer's drawing revision typed on this very SO
        // line. nowrap because a short code must never break across two lines.
        // The item code is the main thing on the row: mono, bold, full --text.
        id: 'item_code',
        sortFilterField: 'itemCode',
        filterType: 'text',
        header: 'Item Code',
        width: '12%',
        className: 'mono fw-700',
        nowrap: true,
        render: (r) => itemCodeWithRev(r.itemCode, r.itemRevision),
      },
      {
        id: 'part_name',
        sortFilterField: 'partName',
        filterType: 'text',
        header: 'Item Name',
        width: '16%',
        align: 'left',
        ellipsis: true,
        render: (r) => r.partName ?? '—',
        title: (r) => r.partName ?? '',
      },
      {
        header: 'Order Qty',
        sortFilterField: 'orderQty',
        filterType: 'num',
        width: '6%',
        align: 'right',
        className: 'mono fw-700',
        nowrap: true,
        key: 'orderQty',
      },
      {
        id: 'planned_qty',
        sortFilterField: 'plannedQty',
        filterType: 'num',
        header: 'Plan Qty',
        width: '6%',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => (
          <span style={{ color: 'var(--cyan)' }}>{r.plannedQty > 0 ? r.plannedQty : '—'}</span>
        ),
      },
      {
        id: 'remaining_qty',
        sortFilterField: 'remainingQty',
        filterType: 'num',
        header: 'To Plan',
        width: '6%',
        align: 'right',
        className: 'mono fw-700',
        headColor: 'var(--red)',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--red2)' }}>{r.remainingQty}</span>,
      },
      {
        id: 'due_date',
        sortFilterField: 'dueDate',
        kind: 'date',
        header: 'Due Date',
        width: '8%',
        className: 'mono',
        nowrap: true,
        render: (r) => fmtDate(r.dueDate),
      },
      {
        id: 'customer_name',
        sortFilterField: 'customerName',
        filterType: 'text',
        header: 'Customer',
        width: '12%',
        align: 'left',
        ellipsis: true,
        render: (r) => r.customerName ?? '—',
        title: (r) => r.customerName ?? '',
      },
    ],
    [],
  );

  return (
    <>
      <Panel
        fill
        bodyPadding="none"
        title={<span style={{ color: 'var(--red2)' }}>⚠ Needs Planning ({total} SO lines)</span>}
        actions={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search SO, item, customer…"
            aria-label="Search unplanned SO lines"
          />
        }
      >
        {isError ? (
          <PageState
            state="error"
            message={
              error instanceof Error ? error.message : 'Could not load unplanned orders. Try again.'
            }
          />
        ) : (
          <DataTable
            tableKey={TABLE_KEYS.plansNeedsPlanning}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.soLineId}
            loading={isLoading}
            sortFilterServer={sf}
            empty={
              <>
                <div className="empty-icon">✅</div>
                {term || sf.filtering ? 'No SO lines match.' : 'No SO lines to plan.'}
              </>
            }
            // The item's `to` carries ?soId=; Planning reads it as search, so
            // the link is built with `search` rather than a raw query string.
            renderLink={({ to, ...p }) => (
              <Link
                {...p}
                to="/planning"
                search={{
                  soId: new URLSearchParams(to.split('?')[1] ?? '').get('soId') ?? undefined,
                }}
              />
            )}
            rowMenu={(r) => [
              {
                key: 'plan',
                label: 'Plan',
                to: `/planning?soId=${r.soId}`,
                hidden: !canPlan,
              },
            ]}
          />
        )}
      </Panel>
      <ListFooter
        total={total}
        noun="SO line"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </>
  );
}
