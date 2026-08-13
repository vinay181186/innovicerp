// Purchase Requests list (UI-003-04).
// Ports legacy renderPurchaseRequests (legacy/InnovicERP_v82_12_3_DataLossFix
// _29-04-2026.html L6217-6310): status counts → filter row → the PR book.
//
// Styled to SO Master (sales-orders/routes/list.tsx) 2026-08-13:
//  - The four status COUNT CARDS are one `<StatStrip>` row (styling skill
//    Rule 3) — same counts, same click-to-filter, no per-tile cards.
//  - Title + search + status filter + New PR sit in the frozen header band.
//  - The 11-column table (nowrap on every cell, three free-text columns) is one
//    `.panel` card per PR, so the page no longer scrolls sideways and the PR No.
//    stays in view. Every column it showed is still on the card.
// Nothing about the data, the filters, the mutations or the API changed.
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-025..027):
//  - No checkbox column / "🛒 Create PO from Selected" and no SO filter: the
//    club-PO flow is ported on /outsource-jobs (from-pr-batch) and the list API
//    has no SO/JC filter param. The legacy tip line that advertises both is
//    therefore not shipped either.
//  - Approve / Reject buttons (admin/manager, open PRs) call the dedicated
//    /approve + /reject endpoints, which stamp approvedBy/approvedAt (approve)
//    or record a reason + cancel (reject). A raw PATCH can no longer change
//    status — that path is immutable now, closing ISSUE-025.
//  - Headings say "Open" where legacy says "Pending" — `open` is this port's
//    status name, shown by the badge and the status filter on this same page.

import {
  type ListPurchaseRequestsQuery,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequestListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useApprovePr, usePurchaseRequestsList, useRejectPr } from '../api';
import { PrCard } from '../components/pr-card';

const PAGE_SIZE = 25;

// Legacy's cards count every PR regardless of the search box / SO filter
// (renderPurchaseRequests L6221-6223 counts the whole array). Module-level
// constants keep the query keys stable so these are fetched once and cached.
const COUNT_ALL: ListPurchaseRequestsQuery = { limit: 1, offset: 0 };
const COUNT_OPEN: ListPurchaseRequestsQuery = { status: 'open', limit: 1, offset: 0 };
const COUNT_APPROVED: ListPurchaseRequestsQuery = { status: 'approved', limit: 1, offset: 0 };
const COUNT_PO_CREATED: ListPurchaseRequestsQuery = { status: 'po_created', limit: 1, offset: 0 };

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PR_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const purchaseRequestsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests',
  validateSearch: listSearchSchema,
  component: PurchaseRequestsListPage,
});

function PurchaseRequestsListPage(): React.JSX.Element {
  const search = purchaseRequestsListRoute.useSearch();
  const navigate = purchaseRequestsListRoute.useNavigate();
  const { data: me } = useSession();

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

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseRequestsList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  // Approve / Reject are the only paths that advance an open PR — they stamp
  // approvedBy/approvedAt (approve) or record a reason + cancel (reject),
  // which a raw status edit deliberately no longer can (ISSUE-025).
  const approveMut = useApprovePr();
  const rejectMut = useRejectPr();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = useCallback(
    (pr: PurchaseRequestListItem): void => {
      setActionError(null);
      if (!window.confirm(`Approve ${pr.code}?`)) return;
      approveMut.mutate(pr.id, {
        onError: (e) => setActionError(e instanceof Error ? e.message : 'Approve failed'),
      });
    },
    [approveMut],
  );

  const handleReject = useCallback(
    (pr: PurchaseRequestListItem): void => {
      setActionError(null);
      const reason = window.prompt(`Reject ${pr.code} — reason:`);
      if (reason === null) return; // cancelled prompt
      if (!reason.trim()) {
        setActionError('Rejection reason is required');
        return;
      }
      rejectMut.mutate(
        { id: pr.id, reason: reason.trim() },
        { onError: (e) => setActionError(e instanceof Error ? e.message : 'Reject failed') },
      );
    },
    [rejectMut],
  );

  // Legacy status cards (L6229-6242) count the whole PR set, not the filtered
  // page — the list endpoint returns a `total` per filter, so one count query
  // per stat.
  const allCount = usePurchaseRequestsList(COUNT_ALL).data?.total ?? 0;
  const openCount = usePurchaseRequestsList(COUNT_OPEN).data?.total ?? 0;
  const approvedCount = usePurchaseRequestsList(COUNT_APPROVED).data?.total ?? 0;
  const poCreatedCount = usePurchaseRequestsList(COUNT_PO_CREATED).data?.total ?? 0;

  const setStatusFilter = useCallback(
    (next: PrStatus | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, status: next, page: 1 }), replace: true });
    },
    [navigate],
  );

  const toggleStatus = (s: PrStatus) => () => setStatusFilter(search.status === s ? undefined : s);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  return (
    <div>
      {/* Frozen header band — title + count + search + status + New PR + the
          count strip stay pinned; the PR cards scroll under them. `#content` is
          the scroll container, so the background must be the opaque `--bg` or
          cards show through. Never bled to the edges: that gives the whole app
          a horizontal scrollbar. */}
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
              Purchase Requests
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} request{total === 1 ? '' : 's'}
              {search.status ? (
                <>
                  {' '}
                  · <span className="text2">{search.status.replaceAll('_', ' ')}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="🔍 Search PRs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as PrStatus | '';
                setStatusFilter(v === '' ? undefined : v);
              }}
              style={{ width: 160, fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {PR_STATUSES.map((s) => (
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
            {canWrite ? (
              <Link to="/purchase-requests/new" className="btn btn-primary">
                <Plus size={14} /> New PR
              </Link>
            ) : null}
          </div>
        </div>

        <StatStrip
          items={[
            {
              key: 'open',
              label: 'Open',
              count: openCount,
              color: 'var(--amber)',
              active: search.status === 'open',
              onClick: toggleStatus('open'),
            },
            {
              key: 'approved',
              label: 'Approved (Awaiting PO)',
              count: approvedCount,
              color: 'var(--blue)',
              active: search.status === 'approved',
              onClick: toggleStatus('approved'),
            },
            {
              key: 'po_created',
              label: 'PO Created',
              count: poCreatedCount,
              color: 'var(--green)',
              active: search.status === 'po_created',
              onClick: toggleStatus('po_created'),
            },
            {
              key: 'all',
              label: 'All PRs',
              count: allCount,
              color: 'var(--cyan)',
              active: search.status === undefined,
              onClick: () => setStatusFilter(undefined),
              title: 'Clear the status filter',
            },
          ]}
        />
      </div>

      {actionError ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {actionError}
        </div>
      ) : null}

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load purchase requests'}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          No purchase requests found
        </div>
      ) : (
        rows.map((pr) => (
          <PrCard
            key={pr.id}
            pr={pr}
            canWrite={canWrite}
            approving={approveMut.isPending}
            rejecting={rejectMut.isPending}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))
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
            ? 'No purchase requests'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
    </div>
  );
}
