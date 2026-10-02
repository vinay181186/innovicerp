// Purchase Requests list (UI-003-04).
//
// ADR-199 conversion (2026-10-01): the PR book was a CARD per request (PrCard);
// it is now the shared FIT table (<DataTable tableKey={prList}>). Every field the
// card showed is kept — the ten visible columns carry identity + metrics, and the
// ▸ expand (PrListExpand) carries POL, source, operation, est. rate, approval and
// PO details. Data, filters, mutations and the API are unchanged. Columns, expand,
// row actions and the selection hook live in sibling files to keep this < 400.
// Unchanged: status counts ride in the status dropdown labels (owner 2026-09-26);
// Approve/Reject call /approve + /reject (no raw status PATCH); tick-boxes build
// one PO of ONE vendor (vendor lock via sel.isRowSelectable); Outsource Jobs tab.

import {
  type ListPurchaseRequestsQuery,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequestListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { todayIst } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { OutsourceJobsView } from '@/modules/outsource-jobs/components/outsource-jobs-view';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useApprovePr, usePurchaseRequestsList, useRejectPr } from '../api';
import { prListColumns } from '../components/pr-list-columns';
import { PrListExpand } from '../components/pr-list-expand';
import { PrListRowActions } from '../components/pr-list-row-actions';
import { PrListTabs, type PrListTab } from '../components/pr-list-tabs';
import { prOrderBalance } from '../lib/pr-balance';
import { usePrApprovalOn } from '../lib/pr-convertible';
import { PR_STATUS_LABELS } from '../lib/pr-labels';
import { usePrSelection } from '../lib/use-pr-selection';

const PAGE_SIZE = 25;

