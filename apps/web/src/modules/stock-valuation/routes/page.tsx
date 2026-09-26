// Stock Valuation — mirror of legacy renderStockValuation (L20927). Stock value
// = on-hand × rate (last GRN/PO rate). Grouped by item type. Read-only.

import type { StockValuationResponse } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell, reportTotalRowStyle } from '@/ui/data/ReportShell';
import { exportStockValuation } from '../lib/export';

export const stockValuationRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-valuation',
  component: StockValuationPage,
});

function inr(v: number | null): string {
  if (v == null) return '';
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
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [rows, filter, showZero, search]);

  const shell = (body: React.ReactNode): React.JSX.Element => (
    <ReportShell title="Stock Valuation" icon="📦">
      {body}
    </ReportShell>
  );
  if (isLoading) {
    return shell(
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>,
    );
  }
  if (isError || !data) {
    return shell(
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load stock valuation. Try again.'}
      </div>,
    );
  }

  // Money hidden for L1 Viewers: the API nulls rate/value/grandTotal, so the
  // Rate + Stock Value columns, the value tiles and the totals are dropped.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = !data.priceVisible;
  const catKeys = ['all', ...data.categories.map((c) => c.category)];
  const catCount = (k: string): number =>
    k === 'all' ? data.grandItems : (data.categories.find((c) => c.category === k)?.count ?? 0);
  const tblTotal = filtered.reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <ReportShell
      title="Stock Valuation"
      icon="📦"
      filters={
        <>
          <ReportFilter label="Item Category" htmlFor="sv-category" size="lg">
            <select
              id="sv-category"
              className="innovic-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {catKeys.map((k) => (
                <option key={k} value={k}>
                  {k === 'all' ? 'All Categories' : k} ({catCount(k)})
                </option>
              ))}
            </select>
          </ReportFilter>
          {/* Legacy L21029 — searchBox('svSearch','svTable','Search item code or name...'). */}
          <ReportFilter label="Search" htmlFor="sv-search" size="lg">
            <input
              id="sv-search"
              className="innovic-input"
              placeholder="Search item code, item name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </ReportFilter>
          {/* Legacy L20980 — the zero-stock toggle. */}
          <label
            className="form-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-1)',
              height: 'var(--control-h)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showZero}
              onChange={(e) => setShowZero(e.target.checked)}
            />{' '}
            Show zero-stock items
          </label>
        </>
      }
      onClear={() => {
        setFilter('all');
        setShowZero(false);
        setSearch('');
      }}
      onExport={{ excel: () => exportStockValuation(rows) }}
      kpis={
        priceHidden ? undefined : (
          <StatStrip
            items={[
              {
                key: 'all',
                label: 'Total Stock Value',
                count: inr(data.grandTotal),
                color: 'var(--cyan)',
                sub: `${data.grandStockItems} / ${data.grandItems} items in stock`,
              },
              ...data.categories.map((c) => ({
                key: c.category,
                label: c.category,
                count: inr(c.value),
                color: 'var(--green2)',
                sub: `${c.stockCount} in stock`,
              })),
            ]}
          />
        )
      }
      rowCount={filtered.length}
      rowNoun="item"
    >
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>UOM</th>
                <th className="th-num">Physical</th>
                {priceHidden ? null : (
                  <>
                    <th className="th-num">Rate</th>
                    <th className="th-num" title="Physical × Last GRN Rate (or PO Rate if no GRN)">
                      Stock Value
                    </th>
                  </>
                )}
                <th>Last GRN Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 6 : 8} className="empty-state">
                    No items
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.itemId}>
                    <td>
                      <span style={{ fontWeight: 700, color: catColor(r.category) }}>
                        {r.category}
                      </span>
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.code}
                    </td>
                    <td>{r.name}</td>
                    <td>{r.uom}</td>
                    <td
                      className="td-num mono fw-700"
                      title={r.lowStock ? 'Below minimum stock' : undefined}
                      style={{
                        color:
                          r.stockQty > 0
                            ? r.lowStock
                              ? 'var(--red)'
                              : 'var(--green)'
                            : 'var(--text3)',
                      }}
                    >
                      {r.stockQty}
                      {r.lowStock ? ' ⚠' : ''}
                    </td>
                    {priceHidden ? null : (
                      <>
                        <td
                          className="td-num mono"
                          style={{ color: r.hasRate ? undefined : 'var(--text3)' }}
                        >
                          {r.hasRate ? inr(r.rate) : 'No Rate'}
                        </td>
                        <td
                          className="td-num mono fw-700"
                          style={{ color: (r.value ?? 0) > 0 ? 'var(--green)' : 'var(--text3)' }}
                        >
                          {inr(r.value)}
                        </td>
                      </>
                    )}
                    <td>{fmtDate(r.lastGrnDate)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={reportTotalRowStyle}>
                <td colSpan={priceHidden ? 5 : 6} style={{ color: 'var(--text2)' }}>
                  TOTAL ({filtered.length} items)
                </td>
                {priceHidden ? null : (
                  <td className="td-num mono" style={{ color: 'var(--cyan)' }}>
                    {inr(tblTotal)}
                  </td>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </ReportShell>
  );
}
