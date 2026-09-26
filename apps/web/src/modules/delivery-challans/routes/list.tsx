// OSP / JW Outward DC list — delivery challans issued against a PO_jw.
//
// Styled to SO Master (sales-orders/routes/list.tsx) 2026-08-13:
//  - The three hand-rolled KPI tiles are one `<StatStrip>` row (styling skill
//    Rule 3, ADR-120) — same three numbers, no per-tile cards, and it now
//    renders zeros while loading instead of popping in and shoving the list
//    down ~116px.
//  - Title + count + search + status filter + Print Register + New DC sit in
//    the frozen header band.
//  - The 8-column table is one `.panel` card per DC. Only 8 columns, but
//    `.innovic-table td` is `white-space: nowrap` and Vendor + SO are unbounded
//    server text with no max-width, so a long vendor name scrolled the page
//    sideways; without `tbl-frozen` the DC No. went with it. `.tbl-wrap` also
//    nested its own `max-height: calc(100vh - 220px)` scroller inside
//    `#content`'s, giving the page two vertical scrollbars. Cards retire all
//    three problems. Every column the table showed is still on the card.
//
// Dropped with the table: per-column sorting. It was client-side over the 25
// loaded rows only (it never re-queried, so it could not sort across pages),
// and a card list has no column headers to click — the same trade ADR-120
// recorded for the PR list.
//
// Nothing about the data, the filters, the query or the print output changed.

import type { ListDeliveryChallansQuery } from '@innovic/shared';
import { DC_STATUSES, type DcStatus } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useMyCompany } from '@/modules/settings/api';
import { useDeliveryChallansList } from '../api';
import { DcCard } from '../components/dc-card';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';
import { printDispatchRegister } from '../lib/print-dispatch-register';
import { OspAtVendorRegister } from '@/modules/osp-wip/components/osp-at-vendor-register';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(DC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  // Second tab: the read-only OSP At-Vendor register, folded in from the former
  // standalone /osp-wip screen.
  tab: z.enum(['at_vendor']).optional(),
});

export const deliveryChallansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans',
  validateSearch: listSearchSchema,
  component: DeliveryChallansListPage,
});

function DeliveryChallansListPage(): React.JSX.Element {
  const search = deliveryChallansListRoute.useSearch();
  const navigate = deliveryChallansListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already trims to it.
    setSearchInput((prev) =>
      prev.trim() === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListDeliveryChallansQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useDeliveryChallansList(query);
  const { data: company } = useMyCompany();
  // Tier-driven, per department (ospdc_create sits in Purchase). Raising a DC is
  // `entry`, so L2 Data Entry and up; an L1 Viewer no longer sees the button.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;
  const rows = data?.items ?? [];

  function onPrintRegister(): void {
    if (!data) return;
    const bits: string[] = [];
    if (search.search) bits.push(`search "${search.search}"`);
    if (search.status) bits.push(DC_STATUS_LABEL[search.status]);
    bits.push(`page ${currentPage} of ${totalPages}`);
    // The builder RETURNS false when the popup was blocked — it does not throw.
    // Catching only the throw meant a blocked print did nothing at all and said
    // nothing either.
    try {
      const ok = printDispatchRegister({
        rows: data.items,
        summary: data.summary,
        filterLabel: bits.join(' · '),
        company,
      });
      if (!ok) window.alert('Allow popups to print.');
    } catch {
      window.alert('Allow popups to print.');
    }
  }

  const tab = search.tab ?? 'outward';

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view DCs. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {/* Outward DC | At-Vendor Register tabs (the At-Vendor register is the
          former standalone /osp-wip screen). */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['outward', 'at_vendor'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, tab: t === 'outward' ? undefined : 'at_vendor' }),
                replace: true,
              })
            }
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'outward' ? 'Outward DC' : 'At-Vendor Register'}
          </button>
        ))}
      </div>

      {tab === 'at_vendor' ? (
        <OspAtVendorRegister />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · search ·
              status filter · Print Register · + New DC, with the read-only
              totals strip pinned inside the same band. */}
          <ListHeader
            title="OSP Outward DC"
            icon="🚛"
            count={total}
            noun="DC"
            filterNote={search.status ? DC_STATUS_LABEL[search.status] : undefined}
            search={searchInput}
            onSearch={setSearchInput}
            searchPlaceholder="Search DC, PO / NC, vendor…"
            updating={isFetching && !isLoading}
            tools={
              <>
                <select
                  className="innovic-select"
                  aria-label="DC status"
                  value={search.status ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as DcStatus | '';
                    void navigate({
                      search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                      replace: true,
                    });
                  }}
                  style={{ width: 160 }}
                >
                  <option value="">All statuses</option>
                  {DC_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {DC_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onPrintRegister}
                  disabled={isLoading || !data}
                  title="Print the DC register for the current filter/page"
                >
                  <Printer size={14} /> Print Register
                </button>
              </>
            }
            primary={
              // A DC is always issued against a PO, but the button lands on the
              // OSP Delivery Challan & Outward form itself — the form asks for
              // the PO.
              perms.entry ? (
                <Link to="/delivery-challans/new" className="btn btn-primary">
                  <Plus size={14} /> New DC (via PO)
                </Link>
              ) : null
            }
          >
            {/* Read-only totals, not filters — no onClick, so each cell renders
                as a <div>. Zeros while the first page loads so nothing jumps. */}
            <StatStrip
              items={[
                {
                  key: 'dispatched',
                  label: 'Total Sent to Vendor',
                  count: (data?.summary?.totalDispatched ?? 0).toLocaleString('en-IN', {
                    maximumFractionDigits: 2,
                  }),
                  sub: 'pieces',
                  title: 'Total quantity sent out on the DCs matching this filter',
                },
                {
                  key: 'entries',
                  label: 'DC Lines',
                  count: data?.summary?.entryCount ?? 0,
                },
                {
                  key: 'items',
                  label: 'Items Sent',
                  count: data?.summary?.itemCount ?? 0,
                  color: 'var(--cyan)',
                  title: 'Distinct items sent out in this filter',
                },
              ]}
            />
          </ListHeader>

          {isLoading ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : isError ? (
            <div className="panel empty-state" style={{ padding: 24, color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load DCs. Try again.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              {search.search || search.status ? 'No DCs match.' : 'No DCs yet.'}
            </div>
          ) : (
            rows.map((dc) => <DcCard key={dc.id} dc={dc} />)
          )}

          <ListFooter
            total={total}
            noun="DC"
            page={currentPage}
            pageSize={PAGE_SIZE}
            onPage={(p) =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, Math.max(1, p)) }),
                replace: true,
              })
            }
          />
        </>
      )}
    </div>
  );
}
