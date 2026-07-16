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

// Legacy's per-category text colour for the Category cell, ported verbatim from
// renderStockValuation L21038 (local to this page — not a shared colour fn).
// NOTE: legacy keys this on its own six-value item.category taxonomy. Our
// `category` is items.item_type ('component' | 'assembly'), so every real row
// currently falls through to the same var(--text3) legacy gives an unmapped
// category. See ISSUE-043 — the taxonomy gap, not the colour map, is the defect.
const CAT_COLOR: Record<string, string> = {
  'Raw Material': 'var(--blue)',
  Component: 'var(--cyan)',
  'Finished Goods': 'var(--green)',
  'Bought Out': 'var(--purple)',
  Consumable: 'var(--amber)',
};
const catColor = (c: string): string => CAT_COLOR[c] ?? 'var(--text3)';

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
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        📦 Stock Valuation
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
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

      {/* Legacy L20980 — the zero-stock toggle sits directly under the category
          filter buttons, above the summary cards. */}
      <label
        style={{
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginBottom: 14,
          cursor: 'pointer',
        }}
      >
        <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show
        zero-stock items
      </label>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: 16,
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

      {/* Legacy L21029 — searchBox('svSearch','svTable','Search item code or name...').
          Width/padding mirror legacy's own inline styles; our .innovic-input is
          width:100%, which legacy's classless input is not. */}
      <input
        className="innovic-input"
        placeholder="🔍 Search item code or name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '7px 12px', width: 220 }}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          style={{ fontSize: 11 }}
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
                {/* Legacy L21032 right-aligns these three. Inline, not .td-right,
                    because `.innovic-table th` (0,1,1) sets text-align:left and
                    outranks any single utility class on a <th> — see ISSUE-044.
                    Legacy uses inline here for the same reason. */}
                <th style={{ textAlign: 'right' }}>Stock Qty</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Stock Value</th>
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
                    <td>
                      <span style={{ fontSize: 10, fontWeight: 700, color: catColor(r.category) }}>
                        {r.category}
                      </span>
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.code}
                    </td>
                    <td>{r.name}</td>
                    <td className="td-ctr" style={{ fontSize: 11 }}>
                      {r.uom}
                    </td>
                    <td
                      className="td-right mono fw-700"
                      style={{ color: r.stockQty > 0 ? (r.lowStock ? 'var(--red)' : 'var(--green)') : 'var(--text3)' }}
                    >
                      {r.stockQty}
                      {r.lowStock ? ' ⚠' : ''}
                    </td>
                    <td className="td-right mono" style={{ color: r.hasRate ? undefined : 'var(--text3)' }}>
                      {r.hasRate ? inr(r.rate) : 'No Rate'}
                    </td>
                    <td className="td-right mono fw-700" style={{ color: r.value > 0 ? 'var(--green)' : 'var(--text3)' }}>
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
              <tr style={{ background: 'var(--bg4)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td colSpan={6} className="td-right" style={{ fontSize: 12, color: 'var(--text2)' }}>
                  TOTAL ({filtered.length} items)
                </td>
                <td className="td-right mono" style={{ color: 'var(--cyan)' }}>
                  {inr(tblTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Stock Value = Current Stock Qty × Last GRN Rate (or PO Rate if no GRN). ⚠ = below minimum stock.
        Items with no rate show “No Rate”.
      </div>
    </div>
  );
}
