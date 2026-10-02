// Stock Valuation — mirror of legacy renderStockValuation (L20927). Stock value
// = on-hand × rate (last GRN/PO rate). Grouped by item type. Read-only.
//
// ADR-201 (2026-10-02): 25 items a page. The item-type tile filter, the
// zero-stock switch, the search, Sort & Filter (▾) and the page run on the
// SERVER over every item (filters + page in the URL; any change → page 1). The
// tiles and the totals row are the server's sums — tiles over every item, the
// totals row over every MATCHING item — never the 25 on screen. The Excel
// export fetches every matching row.

import { ITEM_TYPES, type StockValuationRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, StatStrip, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { ListFooter } from '@/ui/layout';
import { fetchAllStockValuation, useStockValuation, type StockValuationParams } from '../api';
import { categoryLabel, exportStockValuation } from '../lib/export';

const svSearchSchema = z.object({
  category: z.string().optional(),
  showZero: z.boolean().optional(),
  q: z.string().optional(),
  page: pageSearchParam,
});
type SvSearch = z.infer<typeof svSearchSchema>;

export const stockValuationRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-valuation',
  validateSearch: svSearchSchema,
  component: StockValuationPage,
});

const TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t, label: categoryLabel(t) }));

function inr(v: number | null): string {
  if (v == null) return '';
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

function StockValuationPage(): React.JSX.Element {
  const urlSearch = stockValuationRoute.useSearch();
  const navigate = stockValuationRoute.useNavigate();
  const filter = urlSearch.category ?? 'all';
  const showZero = urlSearch.showZero ?? false;
  // Any filter change goes back to page 1 (a page change passes its own page).
  const go = useCallback(
    (patch: Partial<SvSearch>) =>
      void navigate({ search: (p) => ({ ...p, ...patch, page: patch.page ?? 1 }), replace: true }),
    [navigate],
  );
  const setFilter = (c: string): void => go({ category: c === 'all' ? undefined : c });
  const setShowZero = (v: boolean): void => go({ showZero: v || undefined });

  // Typed search → URL after a short pause (page 1).
  const [search, setSearch] = useState(urlSearch.q ?? '');
  useEffect(() => {
    setSearch((prev) =>
      normalizeSearchTerm(prev) === (urlSearch.q ?? '') ? prev : (urlSearch.q ?? ''),
    );
  }, [urlSearch.q]);
  useEffect(() => {
    const t = normalizeSearchTerm(search);
    const next = t === '' ? undefined : t;
    if (next === urlSearch.q) return;
    const id = window.setTimeout(() => go({ q: next }), 300);
    return () => window.clearTimeout(id);
  }, [search, urlSearch.q, go]);

  const sf = useServerSortFilter(TABLE_KEYS.stockValuation, () => go({}));
  const params: StockValuationParams = useMemo(
    () => ({ category: urlSearch.category, showZero, search: urlSearch.q, sf: sf.param }),
    [urlSearch.category, showZero, urlSearch.q, sf.param],
  );
  const offset = pageOffset(urlSearch.page);
  const { data, isLoading, isError, error } = useStockValuation(params, LIST_PAGE_SIZE, offset);
  const gotoPage = useCallback((p: number) => go({ page: p }), [go]);
  useClampPage(urlSearch.page, data?.total, gotoPage);

  // Excel = every matching row, fetched page by page (never just the 25 shown).
  const [exporting, setExporting] = useState(false);
  const runExport = (): void => {
    setExporting(true);
    void fetchAllStockValuation(params)
      .then((all) => exportStockValuation(all))
      .catch((e: unknown) =>
        window.alert(e instanceof Error ? e.message : 'Could not export. Try again.'),
      )
      .finally(() => setExporting(false));
  };

  const rows = data?.rows ?? [];
  const filteredValue = data?.filteredValue ?? null;

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
        sortFilterField: 'code',
        className: 'mono fw-700',
        render: (r) => <span style={{ color: 'var(--text)' }}>{r.code}</span>,
      },
      {
        header: 'Item Name',
        id: 'name',
        key: 'name',
        kind: 'text',
        ellipsis: true,
        sortFilterField: 'name',
      },
      {
        header: 'Item Type',
        id: 'type',
        kind: 'text',
        className: 'text2',
        sortFilterField: 'category',
        filterType: 'list',
        filterOptions: TYPE_OPTIONS,
        render: (r) => categoryLabel(r.category),
        filterValue: (r) => categoryLabel(r.category),
      },
      { header: 'UOM', id: 'uom', key: 'uom', kind: 'code', sortFilterField: 'uom' },
      {
        header: 'Physical',
        id: 'qty',
        kind: 'num',
        align: 'right',
        sortFilterField: 'stockQty',
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
          sortFilterField: 'rate',
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
          sortFilterField: 'value',
          className: 'mono fw-700',
          title: () => 'Physical × Last GRN Rate (or PO Rate if no GRN)',
          filterValue: (r) => r.value ?? 0,
          render: (r) => (
            <span style={{ color: (r.value ?? 0) > 0 ? 'var(--green)' : 'var(--text3)' }}>
              {inr(r.value)}
            </span>
          ),
          // Engine totals row — the SERVER's sum over every matching item (all
          // pages), under its own column (replaces the hand-written tfoot).
          total: <span style={{ color: 'var(--cyan)' }}>{inr(filteredValue)}</span>,
        },
      );
    }
    cols.push({
      header: 'Last GRN Date',
      id: 'grnDate',
      kind: 'date',
      sortFilterField: 'lastGrnDate',
      render: (r) => fmtDate(r.lastGrnDate),
    });
    return cols;
  }, [priceHidden, filteredValue]);

  const shell = (body: React.ReactNode): React.JSX.Element => (
    <ReportShell title="Stock Valuation">{body}</ReportShell>
  );
  if (isLoading && !data) {
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
        setSearch('');
        void navigate({ search: { page: 1 }, replace: true });
      }}
      onExport={{ excel: runExport, busy: exporting }}
      exportDisabled={data.total === 0}
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
      footer={
        <ListFooter
          total={data.total}
          noun="item"
          page={urlSearch.page}
          pageSize={LIST_PAGE_SIZE}
          onPage={gotoPage}
        />
      }
    >
      <div className="panel">
        {/* Shared FIT table (ADR-199). The totals row is drawn by the engine
            (showTotals + the Stock Value column's `total`), so it follows the
            visible columns — no hand-written tfoot. No row tint: a valuation row
            has no "done"/status to map to. */}
        <DataTable
          tableKey={TABLE_KEYS.stockValuation}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.itemId}
          sortFilterServer={sf}
          showTotals={!priceHidden}
          totalsLabel="Total"
          emptyText={
            filter !== 'all' || search.trim() || sf.filtering || data.grandItems > 0
              ? 'No items match.'
              : 'No items yet.'
          }
        />
      </div>
    </ReportShell>
  );
}
