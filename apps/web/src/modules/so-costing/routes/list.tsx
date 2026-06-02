// SO Costing list — mirror of legacy renderSOCosting (L17249). Per-SO Material
// + Outsource + Machine-Time cost. Row → detail. Read-only.

import type { ListSoCostingResponse } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';

export const soCostingListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-costing',
  component: SoCostingListPage,
});

const money = (v: number): string => (v > 0 ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—');

function SoCostingListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<ListSoCostingResponse>({
    queryKey: ['so-costing'],
    queryFn: () => apiFetch<ListSoCostingResponse>('/so-costing'),
    staleTime: 30_000,
  });
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      s ? `${r.soNo} ${r.customer ?? ''}`.toLowerCase().includes(s) : true,
    );
  }, [data?.rows, search]);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr">💰 SO Costing</div>
      <input
        className="innovic-input"
        placeholder="🔍 Search SO, customer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ fontSize: 12, padding: '6px 10px', minWidth: 220, margin: '10px 0' }}
      />
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO No</th>
                <th>Customer</th>
                <th className="td-ctr">Lines</th>
                <th className="td-ctr">Total Qty</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>SO Value</th>
                <th>Cost Center</th>
                <th className="td-ctr" style={{ color: 'var(--blue)' }}>Material</th>
                <th className="td-ctr" style={{ color: 'var(--amber)' }}>Outsource</th>
                <th className="td-ctr" style={{ color: 'var(--cyan)' }}>Machine Time</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    No SOs found
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.soId}>
                    <td>
                      <Link
                        to="/so-costing/$id"
                        params={{ id: r.soId }}
                        className="td-code"
                        style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                      >
                        {r.soNo}
                      </Link>
                    </td>
                    <td>{r.customer ?? '—'}</td>
                    <td className="td-ctr">{r.lineCount}</td>
                    <td className="td-ctr mono fw-700">{r.totalQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>{money(r.soValue)}</td>
                    <td style={{ fontSize: 11, color: 'var(--teal, #0d9488)' }}>
                      {r.costCenter ? `${r.costCenter}${r.costCenterName ? ` — ${r.costCenterName}` : ''}` : '—'}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--blue)' }}>{money(r.materialCost)}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--amber)' }}>{money(r.outsourceCost)}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--cyan)' }}>{money(r.machineTimeCost)}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>{money(r.totalCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Click an SO for the line-level breakdown. Material = with-material POs, Outsource =
        job-work/OSP POs, Machine Time = cycle-time × completed × machine rate.
      </div>
    </div>
  );
}
