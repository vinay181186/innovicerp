// Pending SO Value (PL-PSV-1) — sales revenue / cashflow rollup.
//
// Mirrors legacy renderPendingSOValue (HTML L19272). The ONE Innovic fit table
// (ADR-199, table standard 2026-10-01): one ruled sheet, the first column (SO
// No.) always pinned and carrying the row's ▸. The money totals are the
// engine's column-following totals (showTotals + per-column `total`), so a
// money column moved into ▸ takes its total with it — this replaced the old
// hand-written <tfoot> row. ▸ opens SO Date, Invoiced Value and Received
// (default-hidden columns). The columns, money formatter and row tint live in
// components/psv-columns.tsx. See docs/PARITY/pendingsovalue.md.

import type {
  PendingSoValueFilter,
  PendingSoValueResponse,
  PendingSoValueRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { ListFooter } from '@/ui/layout';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { TEAL, inr, psvColumns, psvRowTint } from '../components/psv-columns';
import { usePendingSoValue } from '../api';

export const pendingSoValueRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'pending-so-value',
  component: PendingSoValuePage,
});

const FILTERS: Array<{ key: PendingSoValueFilter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'all', label: 'All SOs' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Closed' },
];

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : '0%');

function PendingSoValuePage(): React.JSX.Element {
  const [filter, setFilter] = useState<PendingSoValueFilter>('open');
  const [search, setSearch] = useState<string>('');
  const navigate = pendingSoValueRoute.useNavigate();
  const { data, isLoading, isError, error } = usePendingSoValue(filter);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) => `${r.soCode} ${r.customerName ?? ''}`.toLowerCase().includes(q));
  }, [data, search]);

  // Money hidden for L1 Viewers: the API nulls every value on this report, so
  // the KPI strip, the money columns and the totals row are dropped. Told by
  // the server, not inferred from a null money field.
  const priceHidden = !!data && !data.priceVisible;
  const today = todayIst();
  const columns = useMemo(() => psvColumns(priceHidden, today), [priceHidden, today]);
  const defaultHidden = priceHidden ? ['so_date'] : ['so_date', 'invoiced_value', 'received_value'];

  const emptyText =
    data && data.rows.length === 0
      ? `No SOs in ${FILTERS.find((f) => f.key === filter)?.label ?? 'this filter'}.`
      : 'No SOs match.';

  return (
    <ReportShell
      title="Pending SO Value"
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
        data ? <ListFooter total={data.rows.length} shown={filtered.length} noun="SO" /> : null
      }
    >
      {isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error
                ? error.message
                : 'Could not load pending SO value. Try again.'}
            </div>
          </div>
        </div>
      ) : (
        <Panel bodyPadding="none">
          <DataTable<PendingSoValueRow>
            tableKey={TABLE_KEYS.pendingSoValue}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.soId}
            loading={isLoading}
            empty={emptyText}
            defaultHidden={defaultHidden}
            // The engine's column-following totals replace the old hand-written
            // <tfoot>: each money column's `total` sits under its own column and
            // moves with it into ▸. No totals row for a Viewer (no money).
            showTotals={!priceHidden}
            totalsLabel="Total"
            rowClassName={(r) => psvRowTint(r, today)}
            onRowClick={(r) => void navigate({ to: '/sales-orders/$id', params: { id: r.soId } })}
          />
        </Panel>
      )}
    </ReportShell>
  );
}

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
          label: 'Value to Dispatch',
          count: inr(totals.pendingValue),
          color: 'var(--amber2)',
          sub: pct(p, o),
        },
        {
          key: 'invoiced',
          label: 'Invoiced Value',
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
          label: 'Outstanding Amount',
          count: inr(totals.outstandingValue),
          color: out > 0 ? 'var(--red)' : 'var(--green)',
          sub: `${pct(out, i)} of invoiced`,
        },
      ]}
    />
  );
}
