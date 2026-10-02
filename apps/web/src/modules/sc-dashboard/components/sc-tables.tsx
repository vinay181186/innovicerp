// Supply Chain Dashboard — the five tables, each paged at 25 rows on the server
// (ADR-201): its own page (component state), its own Sort & Filter (server
// mode, every change → page 1), its count / totals from the server over every
// matching row. Split out of routes/page.tsx (file-size rule).
//
// Frozen-header tabs (ADR-203): the five tables are five TABS, one table on
// screen at a time, each filling the page (ADR-202 `<Panel fill>`). Every tab
// body below returns its filled Panel + its ListFooter as a fragment so both
// sit directly in the page's `page-fill` root. The table state lives in the
// page (useScTables) so a tab keeps its page / filters / Sort & Filter while
// another tab is shown, and every tab label carries its table's server total.

import type {
  ScDashboardResponse,
  ScPendingPage,
  ScPoSummaryPage,
  ScRecentGrnPage,
  ScSoPage,
  ScVendorPage,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE } from '@/lib/list-paging';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { type ScTable, useScTable } from '../api';
import { FilterInput } from './filter-input';
import { pendingColumns } from './pending-columns';
import { poSummaryColumns, recentGrnColumns } from './po-grn-columns';
import { inr } from './sc-format';
import { soColumns, vendorColumns } from './vendor-so-columns';

function Footer<R extends { total: number }>({
  t,
  noun,
}: {
  t: ScTable<R>;
  noun: string;
}): React.JSX.Element {
  return (
    <ListFooter
      total={t.data?.total ?? 0}
      noun={noun}
      page={t.page}
      pageSize={LIST_PAGE_SIZE}
      onPage={t.onPage}
    />
  );
}

function errText(t: { isError: boolean; error: unknown }): string | null {
  if (!t.isError) return null;
  return t.error instanceof Error ? t.error.message : 'Could not load this table. Try again.';
}

/** A typed box → the query value 300 ms after typing stops (normalised). */
function useDebounced(raw: string): string | undefined {
  const [v, setV] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = normalizeSearchTerm(raw);
    const next = t === '' ? undefined : t;
    const id = window.setTimeout(() => setV(next), 300);
    return () => window.clearTimeout(id);
  }, [raw]);
  return v;
}

export interface PendingState {
  t: ScTable<ScPendingPage>;
  fltVendor: string;
  setFltVendor: (v: string) => void;
  fltItem: string;
  setFltItem: (v: string) => void;
  fltSo: string;
  setFltSo: (v: string) => void;
  isFiltered: boolean;
  clearFilters: () => void;
}

/** All five tables' state, held by the page so switching tab loses nothing. */
export function useScTables() {
  const [fltVendor, setFltVendor] = useState('');
  const [fltItem, setFltItem] = useState('');
  const [fltSo, setFltSo] = useState('');
  const vendor = useDebounced(fltVendor);
  const item = useDebounced(fltItem);
  const so = useDebounced(fltSo);
  const pendingT = useScTable<ScPendingPage>('pending', TABLE_KEYS.scDashboard, {
    vendor,
    item,
    so,
  });
  const { onPage } = pendingT;
  // Any filter change → page 1.
  useEffect(() => onPage(1), [vendor, item, so, onPage]);
  const pending: PendingState = {
    t: pendingT,
    fltVendor,
    setFltVendor,
    fltItem,
    setFltItem,
    fltSo,
    setFltSo,
    isFiltered: Boolean(vendor || item || so || pendingT.sf.filtering),
    clearFilters: () => {
      setFltVendor('');
      setFltItem('');
      setFltSo('');
      pendingT.sf.clearFilters();
    },
  };
  return {
    pending,
    vendors: useScTable<ScVendorPage>('vendors', 'sc-dashboard-vendors'),
    sos: useScTable<ScSoPage>('sos', 'sc-dashboard-sos'),
    poSummary: useScTable<ScPoSummaryPage>('po-summary', 'sc-dashboard-po-summary'),
    recentGrn: useScTable<ScRecentGrnPage>('recent-grn', 'sc-dashboard-recent-grn'),
  };
}

