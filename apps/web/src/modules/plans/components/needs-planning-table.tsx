// Needs Planning table — unplanned SO lines, shown on the Plans screen when the
// "Needs Planning" KPI tile is active. Folded in from the former Planning
// Dashboard (legacy renderPlanDashboard L10024–10041).

import type { UnplannedOrderRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useUnplannedOrders } from '../api';

export function NeedsPlanningTable(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useUnplannedOrders(true);

  const filtered = useMemo(() => {
    if (!data) return [] as UnplannedOrderRow[];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      `${r.soCode} ${r.itemCode ?? ''} ${r.partName ?? ''} ${r.customerName ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title" style={{ color: 'var(--red)' }}>
          ⚠ Needs Planning ({filtered.length}
          {data && filtered.length !== data.rows.length ? <> of {data.rows.length}</> : null} SO lines)
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search SO, item, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220, fontSize: 12 }}
          />
        </div>
      </div>
      {isLoading ? (
        <div className="panel-body">
          <div className="text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading unplanned orders…
          </div>
        </div>
      ) : isError ? (
        <div className="panel-body">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load unplanned orders'}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            {data && data.rows.length === 0
              ? 'All SO lines are fully planned!'
              : 'No SO lines match your search.'}
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO/JW</th>
                <th className="td-ctr">Line</th>
                <th>Item</th>
                <th>Part Name</th>
                <th className="td-ctr">SO Qty</th>
                <th className="td-ctr">Planned</th>
                <th className="td-ctr" style={{ color: 'var(--red)' }}>
                  Remaining
                </th>
                <th>Due Date</th>
                <th>Customer</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.soLineId}>
                  <td>
                    <Link
                      to="/sales-orders/$id"
                      params={{ id: r.soId }}
                      className="td-code"
                      style={{ color: 'var(--cyan)', fontWeight: 600 }}
                    >
                      {r.soCode}
                    </Link>
                  </td>
                  <td className="td-ctr">{r.lineNo}</td>
                  <td>
                    <span style={{ color: 'var(--purple)', fontWeight: 600 }}>{r.itemCode ?? '—'}</span>
                  </td>
                  <td>{r.partName ?? '—'}</td>
                  <td className="td-ctr" style={{ fontWeight: 700 }}>
                    {r.orderQty}
                  </td>
                  <td className="td-ctr" style={{ color: 'var(--cyan)' }}>
                    {r.plannedQty > 0 ? r.plannedQty : '—'}
                  </td>
                  <td className="td-ctr" style={{ color: 'var(--red)', fontWeight: 700 }}>
                    {r.remainingQty}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.dueDate ?? '—'}</td>
                  <td>{r.customerName ?? '—'}</td>
                  <td>
                    <Link
                      to="/planning"
                      className="btn btn-sm"
                      style={{ background: 'var(--cyan)', color: '#fff', fontWeight: 700, fontSize: 11 }}
                    >
                      📋 Plan {r.remainingQty} pcs
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
