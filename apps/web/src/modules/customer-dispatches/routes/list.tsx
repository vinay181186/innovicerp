// Customer Dispatch Register — mirror of legacy `renderDispatchRegister`
// (L10711): 3 KPI tiles + item-wise summary panel + dispatch log + search +
// 🖨 Print. Per user direction 2026-06-06 the log is ONE ROW PER DISPATCH,
// click to expand its item lines (SO-Master expand pattern); SO filter +
// Export Excel (all dispatches flattened to line rows, or the filtered SO).
// Ours on top of legacy: Dispatch No. + Status columns, 🧾 Invoice (pre-filled
// invoice form) + ✖ Cancel actions (dispatch docs gate invoicing).

import type { CustomerDispatchRegisterRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useCancelDispatch, useDispatchRegister } from '../api';
import { exportDispatchRegister } from '../lib/export-excel';
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

type DispatchGroup = {
  dispatchId: string;
  code: string;
  date: string;
  soNo: string | null;
  customer: string | null;
  dispatchedBy: string | null;
  remarks: string | null;
  status: CustomerDispatchRegisterRow['status'];
  lines: CustomerDispatchRegisterRow[];
  totalQty: number;
};

function groupByDispatch(rows: CustomerDispatchRegisterRow[]): DispatchGroup[] {
  const groups: DispatchGroup[] = [];
  const byId = new Map<string, DispatchGroup>();
  for (const r of rows) {
    let g = byId.get(r.dispatchId);
    if (!g) {
      g = {
        dispatchId: r.dispatchId,
        code: r.dispatchCode,
        date: r.date,
        soNo: r.soNo,
        customer: r.customer,
        dispatchedBy: r.dispatchedBy,
        remarks: r.remarks,
        status: r.status,
        lines: [],
        totalQty: 0,
      };
      byId.set(r.dispatchId, g);
      groups.push(g);
    }
    g.lines.push(r);
    g.totalQty += r.qty;
  }
  return groups;
}

function CustomerDispatchListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useDispatchRegister();
  const { data: company } = useMyCompany();
  const cancel = useCancelDispatch();
  const [search, setSearch] = useState('');
  const [soFilter, setSoFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const soOptions = useMemo(
    () => [...new Set(allRows.map((r) => r.soNo).filter((s): s is string => Boolean(s)))],
    [allRows],
  );

  // SO filter applies to screen AND export; text search is screen-only.
  const soRows = useMemo(
    () => (soFilter ? allRows.filter((r) => r.soNo === soFilter) : allRows),
    [allRows, soFilter],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return soRows;
    return soRows.filter((r) =>
      [r.dispatchCode, r.jcNo, r.soNo, r.clientPoLineNo, r.itemCode, r.itemCodeText, r.itemName, r.customer, r.dispatchedBy, r.remarks]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [soRows, search]);

  const groups = useMemo(() => groupByDispatch(rows), [rows]);

  // KPIs + item-wise summary over ACTIVE rows only (cancelled were reversed).
  const active = useMemo(() => rows.filter((r) => r.status !== 'cancelled'), [rows]);
  const totalPcs = active.reduce((s, r) => s + r.qty, 0);
  const summary = useMemo(() => {
    const m = new Map<
      string,
      { code: string; name: string; total: number; count: number; stock: number | null }
    >();
    for (const r of active) {
      const key = r.itemCode ?? r.itemCodeText ?? r.itemName;
      const cur = m.get(key) ?? {
        code: r.itemCode ?? r.itemCodeText ?? '—',
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

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📦 Dispatch Register
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="innovic-select"
            value={soFilter}
            onChange={(e) => setSoFilter(e.target.value)}
            style={{ width: 160, fontSize: 12 }}
          >
            <option value="">All SOs</option>
            {soOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            className="innovic-input"
            placeholder="Search item, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 12 }}
            onClick={() => exportDispatchRegister(soRows, soFilter || undefined)}
          >
            📊 Export Excel
          </button>
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
          <div style={tileVal}>{groups.filter((g) => g.status !== 'cancelled').length}</div>
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
          <span className="text3" style={{ fontSize: 10 }}>click a row to see its items</span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th>Dispatch No.</th>
                <th>Date</th>
                <th>SO No.</th>
                <th>Customer / Ref</th>
                <th className="td-ctr">Lines</th>
                <th className="td-ctr" style={{ color: 'var(--red)' }}>Total Qty</th>
                <th>Dispatched By</th>
                <th>Remarks</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-state">
                    No dispatches recorded yet — click + New Dispatch
                  </td>
                </tr>
              ) : (
                groups.map((g) => {
                  const isOpen = expanded.has(g.dispatchId);
                  const cancelled = g.status === 'cancelled';
                  return (
                    <DispatchRows
                      key={g.dispatchId}
                      g={g}
                      isOpen={isOpen}
                      cancelled={cancelled}
                      cancelPending={cancel.isPending}
                      onToggle={() => toggle(g.dispatchId)}
                      onCancel={() => {
                        if (confirm(`Cancel dispatch ${g.code} (all its lines)? This reverses the dispatched qty + stock.`)) {
                          cancel.mutate(g.dispatchId);
                        }
                      }}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DispatchRows(props: {
  g: DispatchGroup;
  isOpen: boolean;
  cancelled: boolean;
  cancelPending: boolean;
  onToggle: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { g, isOpen, cancelled } = props;
  return (
    <>
      <tr
        onClick={props.onToggle}
        style={{ cursor: 'pointer', ...(cancelled ? { opacity: 0.55 } : null) }}
      >
        <td className="td-ctr" style={{ color: 'var(--text3)', fontSize: 10 }}>{isOpen ? '▾' : '▸'}</td>
        <td className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800 }}>{g.code}</td>
        <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{g.date}</td>
        <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>{g.soNo ?? '—'}</td>
        <td className="fw-700">{g.customer ?? '—'}</td>
        <td className="td-ctr mono">{g.lines.length}</td>
        <td className="td-ctr mono fw-700" style={{ fontSize: 15, color: 'var(--red)' }}>-{g.totalQty}</td>
        <td className="text2" style={{ fontSize: 11 }}>{g.dispatchedBy ?? '—'}</td>
        <td className="text2" style={{ fontSize: 11 }}>{g.remarks ?? '—'}</td>
        <td>
          <span className={`badge ${cancelled ? 'b-grey' : 'b-green'}`}>{g.status}</span>
        </td>
        {/* Stop row-toggle when clicking the action buttons. */}
        <td onClick={(e) => e.stopPropagation()}>
          {!cancelled ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <Link
                to="/invoices/new"
                search={{ dispatchId: g.dispatchId }}
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--green)', fontSize: 10 }}
              >
                🧾 Invoice
              </Link>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red)', fontSize: 10 }}
                disabled={props.cancelPending}
                onClick={props.onCancel}
              >
                ✖ Cancel
              </button>
            </div>
          ) : null}
        </td>
      </tr>
      {isOpen ? (
        <tr style={cancelled ? { opacity: 0.55 } : undefined}>
          <td />
          <td colSpan={10} style={{ padding: '4px 8px 10px', background: 'var(--bg3)' }}>
            <table className="innovic-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>JC No.</th>
                  <th style={{ color: 'var(--purple)' }}>CPO Ln</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>Qty</th>
                  <th className="td-ctr">UOM</th>
                  <th className="td-ctr">Stock B→A</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={`${l.dispatchId}-${i}`}>
                    <td className="td-ctr mono">{i + 1}</td>
                    <td className="td-code" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                      {l.jcNo ?? <span style={{ color: 'var(--text3)' }}>—</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>{l.itemCode ?? l.itemCodeText ?? '—'}</td>
                    <td className="fw-700">{l.itemName}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>-{l.qty}</td>
                    <td className="td-ctr">
                      <span className="badge" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>
                        {l.uom ?? 'NOS'}
                      </span>
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {l.stockBefore ?? '—'}→{l.stockAfter ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}
