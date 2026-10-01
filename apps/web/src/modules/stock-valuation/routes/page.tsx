// Stock Valuation — mirror of legacy renderStockValuation (L20927). Stock value
// = on-hand × rate (last GRN/PO rate). Grouped by item type. Read-only.

import type { StockValuationResponse, StockValuationRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, StatStrip, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { categoryLabel, exportStockValuation } from '../lib/export';

export const stockValuationRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-valuation',
  component: StockValuationPage,
});

function inr(v: number | null): string {
  if (v == null) return '';
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
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [rows, filter, showZero, search]);

  // Money hidden for L1 Viewers: the API nulls rate/value, so the Rate + Stock
  // Value columns (and their totals cell) drop. Told by the server, not inferred
  // from a null money field — a null also means "no value yet".
  const priceHidden = !data?.priceVisible;
  const columns = useMemo<DataTableColumn<StockValuationRow>[]>(() => {
    const cols: DataTableColumn<StockValuationRow>[] = [
      // Code first — it is the pinned column (owner rule, ADR-199). Item code
      // rendered strong (mono / bold / --text), never the faint --text3.
      {
        header: 'Item Code',
        id: 'code',
        key: 'code',
        kind: 'code',
        className: 'mono fw-700',
        render: (r) => <span style={{ color: 'var(--text)' }}>{r.code}</span>,
      },
      { header: 'Item Name', id: 'name', key: 'name', kind: 'text', ellipsis: true },
      {
        header: 'Item Type',
        id: 'type',
        kind: 'text',
        className: 'text2',
        render: (r) => categoryLabel(r.category),
        filterValue: (r) => categoryLabel(r.category),
      },
      { header: 'UOM', id: 'uom', key: 'uom', kind: 'code' },
      {
        header: 'Physical',
        id: 'qty',
        kind: 'num',
        align: 'right',
        filterValue: (r) => r.stockQty,
        render: (r) => (
          <span
            className="mono fw-700"
            title={r.lowStock ? 'Low Stock' : undefined}
            style={{
              color:
                r.stockQty > 0 ? (r.lowStock ? 'var(--amber2)' : 'var(--green)') : 'var(--text3)',
            }}
          >
            {r.stockQty}
            {r.lowStock ? ' ⚠' : ''}
          </span>
        ),
      },
    ];
    if (!priceHidden) {
      cols.push(
        {
          header: 'Rate',
          id: 'rate',
          kind: 'num',
          align: 'right',
          className: 'mono',
          filterValue: (r) => r.rate ?? 0,
          render: (r) => (
            <span style={{ color: r.hasRate ? undefined : 'var(--text3)' }}>
              {r.hasRate ? inr(r.rate) : 'No Rate'}
            </span>
          ),
        },
        {
          header: 'Stock Value',
          id: 'value',
          kind: 'num',
          align: 'right',
          className: 'mono fw-700',
          title: () => 'Physical × Last GRN Rate (or PO Rate if no GRN)',
          filterValue: (r) => r.value ?? 0,
          render: (r) => (
            <span style={{ color: (r.value ?? 0) > 0 ? 'var(--green)' : 'var(--text3)' }}>
              {inr(r.value)}
            </span>
          ),
          // Engine totals row — sums the visible (filtered) rows and stays under
          // its own column (replaces the hand-written tfoot).
          total: (all) => (
            <span style={{ color: 'var(--cyan)' }}>
              {inr(all.reduce((s, r) => s + (r.value ?? 0), 0))}
            </span>
          ),
        },
      );
    }
    cols.push({
      header: 'Last GRN Date',
      id: 'grnDate',
      kind: 'date',
      render: (r) => fmtDate(r.lastGrnDate),
    });
    return cols;
  }, [priceHidden]);

  const shell = (body: React.ReactNode): React.JSX.Element => (
    <ReportShell title="Stock Valuation">{body}</ReportShell>
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

  // The value tiles also drop when money is hidden (priceHidden computed above).
  return (
    <ReportShell
      title="Stock Valuation"
      filters={
        <>
          {/* Category is filtered by the tiles above the table (one strip:
              category value + count, click to filter) — no second dropdown. */}
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
        // Money hidden for L1 Viewers: the tiles then show item counts only.
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Item Types',
              count: priceHidden ? data.grandItems : inr(data.grandTotal),
              color: 'var(--cyan)',
              sub: `${data.grandStockItems} / ${data.grandItems} items in stock`,
              active: filter === 'all',
              onClick: () => setFilter('all'),
            },
            ...data.categories.map((c) => ({
              key: c.category,
              label: categoryLabel(c.category),
              count: priceHidden ? c.count : inr(c.value),
              color: 'var(--green2)',
              sub: `${c.stockCount} / ${c.count} items in stock`,
              active: filter === c.category,
              onClick: () => setFilter(filter === c.category ? 'all' : c.category),
            })),
          ]}
        />
      }
      rowCount={filtered.length}
      rowNoun="item"
    >
      <div className="panel">
        {/* Shared FIT table (ADR-199). The totals row is drawn by the engine
            (showTotals + the Stock Value column's `total`), so it follows the
            visible columns — no hand-written tfoot. No row tint: a valuation row
            has no "done"/status to map to. */}
        <DataTable
          tableKey={TABLE_KEYS.stockValuation}
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.itemId}
          showTotals={!priceHidden}
          totalsLabel="Total"
          emptyText={
            filter !== 'all' || search.trim() || rows.length > 0
              ? 'No items match.'
              : 'No items yet.'
          }
        />
      </div>
    </ReportShell>
  );
}