// Module-level constants keep the count query keys stable (fetched once, cached).
const COUNT_ALL: ListPurchaseRequestsQuery = { limit: 1, offset: 0 };
const COUNT_OPEN: ListPurchaseRequestsQuery = { status: 'open', limit: 1, offset: 0 };
const COUNT_APPROVED: ListPurchaseRequestsQuery = { status: 'approved', limit: 1, offset: 0 };
const COUNT_PO_CREATED: ListPurchaseRequestsQuery = { status: 'po_created', limit: 1, offset: 0 };
const COUNT_CANCELLED: ListPurchaseRequestsQuery = { status: 'cancelled', limit: 1, offset: 0 };

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
  // Tier-driven, per department (Purchase). Entry raises a PR; approve signs one
  // off; the card's 📝 PO raises a PURCHASE ORDER, so it follows po_create.entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'pr_create');
  const canCreatePo = effectiveFormPerms(eff, 'po_create').entry;
  const prApprovalOn = usePrApprovalOn();

  const [tab, setTab] = useState<PrListTab>('pr');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss PRs. Every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.prList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      sf: sf.param,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [sf.param, search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseRequestsList(query);

  // Approve / Reject — the only paths that advance an open PR.
  const approveMut = useApprovePr();
  const rejectMut = useRejectPr();
  const [actionError, setActionError] = useState<string | null>(null);

  // Both return the mutation's Promise (undefined when the confirm / prompt is
  // cancelled) so the row's ⋯ shows busy; a failure still lands in the red
  // banner, because the ⋯ menu only logs a rejected Promise.
  const handleApprove = useCallback(
    (pr: PurchaseRequestListItem): Promise<void> | undefined => {
      setActionError(null);
      if (!window.confirm(`Approve PR ${pr.code}?`)) return undefined;
      return approveMut.mutateAsync(pr.id).then(
        () => undefined,
        (e: unknown) =>
          setActionError(e instanceof Error ? e.message : 'Could not approve PR. Try again.'),
      );
    },
    [approveMut],
  );

  const handleReject = useCallback(
    (pr: PurchaseRequestListItem): Promise<void> | undefined => {
      setActionError(null);
      const reason = window.prompt(`Reject ${pr.code} — reason:`);
      if (reason === null) return undefined;
      if (!reason.trim()) {
        setActionError('Rejection reason is required.');
        return undefined;
      }
      return rejectMut.mutateAsync({ id: pr.id, reason: reason.trim() }).then(
        () => undefined,
        (e: unknown) =>
          setActionError(e instanceof Error ? e.message : 'Could not reject PR. Try again.'),
      );
    },
    [rejectMut],
  );

  // Status counts (whole set per filter), shown in the dropdown option labels.
  const allCount = usePurchaseRequestsList(COUNT_ALL).data?.total ?? 0;
  const openCount = usePurchaseRequestsList(COUNT_OPEN).data?.total ?? 0;
  const approvedCount = usePurchaseRequestsList(COUNT_APPROVED).data?.total ?? 0;
  const poCreatedCount = usePurchaseRequestsList(COUNT_PO_CREATED).data?.total ?? 0;
  const cancelledCount = usePurchaseRequestsList(COUNT_CANCELLED).data?.total ?? 0;
  const statusCounts: Partial<Record<PrStatus, number>> = {
    open: openCount,
    approved: approvedCount,
    po_created: poCreatedCount,
    cancelled: cancelledCount,
  };

  const setStatusFilter = useCallback(
    (nextStatus: PrStatus | undefined): void => {
      void navigate({
        search: (prev) => ({ ...prev, status: nextStatus, page: 1 }),
        replace: true,
      });
    },
    [navigate],
  );

  const clearFilters = useCallback((): void => {
    sf.clearFilters();
    setSearchInput('');
    void navigate({
      search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
      replace: true,
    });
  }, [navigate, sf]);

  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;
  const today = todayIst();
  const columns = useMemo(() => prListColumns((currentPage - 1) * PAGE_SIZE + 1), [currentPage]);

  // Selection: one vendor per PO (sel.isRowSelectable locks to the first vendor).
  const sel = usePrSelection(rows, canCreatePo);

  // ▸ expand — all content is on the row already, so no extra fetch.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }, []);

  // Row tint from the REAL PR status enum + order balance (ADR-199): cancelled →
  // cancelled, overdue-and-still-owing → late, approved/po_created/closed → done,
  // open → pending.
  const tintFor = useCallback(
    (pr: PurchaseRequestListItem): string | undefined => {
      if (pr.status === 'cancelled') return ROW_TINT.cancelled;
      const bal = prOrderBalance(pr);
      const overdue =
        pr.requiredDate != null &&
        pr.requiredDate < today &&
        (pr.status === 'open' || pr.status === 'approved') &&
        bal.balance > 0;
      if (overdue) return ROW_TINT.late;
      if (pr.status === 'po_created' || pr.status === 'approved' || bal.closed)
        return ROW_TINT.done;
      if (pr.status === 'open') return ROW_TINT.pending;
      return undefined;
    },
    [today],
  );

  // Assign Task: page-level modal (the ⋯ menu cannot host one). Hidden for the
  // read-only viewer role, which POST /tasks refuses.
  const { data: me } = useSession();
  const canAssign = Boolean(me) && me?.role !== 'viewer';
  const [assignPr, setAssignPr] = useState<PurchaseRequestListItem | null>(null);

  // Per-row ⋯ menu — reuses the module's existing handlers / targets.
  const rowActionsFor = useCallback(
    (pr: PurchaseRequestListItem): React.ReactNode => (
      <PrListRowActions
        pr={pr}
        canApprove={perms.approve}
        canCreatePo={canCreatePo}
        canAssign={canAssign}
        prApprovalOn={prApprovalOn}
        approving={approveMut.isPending}
        rejecting={rejectMut.isPending}
        onApprove={handleApprove}
        onReject={handleReject}
        onAssign={setAssignPr}
      />
    ),
    [
      perms.approve,
      canCreatePo,
      canAssign,
      prApprovalOn,
      approveMut.isPending,
      rejectMut.isPending,
      handleApprove,
      handleReject,
    ],
  );

  // Hide-page: a user whose VIEW was removed sees the no-access panel.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-201): on the list tab the page fills the content area and the
    // TABLE is the only scrollbox, so the column header cannot ride off the top at the
    // last row. The Outsource Jobs tab is its own screen and keeps today's page scroll.
    <div className={tab === 'osp' ? undefined : 'page-fill'}>
      <PrListTabs tab={tab} onChange={setTab} />

      {tab === 'osp' ? (
        <OutsourceJobsView />
      ) : (
        <>
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
            filtersActive={sf.filtering || search.status !== undefined || searchInput !== ''}
            primary={
              perms.entry ? (
                <Link to="/purchase-requests/new" className="btn btn-primary">
                  <Plus size={14} /> New PR
                </Link>
              ) : null
            }
          />

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

          {isError ? (
            <PageState
              state="error"
              message={error instanceof Error ? error.message : 'Could not load PRs. Try again.'}
            />
          ) : (
            <Panel fill bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.prList}
                columns={columns}
                rows={rows}
                loading={isLoading}
                defaultHidden={['sr_no', 'created_on']}
                sortFilterServer={sf}
                emptyText={
                  sf.filtering || search.search || search.status ? 'No PRs match.' : 'No PRs yet.'
                }
                onRowClick={(pr) =>
                  void navigate({ to: '/purchase-requests/$id', params: { id: pr.id } })
                }
                rowClassName={(pr) => tintFor(pr)}
                renderExpanded={(pr) =>
                  expanded.has(pr.id) ? (
                    <PrListExpand pr={pr} priceHidden={pr.priceVisible === false} />
                  ) : null
                }
                onToggleExpanded={(pr) => toggleExpand(pr.id)}
                rowActionsHeader="Actions"
                rowActions={rowActionsFor}
                selectable
                selectedKeys={sel.selectedKeys}
                isRowSelectable={sel.isRowSelectable}
                onToggleRow={sel.onToggleRow}
                onToggleAll={sel.onToggleAll}
                selectionActions={() => (
                  <>
                    {sel.lockedVendor ? (
                      <span className="text3" style={{ fontSize: 12 }}>
                        Vendor <span className="text2 fw-700">{sel.lockedVendor.label}</span>
                      </span>
                    ) : null}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={sel.clear}>
                      Clear
                    </button>
                    <Link
                      to="/purchase-orders/from-pr"
                      search={{ prIds: sel.selectedIds.join(',') }}
                      className="btn btn-primary btn-sm"
                      title="Raises one PO from the ticked PRs."
                    >
                      Create PO from Selected ({sel.selectedCount})
                    </Link>
                  </>
                )}
              />
            </Panel>
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
          />
        </>
      )}

      {assignPr ? (
        <AssignTaskModal
          linkedRef={{
            type: 'purchase_request',
            id: assignPr.id,
            display: `PR ${assignPr.code}`,
            navPage: `/purchase-requests/${assignPr.id}`,
          }}
          suggestedTitle={
            assignPr.status === 'open'
              ? `Review & approve ${assignPr.code}`
              : `Convert ${assignPr.code} to PO`
          }
          onClose={() => setAssignPr(null)}
        />
      ) : null}
    </div>
  );
}
