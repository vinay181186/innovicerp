// Store / Inventory (PL-SI-1) — per-item current stock dashboard.
// Mirrors legacy renderStore (HTML L24803). KPI strip + filter + the per-item
// stock table, now on the ADR-199 fit table (<DataTable tableKey={storeInventory}>).
// Per-row ⋯ menu: ± Adjust (modal), Reorder (modal), Raise PR (→ Reorder List).
//
// Columns, the Adjust modal and the Manual Receipt modal live in sibling files
// so this route stays under 400 lines. A row below its Reorder Level is washed
// with ROW_TINT.late (the old "⚠ Below Reorder" sub-line is gone — the fit table
// draws one line per row and the tint carries the same meaning).
//
// Two legacy features are NOT ported (reported as parity gaps):
//   - per-row History button (legacy L24847/24953) — needs a per-item txn fetch;
//     /store-transactions cannot filter by item from the URL today.
//   - Recent Store Transactions panel (legacy L24903) — not on this payload.

import type { ListStoreInventoryResponse, StoreInventoryRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatStrip, type StatStripItem } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useStoreInventory } from '../api';
import { AdjustStockModal } from '../components/adjust-stock-modal';
import { ManualReceiptModal } from '../components/manual-receipt-modal';
import { ReorderModal } from '../components/reorder-modal';
import { ReservationDrilldown } from '../components/reservation-drilldown';
import { storeInventoryColumns } from '../components/store-inventory-columns';
import { StockLedger } from '@/modules/store-transactions/components/stock-ledger';

type FilterKey = 'all' | 'below' | 'zero';

export const storeInventoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'store-inventory',
  component: StoreInventoryPage,
});

