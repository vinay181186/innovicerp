// Supply Chain Dashboard — mirror of legacy renderSCDashboard L16790.
//
// Summary strip (PO counts + value totals + GRN today/total) + pending PO
// tracker + vendor summary + SO summary + complete PO summary (tax-included) +
// recent GRN. Read-only.
//
// ADR-199 table standard (2026-10-01): the five hand-built <table>s are replaced
// by the shared <DataTable>. The headline Pending PO Tracker carries
// TABLE_KEYS.scDashboard (fit engine: columns size to the screen, the rightmost
// drop into a ▸ detail, Columns / density toolbar, saved layout). The four
// summary tables each have a genuinely different column shape, so — per the
// ADR-199 rule — they render as KEYLESS classic sheets rather than inventing
// more keys. Column builders live beside this file; see ../components. Nothing
// about the data, the filters, the money-hidden behaviour or the KPI strip
// changed.

import type { ScDashboardResponse } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';
import { FilterInput } from '../components/filter-input';
import { pendingColumns } from '../components/pending-columns';
import { poSummaryColumns, recentGrnColumns } from '../components/po-grn-columns';
import { inr } from '../components/sc-format';
import { soColumns, vendorColumns } from '../components/vendor-so-columns';

export const scDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sc-dashboard',
  component: ScDashboardPage,
});

function ScDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<ScDashboardResponse>({
    queryKey: ['sc-dashboard'],
    queryFn: () => apiFetch<ScDashboardResponse>('/sc-dashboard'),
    staleTime: 30_000,
  });

  // Pending PO Tracker filters (legacy renderSCDashboard L17030 — Vendor /
  // Item / SO-JW). Client-side over the already-fetched pendingLines. Hooks
  // run before the early returns; default to [] while data is loading.
  const [fltVendor, setFltVendor] = useState('');
  const [fltItem, setFltItem] = useState('');
  const [fltSo, setFltSo] = useState('');

  const pendingLines = data?.pendingLines ?? [];
  const isFiltered = Boolean(fltVendor || fltItem || fltSo);

  const filterOpts = useMemo(() => {
    const vendors = new Set<string>();
    const items = new Set<string>();
    const sos = new Set<string>();
    for (const p of pendingLines) {
      const v = p.vendorName ?? p.vendorCode;
      if (v) vendors.add(v);
      // The picklist offers exactly what the Item column prints, `CODE/REV`, so
      // that choosing an option always matches a row the operator can see.
      if (p.itemCode) items.add(itemCodeWithRev(p.itemCode, p.itemRevision, p.itemCode));
      if (p.soCode) sos.add(p.soCode);
    }
    return {
      vendors: [...vendors].sort(),
      items: [...items].sort(),
      sos: [...sos].sort(),
    };
  }, [pendingLines]);

  const filteredPending = useMemo(() => {
    const has = (hay: string | null | undefined, needle: string): boolean =>
      needle.trim() === '' ? true : (hay ?? '').toLowerCase().includes(needle.trim().toLowerCase());
    return pendingLines.filter(
      (p) =>
        has(p.vendorName ?? p.vendorCode, fltVendor) &&
        // Filtering runs over the already-loaded rows, so match on the printed
        // `CODE/REV` — a revision the operator can see on the board has to be
        // one they can type. The bare code still matches, it is a prefix.
        has(itemCodeWithRev(p.itemCode, p.itemRevision, ''), fltItem) &&
        has(p.soCode, fltSo),
    );
  }, [pendingLines, fltVendor, fltItem, fltSo]);

  const fltPendQty = filteredPending.reduce((s, p) => s + p.pendingQty, 0);
  const fltPendVal = filteredPending.reduce((s, p) => s + (p.pendingVal ?? 0), 0);

  function clearFilters(): void {
    setFltVendor('');
    setFltItem('');
    setFltSo('');
  }

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error
          ? error.message
          : 'Could not load Supply Chain Dashboard. Try again.'}
      </div>
    );
  }

  // Money hidden for L1 Viewers: the API nulls every value on the dashboard and
  // tells us via priceVisible (never inferred from a null money field — a null
  // also means "no value yet", so probing it hid money from users entitled to
  // see it). The money KPI tiles and the value columns are dropped.
  const priceHidden = !data.priceVisible;
  const grandOrderTotal = data.poSummary.reduce((s, g) => s + (g.grandTotal ?? 0), 0);

  return (
    <div>
      <ListHeader
        title="Supply Chain Dashboard"
        icon="🔗"
        count={filteredPending.length}
        noun="pending PO line"
        tools={
          <>
            <Link to="/purchase-orders" className="btn btn-ghost btn-sm">
              🛒 PO Master
            </Link>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              📥 GRN
            </Link>
            <Link to="/store-inventory" className="btn btn-ghost btn-sm">
              🏬 Store
            </Link>
            <Link to="/vendors" className="btn btn-ghost btn-sm">
              🏭 Vendors
            </Link>
          </>
        }
      >
        {/* Summary — 9 server-computed, uncapped figures off `summary`, as one
            strip (money tiles dropped when prices are hidden). */}
        <StatStrip
          items={[
            { key: 'open', label: 'Open POs', count: data.summary.openPos, color: 'var(--blue)' },
            {
              key: 'partial',
              label: 'Partly Received POs',
              count: data.summary.partialPos,
              color: 'var(--amber2)',
            },
            {
              key: 'closed',
              label: 'Closed POs',
              count: data.summary.closedPos,
              color: 'var(--green2)',
            },
            {
              key: 'cancelled',
              label: 'Cancelled POs',
              count: data.summary.cancelledPos,
              color: 'var(--text3)',
            },
            ...(priceHidden
              ? []
              : [
                  {
                    key: 'orderVal',
                    label: 'Order Value',
                    count: `₹${inr(data.summary.totalOrderVal)}`,
                    color: 'var(--cyan)',
                  },
                  {
                    key: 'recvVal',
                    label: 'Received Value',
                    count: `₹${inr(data.summary.totalRecvVal)}`,
                    color: 'var(--green2)',
                  },
                  {
                    key: 'pendVal',
                    label: 'Pending Value',
                    count: `₹${inr(data.summary.pendingVal)}`,
                    color: 'var(--amber2)',
                  },
                ]),
            {
              key: 'grns',
              label: 'Total GRNs',
              count: data.summary.grnCount,
              color: 'var(--cyan)',
            },
            {
              key: 'grnsToday',
              label: 'GRNs Today',
              count: data.summary.todayGrn,
              color: 'var(--green2)',
            },
          ]}
        />
      </ListHeader>

      {/* ═══ PENDING PO TRACKER with Filters (legacy L17030) — the headline
          table, carrying the fit engine's saved layout ═══ */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">🔍 Pending PO Tracker</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {isFiltered ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red2)', fontSize: 11 }}
                onClick={clearFilters}
              >
                ✕ Clear Filters
              </button>
            ) : null}
          </div>
        </div>
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
            value={fltVendor}
            onChange={setFltVendor}
            options={filterOpts.vendors}
            width={140}
          />
          <FilterInput
            label="Item Code"
            listId="dlScItm"
            value={fltItem}
            onChange={setFltItem}
            options={filterOpts.items}
            width={160}
          />
          <FilterInput
            label="SO / JWSO No."
            listId="dlScSO"
            value={fltSo}
            onChange={setFltSo}
            options={filterOpts.sos}
            width={120}
          />
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
            {isFiltered ? <span style={{ color: 'var(--amber2)' }}>Filtered: </span> : null}
            {filteredPending.length} line{filteredPending.length !== 1 ? 's' : ''} · Pending Qty:{' '}
            <span style={{ color: 'var(--red2)' }}>{fltPendQty}</span>
            {priceHidden ? null : (
              <>
                {' '}
                · Pending Value: <span style={{ color: 'var(--amber2)' }}>₹{inr(fltPendVal)}</span>
              </>
            )}
          </div>
        </div>
        <DataTable
          tableKey={TABLE_KEYS.scDashboard}
          columns={pendingColumns(priceHidden)}
          rows={filteredPending}
          rowKey={(p) => `${p.poId}:${p.lineNo}`}
          emptyText={isFiltered ? 'No pending PO lines match.' : 'No pending PO lines.'}
        />
      </div>

      {/* Vendor-wise Open PO (legacy L17071) — keyless summary sheet */}
      <Panel
        title="🏭 Vendor-wise Open PO Summary"
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--amber2)' }}>
            {data.byVendor.length} vendors with open POs
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={vendorColumns(priceHidden)}
          rows={data.byVendor}
          rowKey={(v) => v.vendorId ?? v.vendorCode ?? 'unknown'}
          emptyText="No open POs"
        />
      </Panel>

      {/* SO / JW-wise Open PO (legacy L17083) — keyless summary sheet */}
      <Panel
        title="📋 SO / JW-wise Open PO Summary"
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
            {data.bySo.length} orders with open POs
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={soColumns(priceHidden)}
          rows={data.bySo}
          rowKey={(s) => s.soRefId ?? '_unlinked_'}
          emptyText="No open POs"
        />
      </Panel>

      {/* Complete Purchase Summary (legacy L17095) — keyless summary sheet */}
      <Panel
        title="📦 Complete Purchase Summary"
        actions={
          <span className="mono" style={{ fontSize: 12, color: 'var(--green2)' }}>
            {data.poSummary.length} POs
            {priceHidden ? '' : ` · Grand Total: ₹${inr(grandOrderTotal)}`}
          </span>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={poSummaryColumns(priceHidden)}
          rows={data.poSummary}
          rowKey={(g) => g.poId}
          emptyText="No POs yet."
        />
      </Panel>

      {/* Recent GRN Activity (legacy L17107). Legacy's Item / Accepted /
          Rejected columns are GRN-line fields this payload does not carry —
          reported, not fabricated. */}
      <Panel
        title="📥 Recent GRN Activity"
        actions={
          <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
            View All →
          </Link>
        }
        bodyPadding="none"
      >
        <DataTable
          columns={recentGrnColumns()}
          rows={data.recentGrn}
          rowKey={(g) => g.grnNo}
          emptyText="No GRNs yet."
        />
      </Panel>
    </div>
  );
}
