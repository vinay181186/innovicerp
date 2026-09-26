// Pending SO Value (PL-PSV-1) — sales revenue / cashflow rollup.
//
// Mirrors legacy renderPendingSOValue (HTML L19272). 4 filter buttons +
// 5-tile KPI strip + 11-col table with totals row. See
// docs/PARITY/pendingsovalue.md for the parity spec.

import type {
  PendingSoValueFilter,
  PendingSoValueResponse,
  PendingSoValueRow,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell, reportTotalRowStyle } from '@/ui/data/ReportShell';
import { ListFooter } from '@/ui/layout';
import { soStatusLabel } from '@/modules/sales-orders/lib/so-status-label';
import { usePendingSoValue } from '../api';

export const pendingSoValueRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'pending-so-value',
  component: PendingSoValuePage,
});

const FILTERS: Array<{ key: PendingSoValueFilter; label: string }> = [
  { key: 'open', label: 'Open / Pending' },
  { key: 'all', label: 'All SOs' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
];

function PendingSoValuePage(): React.JSX.Element {
  const [filter, setFilter] = useState<PendingSoValueFilter>('open');
  const [search, setSearch] = useState<string>('');
  const { data, isLoading, isError, error } = usePendingSoValue(filter);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) => `${r.soCode} ${r.customerName ?? ''}`.toLowerCase().includes(q));
  }, [data, search]);

  // Money hidden for L1 Viewers: the API nulls every value on this report, so
  // the KPI strip and the six value columns are dropped.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = !!data && !data.priceVisible;

  // Totals row: the server's totals cover exactly the rows it sent, so they are
  // shown as-is. Only when the search box narrows the rows on screen is the
  // row a display-only sum of the visible rows (the same figures, re-added).
  const tfootTotals = useMemo(() => {
    if (!data) return null;
    if (!search.trim()) return data.totals;
    const sum = (k: keyof PendingSoValueRow): string =>
      String(filtered.reduce((acc, r) => acc + Number(r[k] ?? 0), 0));
    return {
      soCount: filtered.length,
      orderValue: sum('orderValue'),
      dispatchedValue: sum('dispatchedValue'),
      pendingValue: sum('pendingValue'),
      invoicedValue: sum('invoicedValue'),
      receivedValue: sum('receivedValue'),
      outstandingValue: sum('outstandingValue'),
    };
  }, [data, filtered, search]);

  return (
    <ReportShell
      title="Pending SO Value"
      icon="💰"
      filters={
        <>
          <ReportFilter label="SO Filter" htmlFor="psv-filter">
            <select
              id="psv-filter"
              className="innovic-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value as PendingSoValueFilter)}
            >
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </ReportFilter>
          <ReportFilter label="Search" htmlFor="psv-search" size="lg">
            <input
              id="psv-search"
              type="text"
              className="innovic-input"
              placeholder="Search SO No., customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </ReportFilter>
        </>
      }
      onClear={() => {
        setFilter('open');
        setSearch('');
      }}
      kpis={data && !priceHidden ? <KpiStrip totals={data.totals} /> : undefined}
      footer={
        data ? (
          <>
            <ListFooter total={data.rows.length} shown={filtered.length} noun="SO" />
            {/* Legacy's tip opens "Click any SO row to see line-level breakdown."
                (_psvDetail L19382) — that modal was never ported, so only the
                second, true clause is copied. */}
            <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
              💡 Pending Value = Order Value − Dispatched Value.
            </div>
          </>
        ) : null
      }
    >
      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3">
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error
                ? error.message
                : 'Could not load pending SO value. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        filtered.length === 0 ? (
          <div className="panel">
            <div className="panel-body">
              <div className="empty-state">
                <div className="empty-icon">💰</div>
                {data.rows.length === 0
                  ? `No SOs match filter "${filter}".`
                  : 'No SOs match your search.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>SO No.</th>
                    <th>Customer</th>
                    <th>SO Date</th>
                    <th>Due Date</th>
                    {priceHidden ? null : (
                      <>
                        <th className="th-num">Order Value</th>
                        <th className="th-num">Dispatched</th>
                        <th className="th-num" style={{ color: 'var(--amber2)' }}>
                          Pending Value
                        </th>
                        <th className="th-num">Invoiced</th>
                        <th className="th-num">Amount Received</th>
                        <th className="th-num">Outstanding</th>
                      </>
                    )}
                    <th>SO Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <PsvRow key={row.soId} row={row} priceHidden={priceHidden} />
                  ))}
                </tbody>
                {priceHidden || !tfootTotals ? null : (
                  <tfoot>
                    <tr style={reportTotalRowStyle}>
                      <td colSpan={4} style={{ color: 'var(--text2)' }}>
                        TOTAL ({tfootTotals.soCount} SOs)
                      </td>
                      <td className="td-num mono">{inr(tfootTotals.orderValue)}</td>
                      <td className="td-num mono">{inr(tfootTotals.dispatchedValue)}</td>
                      <td className="td-num mono" style={{ color: 'var(--amber2)' }}>
                        {inr(tfootTotals.pendingValue)}
                      </td>
                      <td className="td-num mono">{inr(tfootTotals.invoicedValue)}</td>
                      <td className="td-num mono">{inr(tfootTotals.receivedValue)}</td>
                      <td className="td-num mono">{inr(tfootTotals.outstandingValue)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      ) : null}
    </ReportShell>
  );
}

