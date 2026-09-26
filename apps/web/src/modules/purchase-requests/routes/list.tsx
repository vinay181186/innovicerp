// Purchase Requests list (UI-003-04).
// Ports legacy renderPurchaseRequests (legacy/InnovicERP_v82_12_3_DataLossFix
// _29-04-2026.html L6217-6310): status counts → filter row → the PR book.
//
// Styled to SO Master (sales-orders/routes/list.tsx) 2026-08-13:
//  - The four status COUNTS ride in the status dropdown's option labels
//    (2026-09-26 filter bar; they were a clickable StatStrip row before).
//  - Title + search + status filter + New PR sit in the frozen header band.
//  - The 11-column table (nowrap on every cell, three free-text columns) is one
//    `.panel` card per PR, so the page no longer scrolls sideways and the PR No.
//    stays in view. Every column it showed is still on the card.
// Nothing about the data, the filters, the mutations or the API changed.
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-025..027):
//  - No SO filter: the list API has no SO/JC filter param.
//  - 2026-09-26 (round-2): each orderable PR card carries a tick box; ticked
//    PRs of ONE vendor go to /purchase-orders/from-pr?prIds=… as one PO with a
//    line per PR (the club-PO flow for purchase PRs; OSP keeps from-pr-batch).
//  - Approve / Reject buttons (L4 Approver and above, open PRs) call the dedicated
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
import { Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { OutsourceJobsView } from '@/modules/outsource-jobs/components/outsource-jobs-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useApprovePr, usePurchaseRequestsList, useRejectPr } from '../api';
import { PrCard } from '../components/pr-card';
import { prOrderBalance } from '../lib/pr-balance';
import { PR_STATUS_LABELS } from '../lib/pr-labels';

const PAGE_SIZE = 25;

// Legacy's cards count every PR regardless of the search box / SO filter
// (renderPurchaseRequests L6221-6223 counts the whole array). Module-level
// constants keep the query keys stable so these are fetched once and cached.
const COUNT_ALL: ListPurchaseRequestsQuery = { limit: 1, offset: 0 };
const COUNT_OPEN: ListPurchaseRequestsQuery = { status: 'open', limit: 1, offset: 0 };
const COUNT_APPROVED: ListPurchaseRequestsQuery = { status: 'approved', limit: 1, offset: 0 };
const COUNT_PO_CREATED: ListPurchaseRequestsQuery = { status: 'po_created', limit: 1, offset: 0 };
const COUNT_CANCELLED: ListPurchaseRequestsQuery = { status: 'cancelled', limit: 1, offset: 0 };

/** One ticked PR on the list — kept by id so a tick survives paging. */
interface SelectedPr {
  id: string;
  /** null = vendor still TBD: fits any vendor. */
  vendorKey: string | null;
  vendorLabel: string;
}

/** Vendor text that means "not chosen yet" (Planning / BOM cascade / OSP). */
const VENDOR_TBD = new Set(['', 'TBD', '(VENDOR TBD)']);

/** Which vendor a PR belongs to, for the one-vendor-per-PO tick rule — ONE key,
 *  the vendor code: the master's code (vendorCode, resolved by the server from
 *  vendorId or a matching code text) first, the typed code text second
 *  (ADR-015 pair). A linked PR and a text-only PR for the same vendor so get
 *  the same key. Null when the vendor is still TBD. */
function prVendorKey(pr: PurchaseRequestListItem): string | null {
  const t = (pr.vendorCode ?? pr.vendorCodeText ?? '').trim().toUpperCase();
  if (!VENDOR_TBD.has(t)) return t;
  // Linked to a master row whose code did not resolve (deleted vendor): the
  // id is still one vendor.
  return pr.vendorId ? `id:${pr.vendorId}` : null;
}

/** Same gate as the card's own "Create PO" button: not cancelled and still has
 *  quantity left to order (ADR-152). */
function isOrderable(pr: PurchaseRequestListItem): boolean {
  return pr.status !== 'cancelled' && prOrderBalance(pr).balance > 0;
}

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
  // Tier-driven, per department (Purchase). Entry raises a PR or a PO off one;
  // approve signs one off. They are separate rights: the old
  // `role === 'admin' || role === 'manager'` flag collapsed all seven tiers
  // into two, letting an L3 Editor approve and denying an L4 Approver nothing.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'pr_create');
  // The card's 📝 PO action raises a PURCHASE ORDER off this PR, so it follows
  // po_create, not pr_create. Its destination (/purchase-orders/from-pr) guards
  // on po_create.entry; gating the button on a different key would show it to
  // someone the next page then refuses.
  const canCreatePo = effectiveFormPerms(eff, 'po_create').entry;

  // Outsource Jobs folded in as a second tab (UI-only merge). The standalone
  // /outsource-jobs route still exists for now — retirement is a later step.
  const [tab, setTab] = useState<'pr' | 'osp'>('pr');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-PR  00012 " and "IN-PR 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
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

  // Approve / Reject are the only paths that advance an open PR — they stamp
  // approvedBy/approvedAt (approve) or record a reason + cancel (reject),
  // which a raw status edit deliberately no longer can (ISSUE-025).
  const approveMut = useApprovePr();
  const rejectMut = useRejectPr();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = useCallback(
    (pr: PurchaseRequestListItem): void => {
      setActionError(null);
      if (!window.confirm(`Approve PR ${pr.code}?`)) return;
      approveMut.mutate(pr.id, {
        onError: (e) =>
          setActionError(e instanceof Error ? e.message : 'Could not approve PR. Try again.'),
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
        setActionError('Rejection reason is required.');
        return;
      }
      rejectMut.mutate(
        { id: pr.id, reason: reason.trim() },
        {
          onError: (e) =>
            setActionError(e instanceof Error ? e.message : 'Could not reject PR. Try again.'),
        },
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
  const cancelledCount = usePurchaseRequestsList(COUNT_CANCELLED).data?.total ?? 0;

  const setStatusFilter = useCallback(
    (next: PrStatus | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, status: next, page: 1 }), replace: true });
    },
    [navigate],
  );

  // Status counts ride in the status dropdown's option labels (owner decision
  // 2026-09-26: one filter bar, no capsule row).
  const statusCounts: Partial<Record<PrStatus, number>> = {
    open: openCount,
    approved: approvedCount,
    po_created: poCreatedCount,
    cancelled: cancelledCount,
  };

  const clearFilters = useCallback((): void => {
    setSearchInput('');
    void navigate({
      search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
      replace: true,
    });
  }, [navigate]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  // — "Create PO from Selected" (round-2). Ticks survive paging and filtering
  //    (the map is keyed by PR id), and are limited to ONE vendor: once a PR
  //    with a vendor is ticked, a PR of a different vendor cannot be. A PR whose
  //    vendor is still TBD fits any vendor — the PO form treats it the same way.
  const [selected, setSelected] = useState<Map<string, SelectedPr>>(() => new Map());
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const lockedVendor = useMemo(() => {
    const hit = selectedList.find((x) => x.vendorKey !== null);
    return hit && hit.vendorKey !== null ? { key: hit.vendorKey, label: hit.vendorLabel } : null;
  }, [selectedList]);
  const toggleSelect = useCallback((pr: PurchaseRequestListItem): void => {
    setSelected((m) => {
      const next = new Map(m);
      if (next.has(pr.id)) next.delete(pr.id);
      else
        next.set(pr.id, {
          id: pr.id,
          vendorKey: prVendorKey(pr),
          vendorLabel: pr.vendorName ?? pr.vendorCodeText ?? '—',
        });
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Map()), []);

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Purchase Requests. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['pr', 'osp'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
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
            {t === 'pr' ? 'Purchase Requests' : 'Outsource Jobs'}
          </button>
        ))}
      </div>

      {tab === 'osp' ? (
        <OutsourceJobsView />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · + New PR,
              then the filter bar (search · status with counts · Clear), with
              the "Create PO from Selected" bar pinned inside the same band. */}
          <ListHeader
            title="Purchase Requests"
            icon="📄"
            count={total}
            noun="request"
            filterNote={search.status ? PR_STATUS_LABELS[search.status] : undefined}
            search={searchInput}
            onSearch={setSearchInput}
            searchPlaceholder="Search PR No., item, vendor, SO/JC, PO…"
            updating={isFetching && !isLoading}
            filters={
              <select
                className="innovic-select"
                value={search.status ?? ''}
                onChange={(e) => {
                  const v = e.target.value as PrStatus | '';
                  setStatusFilter(v === '' ? undefined : v);
                }}
                aria-label="PR Status"
                title="PR Status"
              >
                <option value="">All PRs ({allCount})</option>
                {PR_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusCounts[s] !== undefined
                      ? `${PR_STATUS_LABELS[s]} (${statusCounts[s]})`
                      : PR_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            }
            onClearFilters={clearFilters}
            filtersActive={search.status !== undefined || searchInput !== ''}
            primary={
              perms.entry ? (
                <Link to="/purchase-requests/new" className="btn btn-primary">
                  <Plus size={14} /> New PR
                </Link>
              ) : null
            }
          >
            {selectedList.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 8,
                  fontSize: 12,
                }}
              >
                <span className="fw-700">
                  {selectedList.length} PR{selectedList.length === 1 ? '' : 's'} selected
                </span>
                {lockedVendor ? (
                  <span className="text3">
                    · Vendor <span className="text2 fw-700">{lockedVendor.label}</span>
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
                  Clear
                </button>
                <Link
                  to="/purchase-orders/from-pr"
                  search={{ prIds: selectedList.map((x) => x.id).join(',') }}
                  className="btn btn-primary btn-sm"
                >
                  Create PO from Selected ({selectedList.length})
                </Link>
              </div>
            ) : null}
          </ListHeader>

          {actionError ? (
            <div
              style={{
                color: 'var(--red2)',
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
            <div className="panel empty-state" style={{ padding: 24, color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load PRs. Try again.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              {search.search || search.status ? 'No PRs match.' : 'No PRs yet.'}
            </div>
          ) : (
            rows.map((pr) => {
              const orderable = canCreatePo && isOrderable(pr);
              const key = prVendorKey(pr);
              const clashWith =
                lockedVendor && key !== null && key !== lockedVendor.key && !selected.has(pr.id)
                  ? lockedVendor.label
                  : null;
              return (
                <PrCard
                  key={pr.id}
                  pr={pr}
                  canApprove={perms.approve}
                  canEntry={canCreatePo}
                  approving={approveMut.isPending}
                  rejecting={rejectMut.isPending}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  select={
                    orderable
                      ? {
                          checked: selected.has(pr.id),
                          disabledReason:
                            clashWith !== null
                              ? `Only one vendor per PO — ${clashWith} is already selected`
                              : undefined,
                          onToggle: () => toggleSelect(pr),
                        }
                      : undefined
                  }
                />
              );
            })
          )}

          <ListFooter
            total={total}
            noun="purchase request"
            page={currentPage}
            pageSize={PAGE_SIZE}
            onPage={(p) =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, Math.max(1, p)) }),
                replace: true,
              })
            }
            hint={
              canCreatePo
                ? 'Tick the PRs of one vendor, then "Create PO from Selected" to raise one PO with a line per PR.'
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}
