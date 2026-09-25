// Needs Planning table — unplanned SO lines, shown on the Plans screen when the
// "Needs Planning" KPI tile is active. Folded in from the former Planning
// Dashboard (legacy renderPlanDashboard L10024–10041).
//
// PHASE 4 — migrated with the Plans list it lives inside: the hand-written
// <table>/<thead>, the three panel-wrapped state blocks and the bare search
// <input> are now Panel + DataTable + PageState + SearchInput. The local
// filter, the columns, the copy and the Plan button are unchanged.

import type { UnplannedOrderRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { SearchInput } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { useUnplannedOrders } from '../api';

export function NeedsPlanningTable(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useUnplannedOrders(true);

  const filtered = useMemo(() => {
    if (!data) return [] as UnplannedOrderRow[];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      // Searched on the code AS DISPLAYED, so typing "IN-IT-0007/B" finds the
      // row the planner is looking at. Empty fallback keeps the em dash out of
      // the haystack.
      `${r.soCode} ${r.clientPoLineNo ?? ''} ${itemCodeWithRev(r.itemCode, r.itemRevision, '')} ${r.partName ?? ''} ${r.customerName ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  // Widths are `%` and must sum to 100 WITH the Action column
  // (rowActionsWidth below): 10+4+5+12+16+6+6+6+8+12 = 85, + 15 = 100.
  const columns = useMemo<DataTableColumn<UnplannedOrderRow>[]>(
    () => [
      {
        header: 'SO / JWSO No.',
        width: '10%',
        nowrap: true,
        render: (r) => (
          <Link to="/sales-orders/$id" params={{ id: r.soId }} className="td-code">
            {r.soCode}
          </Link>
        ),
      },
      { header: 'Ln', width: '4%', nowrap: true, key: 'lineNo' },
      {
        // POL — the CUSTOMER's own PO line number. Not the "Ln" column to its
        // left, which is OUR SO line number.
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
        header: 'Item Code',
        width: '12%',
        className: 'mono fw-700',
        nowrap: true,
        render: (r) => itemCodeWithRev(r.itemCode, r.itemRevision),
      },
      {
        header: 'Item Name',
        width: '16%',
        align: 'left',
        ellipsis: true,
        render: (r) => r.partName ?? '—',
        title: (r) => r.partName ?? '',
      },
      { header: 'Order Qty', width: '6%', className: 'mono fw-700', nowrap: true, key: 'orderQty' },
      {
        header: 'Planned',
        width: '6%',
        className: 'mono',
        nowrap: true,
        render: (r) => (
          <span style={{ color: 'var(--cyan)' }}>{r.plannedQty > 0 ? r.plannedQty : '—'}</span>
        ),
      },
      {
        header: 'Pending',
        width: '6%',
        className: 'mono fw-700',
        headColor: 'var(--red)',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--red2)' }}>{r.remainingQty}</span>,
      },
      {
        header: 'Due Date',
        width: '8%',
        className: 'mono',
        nowrap: true,
        render: (r) => r.dueDate ?? '—',
      },
      {
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
    <Panel
      bodyPadding="none"
      title={
        <span style={{ color: 'var(--red2)' }}>
          ⚠ Needs Planning ({filtered.length}
          {data && filtered.length !== data.rows.length ? <> of {data.rows.length}</> : null} SO
          lines)
        </span>
      }
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
          message={error instanceof Error ? error.message : 'Failed to load unplanned orders'}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.soLineId}
          loading={isLoading}
          empty={
            <>
              <div className="empty-icon">✅</div>
              {data && data.rows.length === 0
                ? 'All SO lines are fully planned!'
                : 'No SO lines match your search.'}
            </>
          }
          rowActionsWidth="15%"
          rowActions={(r) => (
            // Not a View / Edit / Delete cluster — the one action an unplanned
            // line offers is to go and plan it.
            <Link to="/planning" className="btn btn-sm btn-primary">
              📋 Plan {r.remainingQty} pcs
            </Link>
          )}
        />
      )}
    </Panel>
  );
}