// Legacy colours the Invoiced figures `var(--teal,#0d9488)` (L19338/19359/19371).
// `--teal` is now a real token (tokens.css), so the hex fallback is dropped.
const TEAL = 'var(--teal)';

const inr = (v: string | number | null): string => {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '0%');

function KpiStrip({ totals }: { totals: PendingSoValueResponse['totals'] }): React.JSX.Element {
  const o = Number(totals.orderValue);
  const d = Number(totals.dispatchedValue);
  const p = Number(totals.pendingValue);
  const i = Number(totals.invoicedValue);
  const out = Number(totals.outstandingValue);
  return (
    <StatStrip
      items={[
        {
          key: 'order',
          label: 'Order Value',
          count: inr(totals.orderValue),
          color: 'var(--cyan)',
          sub: `${totals.soCount} SOs`,
        },
        {
          key: 'dispatched',
          label: 'Dispatched Value',
          count: inr(totals.dispatchedValue),
          color: 'var(--green2)',
          sub: pct(d, o),
        },
        {
          key: 'pending',
          label: 'Pending Value',
          count: inr(totals.pendingValue),
          color: 'var(--amber2)',
          sub: pct(p, o),
        },
        {
          key: 'invoiced',
          label: 'Invoiced',
          count: inr(totals.invoicedValue),
          color: TEAL,
          sub: `${pct(i, d)} of dispatched`,
        },
        {
          key: 'received',
          label: 'Received',
          count: inr(totals.receivedValue),
          color: 'var(--green2)',
          sub: `${pct(Number(totals.receivedValue), i)} of invoiced`,
        },
        {
          key: 'outstanding',
          label: 'Outstanding',
          count: inr(totals.outstandingValue),
          color: out > 0 ? 'var(--red)' : 'var(--green)',
          sub: `${pct(out, i)} of invoiced`,
        },
      ]}
    />
  );
}

function PsvRow({
  row,
  priceHidden,
}: {
  row: PendingSoValueRow;
  priceHidden: boolean;
}): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const pending = Number(row.pendingValue ?? 0);
  const outstanding = Number(row.outstandingValue ?? 0);
  const overdue = row.dueDate !== null && row.dueDate < today && pending > 0;
  return (
    <tr>
      <td>
        <Link
          to="/sales-orders/$id"
          params={{ id: row.soId }}
          className="mono fw-700"
          style={{ color: 'var(--cyan)' }}
        >
          {row.soCode}
        </Link>
      </td>
      <td>{row.customerName ?? '—'}</td>
      <td>{fmtDate(row.soDate)}</td>
      <td
        style={{
          color: overdue ? 'var(--red)' : undefined,
          fontWeight: overdue ? 700 : undefined,
        }}
      >
        {fmtDate(row.dueDate)}
        {overdue ? ' ⚠' : ''}
      </td>
      {priceHidden ? null : (
        <>
          <td className="td-num mono">{inr(row.orderValue)}</td>
          <td className="td-num mono" style={{ color: 'var(--green2)' }}>
            {inr(row.dispatchedValue)}
          </td>
          <td
            className="td-num mono fw-700"
            style={{ color: pending > 0 ? 'var(--amber)' : 'var(--green)' }}
          >
            {inr(row.pendingValue)}
          </td>
          <td className="td-num mono" style={{ color: TEAL }}>
            {inr(row.invoicedValue)}
          </td>
          <td className="td-num mono" style={{ color: 'var(--green2)' }}>
            {inr(row.receivedValue)}
          </td>
          <td
            className="td-num mono"
            style={{ color: outstanding > 0 ? 'var(--red)' : 'var(--green)' }}
          >
            {inr(row.outstandingValue)}
          </td>
        </>
      )}
      <td>
        <span className={`badge b-${badgeColor(row.status)}`}>{soStatusLabel(row.status)}</span>
      </td>
    </tr>
  );
}

// Legacy badge() L1959-1970 maps the SO statuses it knows: Open→b-cyan,
// Closed/Completed→b-green, Cancelled→b-red. 'draft' and 'dispatched' have no
// entry there, so legacy falls through to b-grey — mirrored here.
function badgeColor(status: string): string {
  if (status === 'open') return 'cyan';
  if (status === 'closed') return 'green';
  if (status === 'cancelled') return 'red';
  return 'grey';
}
