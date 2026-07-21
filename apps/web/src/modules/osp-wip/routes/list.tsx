// OSP At-Vendor / WIP Register (read-only) — how much of each outsourced job
// is still physically at the vendor, how much came back accepted, and how much
// was never even sent. Backed by the v_osp_wip view (migration 0064).
//
// Every ordered unit reconciles into a bucket:
//   order_qty = accepted (back good) + at_vendor (still out) + not_sent
//
// This is the answer to "how much is at the vendor in process" WITHOUT
// polluting the finished-stock ledger — see the SO-517 / CONNECTING ROD trace.

import type { ListOspWipResponse, OspWipRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useOspWip } from '../api';

type FilterKey = 'all' | 'at_vendor' | 'not_sent';

export const ospWipRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'osp-wip',
  component: OspWipPage,
});

function OspWipPage(): React.JSX.Element {
  const [filter, setFilter] = useState<FilterKey>('at_vendor');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = useOspWip({
    filter,
    search: search.trim() || undefined,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">🚚 OSP At-Vendor Register</div>
        <input
          type="text"
          className="innovic-input"
          placeholder="🔍 Search JC, item, SO, vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260, fontSize: 12 }}
        />
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
              {error instanceof Error ? error.message : 'Failed to load OSP register'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip summary={data.summary} filter={filter} setFilter={setFilter} />

          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                Outsourced Operations{' '}
                {filter !== 'all' ? (
                  <span style={{ color: 'var(--amber)', fontSize: 12 }}>
                    (Filtered: {filter === 'at_vendor' ? 'still at vendor' : 'not yet sent'})
                  </span>
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
                    <th>Job Card</th>
                    <th>Item Code</th>
                    <th>Name</th>
                    <th>SO No.</th>
                    <th>Vendor</th>
                    <th>Operation</th>
                    <th className="td-ctr">Ordered</th>
                    <th className="td-ctr">Sent</th>
                    <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                      At Vendor
                    </th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>
                      Accepted
                    </th>
                    <th className="td-ctr">Rejected</th>
                    <th className="td-ctr" style={{ color: 'var(--blue)' }}>
                      Not Sent
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="empty-state">
                        No outsourced operations match this filter
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row) => <Row key={row.jcOpId} row={row} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text3" style={{ fontSize: 11, marginTop: 8, padding: '0 4px' }}>
            💡 Every ordered piece reconciles as <b>Ordered = Accepted + At-Vendor + Not-Sent</b>.
            "At Vendor" is material physically out for processing (sent − returned) — it is tracked
            here, not in finished stock. Figures are derived from job-card counters and outward-DC
            receipts; nothing is keyed in.
          </div>
        </>
      ) : null}
    </div>
  );
}

function Row({ row }: { row: OspWipRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code" style={{ color: 'var(--cyan)' }}>
        {row.jcCode}
      </td>
      <td className="td-code" style={{ color: 'var(--purple)' }}>
        {row.itemCode ?? '—'}
      </td>
      <td className="fw-700">{row.itemName ?? '—'}</td>
      <td className="mono text2" style={{ fontSize: 11 }}>
        {row.soCode ?? '—'}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {row.vendorName ?? '—'}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {row.operation ?? `Op ${row.opSeq}`}
      </td>
      <td className="td-ctr mono">{row.orderQty}</td>
      <td className="td-ctr mono text3">{row.sentQty || '—'}</td>
      <td className="td-ctr">
        <span
          className="mono fw-700"
          style={{ fontSize: 14, color: row.atVendorQty > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {row.atVendorQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: row.acceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}>
          {row.acceptedQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: row.rejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}>
          {row.rejectedQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono" style={{ color: row.notSentQty > 0 ? 'var(--blue)' : 'var(--text3)' }}>
          {row.notSentQty || '—'}
        </span>
      </td>
    </tr>
  );
}

function KpiStrip({
  summary,
  filter,
  setFilter,
}: {
  summary: ListOspWipResponse['summary'];
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  const tiles: Array<{
    variant: 'cyan' | 'amber' | 'blue' | 'green';
    label: string;
    value: number | string;
    sub?: string;
    onClick?: () => void;
  }> = [
    {
      variant: 'cyan',
      label: 'Outsourced Ops',
      value: summary.totalOps,
      sub: `${summary.sentQty} pcs sent to vendors`,
      onClick: () => setFilter('all'),
    },
    {
      variant: 'amber',
      label: 'At Vendor (pcs)',
      value: summary.atVendorQty,
      sub: `${summary.opsAtVendor} ops still out`,
      onClick: () => setFilter(filter === 'at_vendor' ? 'all' : 'at_vendor'),
    },
    {
      variant: 'blue',
      label: 'Not Sent (pcs)',
      value: summary.notSentQty,
      sub: 'Ordered but not dispatched',
      onClick: () => setFilter(filter === 'not_sent' ? 'all' : 'not_sent'),
    },
    {
      variant: 'green',
      label: 'Total Sent (pcs)',
      value: summary.sentQty,
    },
  ];
  return (
    <div className="stat-grid">
      {tiles.map((t, i) => (
        <div
          key={i}
          className={`stat-card ${t.variant}`}
          onClick={t.onClick}
          style={t.onClick ? { cursor: 'pointer' } : undefined}
        >
          <div className="stat-label">{t.label}</div>
          <div className="stat-val">{t.value}</div>
          {t.sub ? <div className="stat-sub">{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
