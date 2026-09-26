// OSP At-Vendor / WIP Register (read-only) — folded in as the "At-Vendor
// Register" tab of the OSP / JW Outward DC screen. How much of each outsourced
// job is still at the vendor, came back accepted, or was never sent. Backed by
// the v_osp_wip view (migration 0064). Every ordered unit reconciles into a
// bucket: order_qty = accepted + in_qc + at_vendor + not_sent.

import { type ListOspWipResponse, type OspWipRow, opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { StatStrip } from '@/components/shared/stat-strip';
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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load OSP register. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip summary={data.summary} filter={filter} setFilter={setFilter} />

          <div className="panel">
            <div className="panel-hdr">
              {/* The active StatStrip tile shows the filter — no "(Filtered: …)"
                  caption or Show All button (R5 PU-N45). */}
              <span className="panel-title">Outsourced Operations</span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>JC No.</th>
                    {/* POL — the line number printed on the CUSTOMER's own
                        purchase order, immediately before the item code. */}
                    <th style={{ color: 'var(--purple)' }}>POL</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>SO No.</th>
                    <th>Vendor</th>
                    <th>Operation</th>
                    <th className="td-ctr">Order Qty</th>
                    <th className="td-ctr">Sent</th>
                    <th
                      className="td-ctr"
                      style={{ color: 'var(--amber2)' }}
                      title="Physically out at the vendor (sent − returned)"
                    >
                      At Vendor
                    </th>
                    <th
                      className="td-ctr"
                      style={{ color: 'var(--cyan)' }}
                      title="Returned, incoming QC still pending"
                    >
                      In QC
                    </th>
                    <th
                      className="td-ctr"
                      style={{ color: 'var(--green2)' }}
                      title="Accepted at incoming QC"
                    >
                      Accepted
                    </th>
                    <th className="td-ctr">Rejected</th>
                    <th
                      className="td-ctr"
                      style={{ color: 'var(--blue)' }}
                      title="Not yet sent to the vendor"
                    >
                      Not Sent
                    </th>
                    {/* Purple: the only colour in this table not already spoken for by a
                        bucket (it labels the item CODE, never a quantity), so a purple
                        number cannot be misread as at-vendor/in-QC/accepted/not-sent. */}
                    <th
                      className="td-ctr"
                      style={{ color: 'var(--purple)' }}
                      title="Cleared by the previous operation — what a challan accepts today"
                    >
                      Ready to Send
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="empty-state">
                        {filter !== 'all' || search.trim()
                          ? 'No outsourced operations match.'
                          : 'No outsourced operations yet.'}
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
            Order Qty = Accepted + In QC + At Vendor + Not Sent.
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
      {/* POL — '—' when no sales order sits behind the job card. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {row.clientPoLineNo ?? '—'}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
        {itemCodeWithRev(row.itemCode, row.itemRevision)}
      </td>
      <td className="fw-700">{row.itemName ?? '—'}</td>
      <td className="mono text2" style={{ fontSize: 11 }}>
        {row.soCode ?? '—'}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {row.vendorName ?? '—'}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {row.operation ?? `Op ${opSrNo(row.opSeq)}`}
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
        <span
          className="mono fw-700"
          style={{ color: row.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}
        >
          {row.inQcQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span
          className="mono"
          style={{ color: row.acceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {row.acceptedQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span
          className="mono"
          style={{ color: row.rejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
        >
          {row.rejectedQty || '—'}
        </span>
      </td>
      <td className="td-ctr">
        <span
          className="mono"
          style={{ color: row.notSentQty > 0 ? 'var(--blue)' : 'var(--text3)' }}
        >
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

// Counts as the ONE shared StatStrip (styling rule 3). "Outsourced Ops" is the
// All tile, first. Total Sent is a plain total in the body colour — green in
// this table means Accepted (R5 PU-N46).
function KpiStrip({
  summary,
  filter,
  setFilter,
}: {
  summary: ListOspWipResponse['summary'];
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  const toggle = (k: FilterKey) => () => setFilter(filter === k ? 'all' : k);
  return (
    <div style={{ marginBottom: 14 }}>
      <StatStrip
        items={[
          {
            key: 'all',
            label: 'Outsourced Ops',
            count: summary.totalOps,
            color: 'var(--cyan)',
            active: filter === 'all',
            onClick: () => setFilter('all'),
          },
          {
            key: 'at_vendor',
            label: 'At Vendor',
            count: summary.atVendorQty,
            color: 'var(--amber)',
            sub: `${summary.opsAtVendor} ops still out`,
            active: filter === 'at_vendor',
            onClick: toggle('at_vendor'),
          },
          {
            key: 'not_sent',
            label: 'Not Sent',
            count: summary.notSentQty,
            color: 'var(--blue)',
            active: filter === 'not_sent',
            onClick: toggle('not_sent'),
          },
          {
            key: 'ready_to_send',
            label: 'Ready to Send',
            count: summary.readyToSendQty,
            color: 'var(--purple)',
            active: filter === 'ready_to_send',
            onClick: toggle('ready_to_send'),
          },
          { key: 'sent', label: 'Total Sent', count: summary.sentQty },
        ]}
      />
    </div>
  );
}
