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
import { authenticatedRoute } from '@/routes/_authenticated';
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
    return data.rows.filter((r) =>
      `${r.soCode} ${r.customerName ?? ''}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">💰 Pending SO Value</div>
      </div>

      <div
        style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="btn btn-sm"
            onClick={() => setFilter(f.key)}
            style={{
              fontWeight: 700,
              background: filter === f.key ? 'var(--blue)' : 'var(--bg4)',
              color: filter === f.key ? '#fff' : 'var(--text2)',
              border: '1px solid var(--border)',
            }}
          >
            {f.label}
          </button>
        ))}
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
              {error instanceof Error ? error.message : 'Failed to load pending SO value'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip totals={data.totals} />

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 8,
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              className="innovic-input"
              placeholder="🔍 Search SO, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 240, fontSize: 12 }}
            />
            <span className="text3" style={{ fontSize: 12 }}>
              {filtered.length} of {data.rows.length} SOs
            </span>
          </div>

          {filtered.length === 0 ? (
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
                      <th>SO No</th>
                      <th>Customer</th>
                      <th>SO Date</th>
                      <th>Due Date</th>
                      <th className="td-right">Order Value</th>
                      <th className="td-right">Dispatched</th>
                      <th className="td-right" style={{ color: 'var(--amber)' }}>
                        Pending Value
                      </th>
                      <th className="td-right">Invoiced</th>
                      <th className="td-right">Received</th>
                      <th className="td-right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <PsvRow key={row.soId} row={row} />
                    ))}
                    <TotalsRow totals={data.totals} />
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div
            className="text3"
            style={{ fontSize: 11, marginTop: 8 }}
          >
            💡 Pending Value = Order Value − Dispatched Value. Outstanding =
            Invoiced − Received.
          </div>
        </>
      ) : null}
    </div>
  );
}

const inr = (v: string | number): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '0%');

function KpiStrip({
  totals,
}: {
  totals: PendingSoValueResponse['totals'];
}): React.JSX.Element {
  const o = Number(totals.orderValue);
  const d = Number(totals.dispatchedValue);
  const p = Number(totals.pendingValue);
  const i = Number(totals.invoicedValue);
  const out = Number(totals.outstandingValue);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8,
        marginBottom: 16,
      }}
    >
      <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
        <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
          Total Order Value
        </div>
        <div className="mono fw-700" style={{ fontSize: 16, color: 'var(--cyan)' }}>
          {inr(totals.orderValue)}
        </div>
        <div className="text3" style={{ fontSize: 9 }}>
          {totals.soCount} SOs
        </div>
      </div>
      <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
        <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
          Dispatched Value
        </div>
        <div className="mono fw-700" style={{ fontSize: 16, color: 'var(--green)' }}>
          {inr(totals.dispatchedValue)}
        </div>
        <div className="text3" style={{ fontSize: 9 }}>
          {pct(d, o)}
        </div>
      </div>
      <div
        className="panel"
        style={{
          padding: 10,
          textAlign: 'center',
          border: '2px solid var(--amber)',
        }}
      >
        <div style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, textTransform: 'uppercase' }}>
          Pending Dispatch
        </div>
        <div className="mono fw-700" style={{ fontSize: 18, color: 'var(--amber)' }}>
          {inr(totals.pendingValue)}
        </div>
        <div className="text3" style={{ fontSize: 9 }}>
          {pct(p, o)}
        </div>
      </div>
      <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
        <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
          Invoiced
        </div>
        <div className="mono fw-700" style={{ fontSize: 16, color: '#14b8a6' }}>
          {inr(totals.invoicedValue)}
        </div>
        <div className="text3" style={{ fontSize: 9 }}>
          {pct(i, d)} of dispatched
        </div>
      </div>
      <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
        <div className="text3" style={{ fontSize: 9, textTransform: 'uppercase' }}>
          Outstanding
        </div>
        <div
          className="mono fw-700"
          style={{ fontSize: 16, color: out > 0 ? 'var(--red)' : 'var(--green)' }}
        >
          {inr(totals.outstandingValue)}
        </div>
        <div className="text3" style={{ fontSize: 9 }}>
          {pct(out, i)} of invoiced
        </div>
      </div>
    </div>
  );
}

function PsvRow({ row }: { row: PendingSoValueRow }): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const pending = Number(row.pendingValue);
  const outstanding = Number(row.outstandingValue);
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
      <td className="td-ctr" style={{ fontSize: 11 }}>
        {row.soDate}
      </td>
      <td
        className="td-ctr"
        style={{
          fontSize: 11,
          color: overdue ? 'var(--red)' : undefined,
          fontWeight: overdue ? 700 : undefined,
        }}
      >
        {row.dueDate ?? '—'}
        {overdue ? ' ⚠' : ''}
      </td>
      <td className="td-right mono">{inr(row.orderValue)}</td>
      <td className="td-right mono" style={{ color: 'var(--green)' }}>
        {inr(row.dispatchedValue)}
      </td>
      <td
        className="td-right mono fw-700"
        style={{ color: pending > 0 ? 'var(--amber)' : 'var(--green)' }}
      >
        {inr(row.pendingValue)}
      </td>
      <td className="td-right mono" style={{ color: '#14b8a6' }}>
        {inr(row.invoicedValue)}
      </td>
      <td className="td-right mono" style={{ color: 'var(--green)' }}>
        {inr(row.receivedValue)}
      </td>
      <td
        className="td-right mono"
        style={{ color: outstanding > 0 ? 'var(--red)' : 'var(--green)' }}
      >
        {inr(row.outstandingValue)}
      </td>
      <td>
        <span className={`badge b-${badgeColor(row.status)}`}>{row.status}</span>
      </td>
    </tr>
  );
}

function TotalsRow({
  totals,
}: {
  totals: PendingSoValueResponse['totals'];
}): React.JSX.Element {
  return (
    <tr style={{ background: 'var(--bg4)', borderTop: '2px solid var(--border)' }}>
      <td colSpan={4} className="td-right text2" style={{ fontSize: 12, fontWeight: 700 }}>
        TOTAL
      </td>
      <td className="td-right mono fw-700">{inr(totals.orderValue)}</td>
      <td className="td-right mono fw-700" style={{ color: 'var(--green)' }}>
        {inr(totals.dispatchedValue)}
      </td>
      <td className="td-right mono fw-700" style={{ color: 'var(--amber)' }}>
        {inr(totals.pendingValue)}
      </td>
      <td className="td-right mono fw-700" style={{ color: '#14b8a6' }}>
        {inr(totals.invoicedValue)}
      </td>
      <td className="td-right mono fw-700" style={{ color: 'var(--green)' }}>
        {inr(totals.receivedValue)}
      </td>
      <td className="td-right mono fw-700" style={{ color: 'var(--red)' }}>
        {inr(totals.outstandingValue)}
      </td>
      <td />
    </tr>
  );
}

function badgeColor(status: string): string {
  if (status === 'closed' || status === 'dispatched') return 'green';
  if (status === 'cancelled') return 'grey';
  if (status === 'open') return 'blue';
  return 'grey';
}
