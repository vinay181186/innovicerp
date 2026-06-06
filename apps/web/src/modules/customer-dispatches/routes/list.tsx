// Customer Dispatch Register — mirror of legacy `renderDispatchRegister`
// (L10711): 3 KPI tiles + item-wise summary panel + line-grain dispatch log
// (Date / JC No. / SO No. / CPO Ln / Item Code / Item Name / −Qty / UOM /
// Customer / Dispatched By / Remarks / Stock B→A) + search + 🖨 Print.
// Ours on top of legacy: Dispatch No. + Status columns and a Cancel action
// (dispatch docs gate invoicing; cancel reverses SO-line qty + stock).

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useCancelDispatch, useDispatchRegister } from '../api';
import { printCustomerDispatchRegister } from '../lib/print-register';

export const customerDispatchListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches',
  component: CustomerDispatchListPage,
});

const tileStyle: React.CSSProperties = { padding: 14, textAlign: 'center' };
const tileLbl: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  marginBottom: 6,
};
const tileVal: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 28,
  fontWeight: 800,
};

function CustomerDispatchListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useDispatchRegister();
  const { data: company } = useMyCompany();
  const cancel = useCancelDispatch();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      [r.dispatchCode, r.jcNo, r.soNo, r.clientPoLineNo, r.itemCode, r.itemName, r.customer, r.dispatchedBy, r.remarks]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  // KPIs + item-wise summary over ACTIVE rows only (cancelled were reversed).
  const active = useMemo(() => rows.filter((r) => r.status !== 'cancelled'), [rows]);
  const totalPcs = active.reduce((s, r) => s + r.qty, 0);
  const summary = useMemo(() => {
    const m = new Map<
      string,
      { code: string; name: string; total: number; count: number; stock: number | null }
    >();
    for (const r of active) {
      const key = r.itemCode ?? r.itemName;
      const cur = m.get(key) ?? {
        code: r.itemCode ?? '—',
        name: r.itemName,
        total: 0,
        count: 0,
        stock: r.currentStock,
      };
      cur.total += r.qty;
      cur.count += 1;
      if (cur.stock === null) cur.stock = r.currentStock;
      m.set(key, cur);
    }
    return [...m.values()];
  }, [active]);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📦 Dispatch Register
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search item, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 12 }}
            onClick={() => printCustomerDispatchRegister({ rows: active, company })}
          >
            🖨 Print
          </button>
          <Link to="/customer-dispatches/new" className="btn btn-primary">
            + New Dispatch
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div className="panel" style={tileStyle}>
          <div style={tileLbl}>Total Dispatched</div>
          <div style={{ ...tileVal, color: 'var(--red)' }}>{totalPcs}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>pieces</div>
        </div>
        <div className="panel" style={tileStyle}>
          <div style={tileLbl}>Dispatch Entries</div>
          <div style={tileVal}>{active.length}</div>
        </div>
        <div className="panel" style={tileStyle}>
          <div style={tileLbl}>Items Dispatched</div>
          <div style={{ ...tileVal, color: 'var(--cyan)' }}>{summary.length}</div>
        </div>
      </div>

      {summary.length > 0 ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Item-wise Summary</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Total Dispatched</th>
                  <th>No. of Dispatches</th>
                  <th style={{ color: 'var(--green)' }}>Current Stock</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.code + s.name}>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>{s.code}</td>
                    <td className="fw-700">{s.name}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>{s.total}</td>
                    <td className="td-ctr mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {s.count} dispatches
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                      {s.stock ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Dispatch Log</span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Dispatch No.</th>
                <th>Date</th>
                <th>JC No.</th>
                <th>SO No.</th>
                <th style={{ color: 'var(--purple)' }}>CPO Ln</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th style={{ color: 'var(--red)' }}>Qty</th>
                <th>UOM</th>
                <th>Customer / Ref</th>
                <th>Dispatched By</th>
                <th>Remarks</th>
                <th>Stock B→A</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="empty-state">
                    No dispatches recorded yet — click + New Dispatch
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={`${r.dispatchId}-${i}`}
                    style={r.status === 'cancelled' ? { opacity: 0.55 } : undefined}
                  >
                    <td className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>
                      {r.dispatchCode}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{r.date}</td>
                    <td className="td-code" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                      {r.jcNo ?? <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.soNo ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>
                      {r.clientPoLineNo ?? '—'}
                    </td>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>{r.itemCode ?? '—'}</td>
                    <td className="fw-700">{r.itemName}</td>
                    <td className="td-ctr mono fw-700" style={{ fontSize: 15, color: 'var(--red)' }}>
                      -{r.qty}
                    </td>
                    <td className="td-ctr">
                      <span className="badge" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>
                        {r.uom ?? 'NOS'}
                      </span>
                    </td>
                    <td>{r.customer ?? '—'}</td>
                    <td className="text2" style={{ fontSize: 11 }}>{r.dispatchedBy ?? '—'}</td>
                    <td className="text2" style={{ fontSize: 11 }}>{r.remarks ?? '—'}</td>
                    <td className="td-ctr mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {r.stockBefore ?? '—'}→{r.stockAfter ?? '—'}
                    </td>
                    <td>
                      <span className={`badge ${r.status === 'cancelled' ? 'b-grey' : 'b-green'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      {r.status !== 'cancelled' ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', fontSize: 10 }}
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Cancel dispatch ${r.dispatchCode} (all its lines)? This reverses the dispatched qty + stock.`,
                              )
                            ) {
                              cancel.mutate(r.dispatchId);
                            }
                          }}
                        >
                          ✖ Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
