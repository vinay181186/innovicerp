// Stock Valuation — mirror of legacy renderStockValuation (L20927). Stock value
// = on-hand × rate (last GRN/PO rate). Grouped by item type. Read-only.

import type { StockValuationResponse } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { exportStockValuation } from '../lib/export';

export const stockValuationRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-valuation',
  component: StockValuationPage,
});

function inr(v: number): string {
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

function StockValuationPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<StockValuationResponse>({
    queryKey: ['stock-valuation'],
    queryFn: () => apiFetch<StockValuationResponse>('/stock-valuation'),
    staleTime: 30_000,
  });

  const [filter, setFilter] = useState('all');
  const [showZero, setShowZero] = useState(false);
  const [search, setSearch] = useState('');

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => (filter === 'all' ? true : r.category === filter))
      .filter((r) => (showZero ? true : r.stockQty > 0))
      .filter((r) => (s ? `${r.code} ${r.name}`.toLowerCase().includes(s) : true))
      .sort((a, b) => b.value - a.value);
  }, [rows, filter, showZero, search]);

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

  const catKeys = ['all', ...data.categories.map((c) => c.category)];
  const catCount = (k: string): number =>
    k === 'all' ? data.grandItems : (data.categories.find((c) => c.category === k)?.count ?? 0);
  const tblTotal = filtered.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className="section-hdr">📦 Stock Valuation</div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0 8px' }}>
        {catKeys.map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn-sm"
            style={{
              fontWeight: 700,
              background: filter === k ? 'var(--blue)' : 'var(--bg4)',
              color: filter === k ? '#fff' : 'var(--text2)',
            }}
            onClick={() => setFilter(k)}
          >
            {k === 'all' ? 'All Categories' : k} ({catCount(k)})
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div className="panel" style={{ padding: 10, textAlign: 'center', border: '2px solid var(--cyan)' }}>
          <div style={{ fontSize: 9, color: 'var(--cyan)', fontWeight: 700 }}>TOTAL STOCK VALUE</div>
          <div className="mono fw-700" style={{ fontSize: 18, color: 'var(--cyan)' }}>
            {inr(data.grandTotal)}
          </div>
          <div className="text3" style={{ fontSize: 9 }}>
            {data.grandStockItems} / {data.grandItems} items in stock
          </div>
        </div>
        {data.categories.map((c) => (
          <div key={c.category} className="panel" style={{ padding: 10, textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
              {c.category}
            </div>
            <div className="mono fw-700" style={{ fontSize: 16, color: 'var(--green)' }}>
              {inr(c.value)}
            </div>
            <div className="text3" style={{ fontSize: 9 }}>
              {c.stockCount} in stock
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          className="innovic-input"
          placeholder="🔍 Search item code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 12, padding: '6px 10px', minWidth: 220 }}
        />
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />{' '}
          Show zero-stock items
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => exportStockValuation(rows)}
        >
          ⬇ Export to Excel
        </button>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>UOM</th>
                <th className="td-ctr">Stock Qty</th>
                <th className="td-ctr">Rate</th>
                <th className="td-ctr">Stock Value</th>
                <th>Last GRN</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No items
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.itemId}>
                    <td style={{ fontSize: 10, fontWeight: 700 }}>{r.category}</td>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.code}
                    </td>
                    <td>{r.name}</td>
                    <td className="td-ctr" style={{ fontSize: 11 }}>
                      {r.uom}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ color: r.stockQty > 0 ? (r.lowStock ? 'var(--red)' : 'var(--green)') : 'var(--text3)' }}
                    >
                      {r.stockQty}
                      {r.lowStock ? ' ⚠' : ''}
                    </td>
                    <td className="td-ctr mono" style={{ color: r.hasRate ? undefined : 'var(--text3)' }}>
                      {r.hasRate ? inr(r.rate) : 'No Rate'}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: r.value > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      {inr(r.value)}
                    </td>
                    <td className="td-ctr" style={{ fontSize: 11 }}>
                      {r.lastGrnDate ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg4)', fontWeight: 700 }}>
                <td colSpan={6} className="td-ctr">
                  TOTAL ({filtered.length} items)
                </td>
                <td className="td-ctr mono" style={{ color: 'var(--cyan)' }}>
                  {inr(tblTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Stock Value = on-hand qty × last GRN rate (or last PO rate). ⚠ = below minimum stock.
      </div>
    </div>
  );
}
