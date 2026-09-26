// Store / Inventory (PL-SI-1) — per-item current stock dashboard.
// Mirrors legacy renderStore (HTML L24803). 4-tile KPI strip + filter +
// per-item table with In Stock, Min Qty, On PO, Mfg Pending, + actions:
// ± Adjust (modal), Min Qty (modal).
//
// Two legacy features are NOT ported (reported as parity gaps):
//   - per-row History button (legacy L24847/24953) — needs a per-item txn
//     fetch; /store-transactions cannot filter by item from the URL today.
//   - Recent Store Transactions panel (legacy L24903) — not on this payload.

import type {
  AdjustStockInput,
  ListStoreInventoryResponse,
  SetMinStockInput,
  StoreInventoryRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatStrip, type StatStripItem } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAdjustStock, useSetMinStock, useStoreInventory } from '../api';
import { ModalShell } from '../components/modal-shell';
import { ReservationDrilldown } from '../components/reservation-drilldown';
import { StockLedger } from '@/modules/store-transactions/components/stock-ledger';

type FilterKey = 'all' | 'low' | 'zero';

export const storeInventoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'store-inventory',
  component: StoreInventoryPage,
});

function StoreInventoryPage(): React.JSX.Element {
  // Tier-driven, per department (Store). Was admin/manager on `users.role`.
  // Every write on this screen — ± Adjust, Min Qty and Manual Receipt, which
  // posts through the same adjust-stock endpoint — moves a saved balance, so
  // all three sit on `edit`: an L2 Data Entry hand cannot restate stock.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');
  const canEdit = perms.edit;
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="section-hdr m-0">🏬 Store / Inventory</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                className="innovic-input"
                placeholder="🔍 Search item code, name, material, UOM…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 240, fontSize: 12 }}
              />
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowManualReceipt(true)}
                >
                  + Manual Receipt
                </button>
              ) : null}
            </div>
          </div>

          {isLoading ? (
            <div className="panel">
              <div className="panel-body">
                <div className="text3" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="inline animate-spin" /> Loading…
                </div>
              </div>
            </div>
          ) : isError ? (
            <div className="panel">
              <div className="panel-body">
                <div className="empty-state" style={{ color: 'var(--red2)' }}>
                  {error instanceof Error ? error.message : 'Could not load inventory. Try again.'}
                </div>
              </div>
            </div>
          ) : data ? (
            <>
              <KpiStrip summary={data.summary} filter={filter} setFilter={setFilter} />

              <div className="panel">
                <div className="panel-hdr">
                  <span className="panel-title">Stock Levels</span>
                </div>
                <div className="tbl-wrap">
                  <table className="innovic-table">
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th>Material</th>
                        <th>UOM</th>
                        {/* ADR-180 — three numbers, three columns, always in
                            this order: Physical − Reserved = Available. */}
                        <th
                          className="th-num"
                          style={{ color: 'var(--green2)' }}
                          title="On the shelf, reserved or not. Reserving never changes it."
                        >
                          Physical
                        </th>
                        <th
                          className="th-num"
                          style={{ color: 'var(--purple)' }}
                          title="Promised to SO lines but still on the shelf — click a number to see where"
                        >
                          Reserved
                        </th>
                        <th
                          className="th-num"
                          style={{ color: 'var(--cyan)' }}
                          title="Physical − Reserved: what a new order may still be promised"
                        >
                          Available
                        </th>
                        <th className="th-num">Min Qty</th>
                        <th className="th-num" style={{ color: 'var(--blue)' }}>
                          On PO
                        </th>
                        <th className="th-num" style={{ color: 'var(--orange)' }}>
                          At Vendor
                        </th>
                        <th className="th-num" style={{ color: 'var(--amber2)' }}>
                          Pending to Make
                        </th>
                        {canEdit ? <th>Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.length === 0 ? (
                        <tr>
                          <td colSpan={canEdit ? 12 : 11} className="empty-state">
                            {search.trim() ? 'No items match this search.' : 'No items in master'}
                          </td>
                        </tr>
                      ) : (
                        data.rows.map((row) => (
                          <tr
                            key={row.itemId}
                            style={{
                              background: row.lowStock ? 'rgba(220,38,38,0.04)' : undefined,
                            }}
                          >
                            <td className="td-code" style={{ color: 'var(--purple)' }}>
                              {row.itemCode}
                            </td>
                            <td className="fw-700">{row.itemName}</td>
                            <td className="text2" style={{ fontSize: 11 }}>
                              {row.material ?? '—'}
                            </td>
                            <td className="td-ctr">
                              <span
                                className="tag"
                                style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                              >
                                {row.uom}
                              </span>
                            </td>
                            <td className="td-num">
                              <span
                                className="mono fw-700"
                                style={{
                                  fontSize: 15,
                                  color:
                                    row.inStock > 0
                                      ? 'var(--green)'
                                      : row.inStock === 0
                                        ? 'var(--red)'
                                        : 'var(--text3)',
                                }}
                              >
                                {row.inStock}
                              </span>
                              {row.lowStock ? (
                                <div
                                  style={{ fontSize: 11, color: 'var(--red2)', fontWeight: 700 }}
                                >
                                  ⚠ Low Stock
                                </div>
                              ) : null}
                            </td>
                            {/* Reserved is clickable: it opens the list of SO
                                lines holding this item's stock. */}
                            <td className="td-num">
                              {row.reservedQty > 0 ? (
                                <button
                                  type="button"
                                  className="mono fw-700"
                                  onClick={() => setReservedRow(row)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    fontSize: 15,
                                    color: 'var(--purple)',
                                    textDecoration: 'underline',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {row.reservedQty}
                                </button>
                              ) : (
                                <span className="mono text3">—</span>
                              )}
                            </td>
                            <td className="td-num">
                              <span
                                className="mono fw-700"
                                style={{
                                  fontSize: 15,
                                  color: row.availableQty > 0 ? 'var(--cyan)' : 'var(--text3)',
                                }}
                              >
                                {row.availableQty}
                              </span>
                            </td>
                            <td className="mono text3 td-num">{row.minQty || '—'}</td>
                            <td className="td-num">
                              <span
                                className="mono"
                                style={{ color: row.onPoQty > 0 ? 'var(--blue)' : 'var(--text3)' }}
                              >
                                {row.onPoQty || '—'}
                              </span>
                            </td>
                            <td className="td-num">
                              <span
                                className="mono"
                                style={{
                                  color: row.atVendorQty > 0 ? 'var(--orange)' : 'var(--text3)',
                                }}
                                title={
                                  row.atVendorQty > 0
                                    ? `${row.atVendorQty} pcs out at an OSP vendor — not on the shelf`
                                    : undefined
                                }
                              >
                                {row.atVendorQty || '—'}
                              </span>
                            </td>
                            <td className="td-num">
                              <span
                                className="mono"
                                style={{
                                  color: row.mfgPendingQty > 0 ? 'var(--amber)' : 'var(--text3)',
                                }}
                              >
                                {row.mfgPendingQty || '—'}
                              </span>
                            </td>
                            {canEdit ? (
                              <td>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setAdjustRow(row)}
                                    style={{ fontSize: 11 }}
                                  >
                                    ± Adjust
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setMinRow(row)}
                                    style={{ fontSize: 11 }}
                                  >
                                    Min Qty
                                  </button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {adjustRow ? <AdjustModal row={adjustRow} onClose={() => setAdjustRow(null)} /> : null}
          {minRow ? <SetMinModal row={minRow} onClose={() => setMinRow(null)} /> : null}
          {showManualReceipt ? (
            <ManualReceiveModal
              onClose={() => setShowManualReceipt(false)}
              rows={data?.rows ?? []}
            />
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

// ONE strip, one row — the shared <StatStrip>, not a grid of cards. Item
// counts only: the ADR-180 piece totals (Reserved, Available) were removed
// because they summed kg + Nos + m into one meaningless number.
function KpiStrip({
  summary,
  filter,
  setFilter,
}: {
  summary: ListStoreInventoryResponse['summary'];
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  const items: StatStripItem[] = [
    {
      key: 'all',
      label: 'Total Items',
      count: summary.totalItems,
      color: 'var(--cyan)',
      active: filter === 'all',
      onClick: () => setFilter('all'),
    },
    {
      key: 'inStock',
      label: 'Items in Stock',
      count: summary.itemsInStockCount,
      color: 'var(--green2)',
    },
    {
      key: 'low',
      label: 'Low Stock Alert',
      count: summary.lowStockCount,
      color: 'var(--red2)',
      sub: 'Below minimum level',
      active: filter === 'low',
      onClick: () => setFilter(filter === 'low' ? 'all' : 'low'),
    },
    {
      key: 'zero',
      label: 'Zero Stock',
      count: summary.zeroStockCount,
      color: 'var(--amber2)',
      active: filter === 'zero',
      onClick: () => setFilter(filter === 'zero' ? 'all' : 'zero'),
    },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <StatStrip items={items} />
    </div>
  );
}

function AdjustModal({
  row,
  onClose,
}: {
  row: StoreInventoryRow;
  onClose: () => void;
}): React.JSX.Element {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useAdjustStock();

  const onSave = (): void => {
    setErr(null);
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Enter a valid quantity');
      return;
    }
    if (!remarks.trim()) {
      setErr('Enter a reason for the adjustment');
      return;
    }
    const input: AdjustStockInput = {
      itemId: row.itemId,
      direction,
      qty: q,
      remarks: remarks.trim(),
    };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not adjust stock. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title={`Adjust Stock — ${row.itemCode}`}>
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          background: 'var(--bg3)',
          borderRadius: 8,
        }}
      >
        <span className="text3" style={{ fontSize: 11 }}>
          Physical:
        </span>
        <span
          className="mono fw-700"
          style={{ fontSize: 18, color: 'var(--green2)', marginLeft: 8 }}
        >
          {row.inStock} {row.uom}
        </span>
        <span className="text3" style={{ fontSize: 11, marginLeft: 10 }}>
          Reserved{' '}
          <b className="mono" style={{ color: 'var(--purple)' }}>
            {row.reservedQty}
          </b>{' '}
          · Available{' '}
          <b className="mono" style={{ color: 'var(--cyan)' }}>
            {row.availableQty}
          </b>
        </span>
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Adjustment Type</label>
          <select
            className="innovic-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}
          >
            <option value="add">+ Add Stock</option>
            <option value="remove">- Remove Stock</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Quantity ★</label>
          <input
            type="number"
            min={1}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Reason / Remarks ★</label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Physical count correction, damage, etc."
          />
        </div>
      </div>
      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--red2)',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          {err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Adjust'
          )}
        </button>
      </div>
    </ModalShell>
  );
}

function SetMinModal({
  row,
  onClose,
}: {
  row: StoreInventoryRow;
  onClose: () => void;
}): React.JSX.Element {
  const [val, setVal] = useState(String(row.minQty));
  const [err, setErr] = useState<string | null>(null);
  const mut = useSetMinStock();

  const onSave = (): void => {
    setErr(null);
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      setErr('Enter 0 or a whole number');
      return;
    }
    const input: SetMinStockInput = { itemId: row.itemId, minQty: n };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save Min Qty. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title={`Min Qty — ${row.itemCode}`}>
      <div className="text3" style={{ fontSize: 12, marginBottom: 10 }}>
        Low Stock shows at or below this. 0 = off.
      </div>
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label">Min Qty</label>
          <input
            type="number"
            min={0}
            className="innovic-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
      </div>
      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--red2)',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          {err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Save'
          )}
        </button>
      </div>
    </ModalShell>
  );
}

