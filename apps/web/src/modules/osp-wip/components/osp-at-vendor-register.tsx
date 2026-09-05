// OSP At-Vendor / WIP Register (read-only) — folded in as the "At-Vendor
// Register" tab of the OSP / JW Outward DC screen. How much of each outsourced
// job is still at the vendor, came back accepted, or was never sent. Backed by
// the v_osp_wip view (migration 0064). Every ordered unit reconciles into a
// bucket: order_qty = accepted + in_qc + at_vendor + not_sent.

import type { ListOspWipResponse, OspWipRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useOspWip } from '../api';

type FilterKey = 'all' | 'at_vendor' | 'not_sent' | 'ready_to_send';

export function OspAtVendorRegister(): React.JSX.Element {
  // Opens on 'all', not 'at_vendor'. The at-vendor bucket is empty whenever
  // every outsourced op has come back, so defaulting to it showed an empty
  // table on a register that does have rows. The KPI tile still filters to it.
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = useOspWip({
    filter,
    search: search.trim() || undefined,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-3">
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
                    (Filtered:{' '}
                    {filter === 'at_vendor'
                      ? 'still at vendor'
                      : filter === 'not_sent'
                        ? 'not yet sent'
                        : 'ready to send today'}
                    )
                  </span>
                ) : null}
              </span>
              {filter !== 'all' ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter('all')}>
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
                    <th className="td-ctr" style={{ color: 'var(--cyan)' }}>
                      In QC
                    </th>
                    <th className="td-ctr" style={{ color: 'var(--green)' }}>
                      Accepted
                    </th>
                    <th className="td-ctr">Rejected</th>
                    <th className="td-ctr" style={{ color: 'var(--blue)' }}>
                      Not Sent
                    </th>
                    {/* Purple: the only colour in this table not already spoken for by a
                        bucket (it labels the item CODE, never a quantity), so a purple
                        number cannot be misread as at-vendor/in-QC/accepted/not-sent. */}
                    <th className="td-ctr" style={{ color: 'var(--purple)' }}>
                      Ready to Send
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="empty-state">
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
            💡 Every ordered piece reconciles as{' '}
            <b>Ordered = Accepted + In-QC + At-Vendor + Not-Sent</b>. "Accepted" is incoming-QC
            passed; "In QC" is returned but QC still pending; "At Vendor" is material physically out
            (sent − returned) — all tracked here, not in finished stock. <b>Not Sent</b> is the
            order balance still to be outsourced eventually; <b>Ready to Send</b> is how much the
            previous operation has actually cleared, i.e. what a challan will accept today.
            Figures are derived from job-card counters and the return GRN's incoming QC; nothing
            is keyed in.
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
        <span className="mono fw-700" style={{ color: row.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}>
          {row.inQcQty || '—'}
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
      {/* Not Sent is order − sent, an ORDER-level figure that over-states what may
          physically leave (JC-8 op 8 read 70 while op 7 had cleared only 30, all of
          them already out). This is the shop-floor number the challan will accept. */}
      <td className="td-ctr">
        <span
          className="mono fw-700"
          style={{ color: row.readyToSendQty > 0 ? 'var(--purple)' : 'var(--text3)' }}
        >
          {row.readyToSendQty || '—'}
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
    variant: 'cyan' | 'amber' | 'blue' | 'green' | 'purple';
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
      // 'purple' matches the column below it. Like the 'blue' tile above, the
      // theme defines no `.stat-card.purple` accent bar (see innovic-theme.css
      // L468) — the tile renders bar-less, exactly as Not Sent already does.
      variant: 'purple',
      label: 'Ready to Send (pcs)',
      value: summary.readyToSendQty,
      sub: 'Cleared upstream, can go today',
      onClick: () => setFilter(filter === 'ready_to_send' ? 'all' : 'ready_to_send'),
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
