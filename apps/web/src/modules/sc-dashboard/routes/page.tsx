// Supply Chain Dashboard — mirror of legacy renderSCDashboard L16790.
//
// Summary strip (PO counts + value totals + GRN today/total) + pending PO
// tracker + vendor summary + SO summary + complete PO summary (tax-included) +
// recent GRN. Read-only.
//
// ADR-199 table standard (2026-10-01): the five tables are the shared
// <DataTable>; the headline Pending PO Tracker carries TABLE_KEYS.scDashboard,
// the four summary tables are keyless classic sheets.
//
// ADR-201 (2026-10-02): every table pages at 25 rows from the server, each with
// its own Prev / Next and server Sort & Filter (../components/sc-tables). The
// Pending PO Tracker's Vendor / Item / SO boxes filter on the server over every
// pending line; its line count, Pending Qty and Pending Value, the vendor / SO
// counts and the Complete Purchase Summary's Grand Total are server figures
// over every matching row — never sums of the 25 on screen.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ListHeader } from '@/ui/layout';
import { useScDashboard } from '../api';
import {
  PendingTracker,
  PoSummary,
  RecentGrn,
  SoSummary,
  VendorSummary,
} from '../components/sc-tables';
import { inr } from '../components/sc-format';

export const scDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sc-dashboard',
  component: ScDashboardPage,
});

function ScDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useScDashboard();

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
  // also means "no value yet"). The money KPI tiles and value columns drop.
  const priceHidden = !data.priceVisible;

  return (
    <div>
      <ListHeader
        title="Supply Chain Dashboard"
        icon="🔗"
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

      <PendingTracker options={data.filterOptions} priceHidden={priceHidden} />
      <VendorSummary priceHidden={priceHidden} />
      <SoSummary priceHidden={priceHidden} />
      <PoSummary priceHidden={priceHidden} />
      <RecentGrn />
    </div>
  );
}