function StoreInventoryPage(): React.JSX.Element {
  // Tier-driven, per department (Store). Every write on this screen — ± Adjust,
  // Reorder and Manual Receipt, which posts through the same adjust-stock
  // endpoint — moves a saved balance, so all three sit on `edit`: an L2 Data
  // Entry hand cannot restate stock.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');
  const canEdit = perms.edit;
  // "Raise PR" on a low-stock row opens a new Purchase Request — gated on the
  // PR's own entry right, the same gate /purchase-requests/new enforces.
  const canRaisePr = effectiveFormPerms(eff, 'pr_create').entry;
  // Inventory | Stock Ledger tabs — Stock Ledger is the former standalone screen.
  const [tab, setTab] = useState<'inventory' | 'ledger'>('inventory');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [adjustRow, setAdjustRow] = useState<StoreInventoryRow | null>(null);
  const [minRow, setMinRow] = useState<StoreInventoryRow | null>(null);
  const [showManualReceipt, setShowManualReceipt] = useState(false);
  // ADR-180 — which item's Reserved number was clicked (the drill-down).
  const [reservedRow, setReservedRow] = useState<StoreInventoryRow | null>(null);

  const { data, isLoading, isError, error } = useStoreInventory({
    filter,
    search: search.trim() || undefined,
  });

  const columns = useMemo(
    () => storeInventoryColumns({ onReservedClick: (row) => setReservedRow(row) }),
    [],
  );

  return (
    <div>
      {/* Inventory | Stock Ledger tabs (Stock Ledger is the former standalone screen). */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['inventory', 'ledger'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'inventory' ? 'Inventory' : 'Stock Ledger'}
          </button>
        ))}
      </div>

      {tab === 'ledger' ? (
        <StockLedger />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · + Manual
              Receipt, then the filter bar (search · stock filter with counts ·
              Clear), with the read-only "Items in Stock" tile in the band. */}
          <ListHeader
            title="Store Inventory"
            icon="📦"
            count={data?.rows.length}
            noun="item"
            filterNote={
              filter === 'below' ? 'Below Reorder' : filter === 'zero' ? 'Zero Stock' : undefined
            }
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search item code, name, material, UOM…"
            filters={
              // Stock filter, with the item counts the old strip tiles showed
              // in the option labels (owner decision 2026-09-26).
              <select
                className="innovic-select"
                aria-label="Stock filter"
                title="Stock filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterKey)}
              >
                <option value="all">{withCount('All Items', data?.summary.totalItems)}</option>
                <option value="below">
                  {withCount('Below Reorder', data?.summary.belowReorderCount)}
                </option>
                <option value="zero">
                  {withCount('Zero Stock', data?.summary.zeroStockCount)}
                </option>
              </select>
            }
            onClearFilters={() => {
              setFilter('all');
              setSearch('');
            }}
            filtersActive={filter !== 'all' || search !== ''}
            primary={
              canEdit ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowManualReceipt(true)}
                >
                  + Manual Receipt
                </button>
              ) : null
            }
          >
            {data ? <KpiStrip summary={data.summary} /> : null}
          </ListHeader>

          {isError ? (
            <PageState
              state="error"
              message={
                error instanceof Error ? error.message : 'Could not load inventory. Try again.'
              }
            />
          ) : (
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">Stock Levels</span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.storeInventory}
                columns={columns}
                rows={data?.rows ?? []}
                loading={isLoading}
                rowKey={(row) => row.itemId}
                // Below Reorder row → late wash; the fit table's one-line rows
                // make an inline "⚠ Below Reorder" impossible, the tint says it.
                rowClassName={(row) => (row.belowReorder ? ROW_TINT.late : undefined)}
                // Material ships off the default view (kept so no data is lost).
                defaultHidden={['material']}
                emptyText={search.trim() || filter !== 'all' ? 'No items match.' : 'No items yet.'}
                renderLink={(p) => <Link {...p} />}
                rowMenu={(row) => [
                  {
                    key: 'adjust',
                    label: '± Adjust',
                    icon: 'pencil',
                    hidden: !canEdit,
                    onSelect: () => setAdjustRow(row),
                  },
                  {
                    // Reorder Level and Reorder Qty.
                    key: 'reorder',
                    label: 'Reorder',
                    icon: 'settings',
                    hidden: !canEdit,
                    onSelect: () => setMinRow(row),
                  },
                  {
                    // Below Reorder → the Reorder List (ADR-193 phase 5): the one
                    // place PRs are raised for it, so an item that already has an
                    // open PR is never bought twice.
                    key: 'raise-pr',
                    label: 'Raise PR',
                    icon: 'plus',
                    group: 'workflow',
                    hidden: !(canRaisePr && row.belowReorder),
                    to: '/reorder-list',
                  },
                ]}
              />
            </div>
          )}

          {adjustRow ? (
            <AdjustStockModal row={adjustRow} onClose={() => setAdjustRow(null)} />
          ) : null}
          {minRow ? <ReorderModal row={minRow} onClose={() => setMinRow(null)} /> : null}
          {showManualReceipt ? (
            <ManualReceiptModal onClose={() => setShowManualReceipt(false)} />
          ) : null}
          {reservedRow ? (
            <ReservationDrilldown
              itemId={reservedRow.itemId}
              itemCode={reservedRow.itemCode}
              itemName={reservedRow.itemName}
              onClose={() => setReservedRow(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ONE strip, one row — the shared <StatStrip>, not a grid of cards. Item counts
// only: the ADR-180 piece totals (Reserved, Available) were removed because they
// summed kg + Nos + m into one meaningless number.
// 2026-09-26 filter bar: Total / Low / Zero filtered the table, so they are now
// the counts in the Stock filter dropdown. "Items in Stock" never filtered — it
// stays here as a read-only tile.
function KpiStrip({
  summary,
}: {
  summary: ListStoreInventoryResponse['summary'];
}): React.JSX.Element {
  const items: StatStripItem[] = [
    {
      key: 'inStock',
      label: 'Items in Stock',
      count: summary.itemsInStockCount,
      color: 'var(--green2)',
    },
  ];
  return <StatStrip items={items} />;
}

/** "Label (N)" when a count is known, bare label otherwise. */
function withCount(label: string, n: number | undefined): string {
  return n === undefined ? label : `${label} (${n})`;
}
