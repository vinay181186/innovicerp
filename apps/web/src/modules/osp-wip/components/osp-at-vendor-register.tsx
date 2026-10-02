// OSP At-Vendor / WIP Register (read-only) — folded in as the "At-Vendor
// Register" tab of the OSP / JW Outward DC screen. How much of each outsourced
// job is still at the vendor, came back accepted, or was never sent. Backed by
// the v_osp_wip view (migration 0064). Every ordered unit reconciles into a
// bucket: order_qty = accepted + in_qc + at_vendor + not_sent.
//
// 25 rows a page (ADR-201): search, Bucket and Sort & Filter (ADR-200, server
// mode) run on the server over every op; the Bucket figures and the Total Sent
// tile are server sums over every matching op. Any change → page 1. The page
// lives in component state (this is a tab, not a route).

import { type ListOspWipResponse } from '@innovic/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
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
  const [term, setTerm] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const columns = useMemo(() => ospAtVendorColumns(), []);
  const gotoFirst = useCallback(() => setPage(1), []);
  const sf = useServerSortFilter(TABLE_KEYS.ospAtVendorRegister, gotoFirst);

  // The box searches on the server after a short pause; a new term → page 1.
  useEffect(() => {
    const next = normalizeSearchTerm(search) || undefined;
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term]);

  const { data, isLoading, isFetching, isError, error } = useOspWip({
    filter,
    ...(term ? { search: term } : {}),
    ...(sf.param ? { sf: sf.param } : {}),
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count, then the filter
          bar (search · bucket with its qty · Clear), with the read-only
          "Total Sent" tile inside the same band. */}
      <ListHeader
        title="At-Vendor Register"
        icon="🚚"
        count={data?.total}
        noun="outsourced operation"
        filterNote={FILTER_LABELS[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search JC, item, SO, vendor…"
        updating={isFetching && !isLoading}
        filters={
          // The qty buckets that used to be clickable strip tiles, now one
          // dropdown with the same numbers in the option labels (owner
          // decision 2026-09-26). The old "Show All" button is the bar's Clear.
          <select
            className="innovic-select"
            aria-label="Bucket"
            title="Bucket"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as FilterKey);
              setPage(1);
            }}
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
          sf.clearFilters();
          setPage(1);
        }}
        filtersActive={filter !== 'all' || search !== '' || sf.filtering}
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
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.ospAtVendorRegister}
              columns={columns}
              rows={data?.rows ?? []}
              rowKey={(r) => r.jcOpId}
              loading={isLoading}
              sortFilterServer={sf}
              emptyText={
                filter !== 'all' || search.trim() || sf.filtering
                  ? 'No outsourced operations match.'
                  : 'No outsourced operations yet.'
              }
              defaultPinned={OSP_AT_VENDOR_DEFAULT_PINNED}
            />
          </Panel>

          {data ? (
            <ListFooter
              total={data.total}
              noun="outsourced operation"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={setPage}
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
