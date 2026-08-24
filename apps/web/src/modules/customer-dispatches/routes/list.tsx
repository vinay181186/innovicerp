// Customer Dispatch Register — mirror of legacy `renderDispatchRegister`
// (L10711): 3 KPI tiles + item-wise summary panel + dispatch log + search +
// 🖨 Print. Per user direction 2026-06-06 the log is ONE ROW PER DISPATCH,
// click to expand its item lines (SO-Master expand pattern); SO filter +
// Export Excel (all dispatches flattened to line rows, or the filtered SO).
// Ours on top of legacy: Dispatch No. + Status columns, 🧾 Invoice (pre-filled
// invoice form) + ✖ Cancel actions (dispatch docs gate invoicing).
//
// Styled to SO Master (sales-orders/routes/list.tsx): frozen header band, one
// `.panel` card per dispatch instead of the 11-column table that scrolled
// sideways. Nothing about the data, the filters or the mutations changed.
//
// 2026-08-13: the 3 KPI tiles (three `.panel` cards in a 3-col grid, below the
// band, scrolling away with the list) are one `<StatStrip>` inside the band —
// styling skill Rule 3. Read-only metrics, not filters, so the strip's cells
// render as divs. Same three numbers over the same ACTIVE rows.

import type { CustomerDispatchRegisterRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { JwDispatchView } from '@/modules/jw-returns/components/jw-dispatch-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useCancelDispatch, useDispatchRegister } from '../api';
import { type DispatchGroup, DispatchCard } from '../components/dispatch-card';
import { exportDispatchRegister } from '../lib/export-excel';
import { printCustomerDispatchRegister } from '../lib/print-register';

export const customerDispatchListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches',
  component: CustomerDispatchListPage,
});

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
  // JW Dispatch (jw-returns) folded in here as a tab — same job, two document
  // families: this one ships finished goods against an SO, that one returns
  // machined goods against a JWSO line. Its own hooks/mutations are unchanged.
  const [tab, setTab] = useState<'so' | 'jw'>('so');
  const { data, isLoading, isFetching, isError, error } = useDispatchRegister();
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

  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.dispatchId));

  const tabBar = (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
      {(['so', 'jw'] as const).map((t) => (
        <button key={t} type="button" onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent', color: tab === t ? 'var(--cyan)' : 'var(--text3)', fontSize: 12, fontWeight: 700, padding: '6px 12px', cursor: 'pointer', marginBottom: -1 }}>{t === 'so' ? '🚚 Customer Dispatch' : '📦 JW Dispatch'}</button>
      ))}
    </div>
  );

  if (tab === 'jw') {
    return (
      <div>
        {tabBar}
        <JwDispatchView />
      </div>
    );
  }

  return (
    <div>
      {tabBar}
      {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          Title + count + filters + Export/Print/New stay pinned while the cards
          scroll underneath. `#content` is the scroll container, so top:0 pins this
          to its padding box; the background must be opaque var(--bg) or cards show
          through as they pass under. Not bled to the edges — that would give the
          app a horizontal scrollbar. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              📦 Dispatch Register
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {groups.length} dispatch{groups.length === 1 ? '' : 'es'}
              {soFilter ? (
                <>
                  {' '}· <span className="text2">{soFilter}</span> only
                </>
              ) : null}
            </div>
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
              title="Export the current (SO-filtered) register to Excel"
              onClick={() => exportDispatchRegister(soRows, soFilter || undefined)}
            >
              📊 Export Excel
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12 }}
              title="Print the dispatch register"
              onClick={() => printCustomerDispatchRegister({ rows: active, company })}
            >
              🖨 Print
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12 }}
              disabled={groups.length === 0}
              title={allExpanded ? 'Hide every card’s items' : 'Show every card’s items'}
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(groups.map((g) => g.dispatchId)))
              }
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            <Link to="/customer-dispatches/new" className="btn btn-primary">
              + New Dispatch
            </Link>
          </div>
        </div>

        {/* The three KPIs were three `.panel` tiles in a 3-col grid below the
            band — centred text, ~120px tall, and they scrolled away with the
            list. Now one strip in the band (styling skill Rule 3). Read-only
            metrics, so no onClick: they are totals, not filters. Counts are
            over ACTIVE rows (cancelled dispatches were reversed) and follow the
            SO filter + search, exactly as before. */}
        <div style={{ marginTop: 10 }}>
          <StatStrip
            items={[
              {
                key: 'pcs',
                label: 'Total Dispatched',
                count: totalPcs,
                color: 'var(--red)',
                sub: 'pieces',
              },
              {
                key: 'entries',
                label: 'Dispatch Entries',
                count: groups.filter((g) => g.status !== 'cancelled').length,
              },
              {
                key: 'items',
                label: 'Items Dispatched',
                count: summary.length,
                color: 'var(--cyan)',
              },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…
        </div>
      ) : isError || !data ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load'}
        </div>
      ) : (
        <>
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

          <div
            style={{
              fontSize: 11,
              color: 'var(--cyan)',
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              margin: '4px 0 8px',
            }}
          >
            DISPATCH LOG
          </div>

          {groups.length === 0 ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              No dispatches recorded yet — click + New Dispatch
            </div>
          ) : (
            groups.map((g) => (
              <DispatchCard
                key={g.dispatchId}
                g={g}
                isOpen={expanded.has(g.dispatchId)}
                cancelPending={cancel.isPending}
                onToggle={() => toggle(g.dispatchId)}
                onCancel={() => {
                  if (confirm(`Cancel dispatch ${g.code} (all its lines)? This reverses the dispatched qty + stock.`)) {
                    cancel.mutate(g.dispatchId);
                  }
                }}
              />
            ))
          )}

          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8, padding: '0 4px' }}>
            💡 Click a card to show the items on that dispatch · <b>🧾 Invoice</b> opens a
            pre-filled invoice · <b>Cancel</b> reverses the dispatched qty and the stock.
          </div>
        </>
      )}
    </div>
  );
}
