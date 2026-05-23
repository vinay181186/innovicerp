// Store / Inventory (PL-SI-1) — per-item current stock dashboard.
// Mirrors legacy renderStore (HTML L24803). 4-tile KPI strip + filter +
// per-item table with In Stock, Min Qty, On PO, Mfg Pending, + actions:
// ± Adjust (modal), Min Qty (modal). History routes to /store-transactions.

import type {
  AdjustStockInput,
  ListStoreInventoryResponse,
  SetMinStockInput,
  StoreInventoryRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAdjustStock, useSetMinStock, useStoreInventory } from '../api';

type FilterKey = 'all' | 'low' | 'zero';

export const storeInventoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'store-inventory',
  component: StoreInventoryPage,
});

function StoreInventoryPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [adjustRow, setAdjustRow] = useState<StoreInventoryRow | null>(null);
  const [minRow, setMinRow] = useState<StoreInventoryRow | null>(null);
  const [showManualReceipt, setShowManualReceipt] = useState(false);

  const { data, isLoading, isError, error } = useStoreInventory({
    filter,
    search: search.trim() || undefined,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">🏬 Store / Inventory</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search item, material…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          {canWrite ? (
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
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load inventory'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip summary={data.summary} filter={filter} setFilter={setFilter} />

          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                Stock Levels{' '}
                {filter !== 'all' ? (
                  <span style={{ color: 'var(--amber)', fontSize: 12 }}>(Filtered: {filter})</span>
                ) : null}
              </span>
              {filter !== 'all' ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilter('all')}
                >
                  Show All
                </button>
              ) : null}
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>Item Code</th>
                    <th>Name</th>
                    <th>Material</th>
                    <th>UOM</th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>
                      In Stock
                    </th>
                    <th className="td-ctr">Min Qty</th>
                    <th className="td-ctr" style={{ color: 'var(--blue)' }}>
                      On PO
                    </th>
                    <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                      Mfg Pending
                    </th>
                    {canWrite ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={canWrite ? 9 : 8} className="empty-state">
                        No items in this view
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
                        <td>
                          <span className="td-code" style={{ color: 'var(--purple)' }}>
                            {row.itemCode}
                          </span>
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
                        <td className="td-ctr">
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
                            <div style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700 }}>
                              ⚠ LOW
                            </div>
                          ) : null}
                        </td>
                        <td className="td-ctr mono text3">{row.minQty || '—'}</td>
                        <td className="td-ctr">
                          <span
                            className="mono"
                            style={{ color: row.onPoQty > 0 ? 'var(--blue)' : 'var(--text3)' }}
                          >
                            {row.onPoQty || '—'}
                          </span>
                        </td>
                        <td className="td-ctr">
                          <span
                            className="mono"
                            style={{ color: row.mfgPendingQty > 0 ? 'var(--amber)' : 'var(--text3)' }}
                          >
                            {row.mfgPendingQty || '—'}
                          </span>
                        </td>
                        {canWrite ? (
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

          <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
            💡 Stock is automatically updated via GRN (inward) and Item Issues (outward). Use{' '}
            <b>± Adjust</b> for manual corrections.
          </div>
        </>
      ) : null}

      {adjustRow ? (
        <AdjustModal row={adjustRow} onClose={() => setAdjustRow(null)} />
      ) : null}
      {minRow ? <SetMinModal row={minRow} onClose={() => setMinRow(null)} /> : null}
      {showManualReceipt ? (
        <ManualReceiveModal
          onClose={() => setShowManualReceipt(false)}
          rows={data?.rows ?? []}
        />
      ) : null}
    </div>
  );
}

function KpiStrip({
  summary,
  filter,
  setFilter,
}: {
  summary: ListStoreInventoryResponse['summary'];
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  const tiles: Array<{
    key: FilterKey;
    label: string;
    value: number | string;
    color: string;
    sub?: string;
    onClick?: () => void;
  }> = [
    {
      key: 'all',
      label: 'Total Items',
      value: summary.totalItems,
      color: 'var(--cyan)',
      sub: `${summary.totalStockPieces} total pieces`,
      onClick: () => setFilter('all'),
    },
    {
      key: 'all',
      label: 'Items in Stock',
      value: summary.itemsInStockCount,
      color: 'var(--green)',
    },
    {
      key: 'low',
      label: 'Low Stock Alert',
      value: summary.lowStockCount,
      color: 'var(--red)',
      sub: 'Below minimum level',
      onClick: () => setFilter(filter === 'low' ? 'all' : 'low'),
    },
    {
      key: 'zero',
      label: 'Zero Stock',
      value: summary.zeroStockCount,
      color: 'var(--amber)',
      onClick: () => setFilter(filter === 'zero' ? 'all' : 'zero'),
    },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 16,
      }}
    >
      {tiles.map((t, i) => {
        const active = filter !== 'all' && t.key === filter;
        return (
          <div
            key={i}
            onClick={t.onClick}
            style={{
              padding: 14,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderTop: `3px solid ${t.color}`,
              borderRadius: 6,
              cursor: t.onClick ? 'pointer' : 'default',
              textAlign: 'center',
              boxShadow: active ? `0 0 0 2px ${t.color}` : undefined,
              transition: 'box-shadow .15s',
            }}
          >
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 22,
                fontWeight: 700,
                color: t.color,
                marginTop: 2,
              }}
            >
              {t.value}
            </div>
            {t.sub ? (
              <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
                {t.sub}
              </div>
            ) : null}
          </div>
        );
      })}
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Adjust failed'),
    });
  };

  return (
    <ModalShell onClose={onClose} title={`± Stock Adjustment — ${row.itemCode}`}>
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          background: 'var(--bg3)',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <span className="text3">Current Stock:</span>{' '}
        <span className="mono fw-700" style={{ fontSize: 18, color: 'var(--green)' }}>
          {row.inStock} {row.uom}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Adjustment Type
          </div>
          <select
            className="innovic-select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}
          >
            <option value="add">+ Add Stock</option>
            <option value="remove">− Remove Stock</option>
          </select>
        </div>
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Quantity ★
          </div>
          <input
            type="number"
            min={1}
            className="innovic-input"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Reason / Remarks ★
          </div>
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
            color: 'var(--red)',
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={mut.isPending}
        >
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
      setErr('Enter a non-negative integer');
      return;
    }
    const input: SetMinStockInput = { itemId: row.itemId, minQty: n };
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
    });
  };

  return (
    <ModalShell onClose={onClose} title={`Min Stock — ${row.itemCode}`}>
      <div
        className="text3"
        style={{ fontSize: 12, marginBottom: 10 }}
      >
        Sets the low-stock alert threshold for <b>{row.itemName}</b>. Items show a 🔴 LOW tag
        when current stock ≤ this value. Use 0 to disable.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Min Stock Qty
          </div>
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
            color: 'var(--red)',
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={mut.isPending}
        >
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

  const selected = useMemo(
    () => rows.find((r) => r.itemId === itemId) ?? null,
    [rows, itemId],
  );
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to record receipt'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="+ Manual Stock Receipt">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: 'span 2' }}>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Item ★
          </div>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search item…"
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
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Quantity ★
          </div>
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
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Source
          </div>
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
        <div>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Reference No.
          </div>
          <input
            type="text"
            className="innovic-input"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            placeholder="JC / PO / GRN number"
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
          >
            Remarks
          </div>
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
            color: 'var(--red)',
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSave}
          disabled={mut.isPending}
        >
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

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(520px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
