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
import { ChevronLeft, ChevronRight, Loader2, Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '@/modules/settings/api';
import { useDeliveryChallansList } from '../api';
import { DcCard } from '../components/dc-card';
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
    setSearchInput(search.search ?? '');
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

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;
  const rows = data?.items ?? [];

  function onPrintRegister(): void {
    if (!data) return;
    const bits: string[] = [];
    if (search.search) bits.push(`search "${search.search}"`);
    if (search.status) bits.push(search.status.replaceAll('_', ' '));
    bits.push(`page ${currentPage} of ${totalPages}`);
    try {
      printDispatchRegister({
        rows: data.items,
        summary: data.summary,
        filterLabel: bits.join(' · '),
        company,
      });
    } catch {
      window.alert('Allow popups to print.');
    }
  }

  const tab = search.tab ?? 'outward';

  return (
    <div>
      {/* Outward DC | At-Vendor Register tabs (the At-Vendor register is the
          former standalone /osp-wip screen). */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
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
            {t === 'outward' ? '🚛 Outward DC' : '🚚 At-Vendor Register'}
          </button>
        ))}
      </div>

      {tab === 'at_vendor' ? (
        <OspAtVendorRegister />
      ) : (
        <>
      {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          Title + count + filters + Print/New and the count strip stay pinned while
          the cards scroll underneath. `#content` is the scroll container, so top:0
          pins this to its padding box; the background must be opaque var(--bg) or
          cards show through as they pass under. Not bled to the edges — that would
          give the app a horizontal scrollbar. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              🚛 OSP / JW Outward DC
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} DC{total === 1 ? '' : 's'}
              {search.status ? (
                <>
                  {' '}· <span className="text2">{search.status}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="🔍 Search DC, PO, vendor..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 240, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as DcStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 160, fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {DC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12 }}
              onClick={onPrintRegister}
              disabled={isLoading || !data}
              title="Print the dispatch register for the current filter/page"
            >
              <Printer size={14} /> Print Register
            </button>
            {/* A DC is always issued against a PO, so "new" starts on the PO
                list rather than a standalone create form. */}
            <Link to="/purchase-orders" className="btn btn-primary">
              <Plus size={14} /> New DC (via PO)
            </Link>
          </div>
        </div>

        {/* Read-only totals, not filters — no onClick, so each cell renders as a
            <div> instead of a button that does nothing. Rendered with zeros
            while the first page loads so the list below does not jump. */}
        <StatStrip
          items={[
            {
              key: 'dispatched',
              label: 'Total Dispatched',
              count: (data?.summary?.totalDispatched ?? 0).toLocaleString('en-IN', {
                maximumFractionDigits: 2,
              }),
              color: 'var(--red)',
              sub: 'pieces',
              title: 'Total quantity sent out on the DCs matching this filter',
            },
            {
              key: 'entries',
              label: 'Dispatch Entries',
              count: data?.summary?.entryCount ?? 0,
              title: 'Number of DC lines in this filter',
            },
            {
              key: 'items',
              label: 'Items Dispatched',
              count: data?.summary?.itemCount ?? 0,
              color: 'var(--cyan)',
              title: 'Distinct items sent out in this filter',
            },
          ]}
        />
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ⚠️ DCs are issued against PO_jw. Create from a PO detail page → &ldquo;Issue DC&rdquo;.
            Receive back from the DC detail page.
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load DCs'}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          No OSP DCs yet — issue one from a PO detail page.
        </div>
      ) : (
        rows.map((dc) => <DcCard key={dc.id} dc={dc} />)
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No DCs'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a card to open the DC · <b>+ Receive</b> books material back from the vendor.
      </div>
        </>
      )}
    </div>
  );
}