// Legacy storeReceiveManual (HTML L24981) — manual stock IN entry. Today the
// underlying ledger writes `source_type='manual_adjust'` via the existing
// AdjustStock service; the "Source" dropdown + Ref No fields shown in the
// legacy modal are stored only on the local input here and folded into the
// remarks string (a DELTA to track separately — adding source/ref to
// store_transactions requires a backend schema bump).
function ManualReceiveModal({
  onClose,
  rows,
}: {
  onClose: () => void;
  rows: StoreInventoryRow[];
}): React.JSX.Element {
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [qty, setQty] = useState('');
  const [source, setSource] = useState('Production');
  const [refNo, setRefNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useAdjustStock();

  const selected = useMemo(() => rows.find((r) => r.itemId === itemId) ?? null, [rows, itemId]);
  const filtered = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.itemCode.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q) ||
        (r.material ?? '').toLowerCase().includes(q),
    );
  }, [rows, itemSearch]);

  const onSave = (): void => {
    setErr(null);
    if (!itemId) {
      setErr('Select an item');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Enter a valid quantity');
      return;
    }
    const composedRemarks = [
      `Manual receipt · source=${source}`,
      refNo.trim() ? `ref=${refNo.trim()}` : null,
      remarks.trim() || null,
    ]
      .filter(Boolean)
      .join(' · ');

    const input: AdjustStockInput = {
      itemId,
      direction: 'add',
      qty: q,
      remarks: composedRemarks,
    };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save receipt. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="+ Manual Stock Receipt">
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Item ★</label>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search item..."
            style={{ fontSize: 12 }}
            value={selected ? `${selected.itemCode} — ${selected.itemName}` : itemSearch}
            onChange={(e) => {
              setItemId(null);
              setItemSearch(e.target.value);
            }}
          />
          {!itemId && itemSearch.trim() ? (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg2)',
                marginTop: 4,
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {filtered.slice(0, 20).map((r) => (
                <div
                  key={r.itemId}
                  onClick={() => {
                    setItemId(r.itemId);
                    setItemSearch('');
                  }}
                  style={{
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{r.itemCode}</span> —{' '}
                  {r.itemName}
                  <span className="text3" style={{ marginLeft: 6 }}>
                    · stock {r.inStock} {r.uom}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label">Quantity ★</label>
          <input
            type="number"
            min={1}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Source</label>
          <select
            className="innovic-select"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option>Production</option>
            <option>Purchase</option>
            <option>Return</option>
            <option>Other</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Reference No.</label>
          <input
            type="text"
            className="innovic-input"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            placeholder="JC / PO / GRN number"
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Remarks</label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional notes"
          />
        </div>
      </div>
      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--red2)',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          {err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Receive'
          )}
        </button>
      </div>
    </ModalShell>
  );
}