/** Pending PO Tracker (legacy L17030) — the headline table with Vendor / Item / SO filters. */
export function PendingTracker({
  p,
  options,
  priceHidden,
}: {
  p: PendingState;
  options: ScDashboardResponse['filterOptions'];
  priceHidden: boolean;
}): React.JSX.Element {
  const { t, isFiltered } = p;
  const total = t.data?.total ?? 0;
  return (
    <>
      <Panel fill bodyPadding="none">
        {/* Filters + totals line: chrome above the table, inside this tab. */}
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <FilterInput
            label="Vendor"
            listId="dlScVnd"
            value={p.fltVendor}
            onChange={p.setFltVendor}
            options={options.vendors}
            width={140}
          />
          <FilterInput
            label="Item Code"
            listId="dlScItm"
            value={p.fltItem}
            onChange={p.setFltItem}
            options={options.items}
            width={160}
          />
          <FilterInput
            label="SO / JWSO No."
            listId="dlScSO"
            value={p.fltSo}
            onChange={p.setFltSo}
            options={options.sos}
            width={120}
          />
          {isFiltered ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--red2)', fontSize: 11 }}
              onClick={p.clearFilters}
            >
              ✕ Clear Filters
            </button>
          ) : null}
          {/* Line count + Pending Qty / Value: server figures over EVERY filtered line. */}
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
            {isFiltered ? <span style={{ color: 'var(--amber2)' }}>Filtered: </span> : null}
            {total} line{total !== 1 ? 's' : ''} · Pending Qty:{' '}
            <span style={{ color: 'var(--red2)' }}>{t.data?.totalPendingQty ?? 0}</span>
            {priceHidden ? null : (
              <>
                {' '}
                · Pending Value:{' '}
                <span style={{ color: 'var(--amber2)' }}>₹{inr(t.data?.totalPendingVal ?? 0)}</span>
              </>
            )}
          </div>
        </div>
        <DataTable
          tableKey={TABLE_KEYS.scDashboard}
          columns={pendingColumns(priceHidden)}
          rows={t.data?.items ?? []}
          loading={t.isLoading}
          rowKey={(r) => `${r.poId}:${r.lineNo}`}
          sortFilterServer={t.sf}
          emptyText={
            errText(t) ?? (isFiltered ? 'No pending PO lines match.' : 'No pending PO lines.')
          }
        />
      </Panel>
      <Footer t={t} noun="pending PO line" />
    </>
  );
}

export function VendorSummary({
  t,
  priceHidden,
}: {
  t: ScTable<ScVendorPage>;
  priceHidden: boolean;
}): React.JSX.Element {
  return (
    <>
      <Panel
        fill
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--amber2)' }}>
            {t.data?.total ?? 0} vendors with open POs
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={vendorColumns(priceHidden)}
          rows={t.data?.items ?? []}
          loading={t.isLoading}
          // One vendor can appear twice (a PO typed by code vs linked by id are
          // grouped apart, as before), so the row's place on the page keys it.
          rowKey={(v, i) => `${v.vendorId ?? ''}:${v.vendorCode ?? 'unknown'}:${t.page}:${i}`}
          sortFilterServer={t.sf}
          emptyText={errText(t) ?? 'No open POs'}
        />
      </Panel>
      <Footer t={t} noun="vendor" />
    </>
  );
}

export function SoSummary({
  t,
  priceHidden,
}: {
  t: ScTable<ScSoPage>;
  priceHidden: boolean;
}): React.JSX.Element {
  return (
    <>
      <Panel
        fill
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
            {t.data?.total ?? 0} orders with open POs
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={soColumns(priceHidden)}
          rows={t.data?.items ?? []}
          loading={t.isLoading}
          rowKey={(s) => s.soRefId ?? '_unlinked_'}
          sortFilterServer={t.sf}
          emptyText={errText(t) ?? 'No open POs'}
        />
      </Panel>
      <Footer t={t} noun="order" />
    </>
  );
}

export function PoSummary({
  t,
  priceHidden,
}: {
  t: ScTable<ScPoSummaryPage>;
  priceHidden: boolean;
}): React.JSX.Element {
  return (
    <>
      <Panel
        fill
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--green2)' }}>
            {t.data?.total ?? 0} POs
            {/* Grand Total from the server, over every matching PO. */}
            {priceHidden ? '' : ` · Grand Total: ₹${inr(t.data?.grandTotal ?? 0)}`}
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={poSummaryColumns(priceHidden)}
          rows={t.data?.items ?? []}
          loading={t.isLoading}
          rowKey={(g) => g.poId}
          sortFilterServer={t.sf}
          emptyText={errText(t) ?? 'No POs yet.'}
        />
      </Panel>
      <Footer t={t} noun="PO" />
    </>
  );
}

/** Recent GRN Activity (legacy L17107) — newest first, paged over every GRN. */
export function RecentGrn({ t }: { t: ScTable<ScRecentGrnPage> }): React.JSX.Element {
  return (
    <>
      <Panel
        fill
        actions={
          <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
            View All →
          </Link>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={recentGrnColumns()}
          rows={t.data?.items ?? []}
          loading={t.isLoading}
          rowKey={(g) => g.grnNo}
          sortFilterServer={t.sf}
          emptyText={errText(t) ?? 'No GRNs yet.'}
        />
      </Panel>
      <Footer t={t} noun="GRN" />
    </>
  );
}
