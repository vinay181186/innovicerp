// OSP At-Vendor / WIP Register (read-only) — folded in as the "At-Vendor
// Register" tab of the OSP / JW Outward DC screen. How much of each outsourced
// job is still at the vendor, came back accepted, or was never sent. Backed by
// the v_osp_wip view (migration 0064). Every ordered unit reconciles into a
// bucket: order_qty = accepted + in_qc + at_vendor + not_sent.

import { type ListOspWipResponse } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useOspWip } from '../api';
import { OSP_AT_VENDOR_DEFAULT_PINNED, ospAtVendorColumns } from './osp-at-vendor-columns';

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
  const columns = useMemo(() => ospAtVendorColumns(), []);

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

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load OSP register. Try again.'
          }
        />
      ) : isLoading || data ? (
        <>
          <Panel bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.ospAtVendorRegister}
              columns={columns}
              rows={data?.rows ?? []}
              rowKey={(r) => r.jcOpId}
              loading={isLoading}
              emptyText={
                filter !== 'all' || search.trim()
                  ? 'No outsourced operations match.'
                  : 'No outsourced operations yet.'
              }
              defaultPinned={OSP_AT_VENDOR_DEFAULT_PINNED}
            />
          </Panel>

          {data ? (
            <ListFooter
              total={data.rows.length}
              noun="outsourced operation"
              hint="Order Qty = Accepted + In QC + At Vendor + Not Sent."
            />
          ) : null}
        </>
      ) : null}
    </div>
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
