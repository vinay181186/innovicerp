// OSP At-Vendor / WIP Register (read-only) — folded in as the "At-Vendor
// Register" tab of the OSP / JW Outward DC screen. How much of each outsourced
// job is still at the vendor, came back accepted, or was never sent. Backed by
// the v_osp_wip view (migration 0064). Every ordered unit reconciles into a
// bucket: order_qty = accepted + in_qc + at_vendor + not_sent.

import { type ListOspWipResponse, type OspWipRow, opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { StatStrip } from '@/ui/data';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useOspWip } from '../api';

type FilterKey = 'all' | 'at_vendor' | 'not_sent' | 'ready_to_send';
const FILTER_LABELS: Record<FilterKey, string | undefined> = {
  all: undefined,
  at_vendor: 'Still at vendor',
  not_sent: 'Not yet sent',
  ready_to_send: 'Ready to send today',
};

export function OspAtVendorRegister(): React.JSX.Element {
  // Opens on 'all', not 'at_vendor'. The at-vendor bucket is empty whenever
  // every outsourced op has come back, so defaulting to it showed an empty
  // table on a register that does have rows. The Bucket dropdown still filters to it.
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error } = useOspWip({
    filter,
    search: search.trim() || undefined,
  });

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count, then the filter
          bar (search · bucket with its qty · Clear), with the read-only
          "Total Sent" tile inside the same band. */}
      <ListHeader
        title="At-Vendor Register"
        icon="🚚"
        count={data?.rows.length}
        noun="outsourced operation"
        filterNote={FILTER_LABELS[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search JC, item, SO, vendor…"
        filters={
          // The qty buckets that used to be clickable strip tiles, now one
          // dropdown with the same numbers in the option labels (owner
          // decision 2026-09-26). The old "Show All" button is the bar's Clear.
          <select
            className="innovic-select"
            aria-label="Bucket"
            title="Bucket"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
          >
            <option value="all">
              {data ? `Outsourced Ops (${data.summary.totalOps})` : 'Outsourced Ops'}
            </option>
            <option value="at_vendor">
              {data
                ? `At Vendor (${data.summary.atVendorQty} · ${data.summary.opsAtVendor} ops)`
                : 'At Vendor'}
            </option>
            <option value="not_sent">
              {data ? `Not Sent (${data.summary.notSentQty})` : 'Not Sent'}
            </option>
            <option value="ready_to_send">
              {data ? `Ready to Send (${data.summary.readyToSendQty})` : 'Ready to Send'}
            </option>
          </select>
        }
        onClearFilters={() => {
          setFilter('all');
          setSearch('');
        }}
        filtersActive={filter !== 'all' || search !== ''}
      >
        {data ? <KpiStrip summary={data.summary} /> : null}
      </ListHeader>

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
          <div className="panel">
            <div className="tbl-wrap">
              <table className="innovic-table tbl-grid">
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
                    <th className="th-num">Order Qty</th>
                    <th className="th-num">Sent</th>
                    <th
                      className="th-num"
                      style={{ color: 'var(--amber2)' }}
                      title="Physically out at the vendor (sent − returned)"
                    >
                      At Vendor
                    </th>
                    <th
                      className="th-num"
                      style={{ color: 'var(--cyan)' }}
                      title="Returned, incoming QC still pending"
                    >
                      In QC
                    </th>
                    <th
                      className="th-num"
                      style={{ color: 'var(--green2)' }}
                      title="Accepted at incoming QC"
                    >
                      Accepted
                    </th>
                    <th className="th-num">Rejected</th>
                    <th
                      className="th-num"
                      style={{ color: 'var(--blue)' }}
                      title="Not yet sent to the vendor"
                    >
                      Not Sent
                    </th>
                    {/* Purple: the only colour in this table not already spoken for by a
                        bucket (it labels the item CODE, never a quantity), so a purple
                        number cannot be misread as at-vendor/in-QC/accepted/not-sent. */}
                    <th
                      className="th-num"
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

          <ListFooter
            total={data.rows.length}
            noun="outsourced operation"
            hint="Order Qty = Accepted + In QC + At Vendor + Not Sent."
          />
        </>
      ) : null}
    </div>
  );
}

function Row({ row }: { row: OspWipRow }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code" style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>
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
      <td className="mono text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {row.soCode ?? '—'}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {row.vendorName ?? '—'}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {row.operation ?? `Op ${opSrNo(row.opSeq)}`}
      </td>
      <td className="td-num mono">{row.orderQty}</td>
      <td className="td-num mono text3">{row.sentQty || '—'}</td>
      <td className="td-num">
        <span
          className="mono fw-700"
          style={{ fontSize: 14, color: row.atVendorQty > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {row.atVendorQty || '—'}
        </span>
      </td>
      <td className="td-num">
        <span
          className="mono fw-700"
          style={{ color: row.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}
        >
          {row.inQcQty || '—'}
        </span>
      </td>
      <td className="td-num">
        <span
          className="mono"
          style={{ color: row.acceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {row.acceptedQty || '—'}
        </span>
      </td>
      <td className="td-num">
        <span
          className="mono"
          style={{ color: row.rejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
        >
          {row.rejectedQty || '—'}
        </span>
      </td>
      <td className="td-num">
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
      <td className="td-num">
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

// The filtering buckets (Outsourced Ops / At Vendor / Not Sent / Ready to
// Send) moved into the Bucket dropdown (2026-09-26 filter bar). "Total Sent"
// never filtered, so it stays as a read-only tile.
function KpiStrip({ summary }: { summary: ListOspWipResponse['summary'] }): React.JSX.Element {
  return (
    <StatStrip
      items={[
        {
          key: 'sent',
          label: 'Total Sent',
          // Body colour: green in this table means Accepted (R5 PU-N46).
          count: summary.sentQty,
        },
      ]}
    />
  );
}
