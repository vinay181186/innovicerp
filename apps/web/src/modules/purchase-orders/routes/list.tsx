// Purchase Orders list (UI-003-04). Ports legacy renderPurchaseOrders L25209.
//
// Column order follows legacy L25350-25355: PO No. | Lines | Date | Vendor |
// SO/JW | Total Qty | Received | Pending | Value | Status | Actions.
//
// Legacy puts its cell classes on the <td> itself (e.g. `<td class="td-ctr mono
// fw-700">` for Total Qty), not on a wrapper span — `td-ctr` is
// text-align:center, which only takes effect on the block-level cell. Carry the
// class through the column def so the flexRender loop can put it where legacy
// has it (ISSUE-020).
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-030):
//  - No "Value" column (legacy L25256): the list payload carries no rate/value
//    aggregate (`purchaseOrderListItemSchema` has lineCount/totalQty/receivedQty
//    only), and summing it needs the lines. Not faked.
//  - "PR ref" occupies legacy's SO/JW slot: the payload has `prCodeText` but no
//    SO/JW back-reference (legacy reads first.soRefId → CASCADE.findOrder).
//  - No stat-card filter row (L25332-25345) and no "PO Creation Pending —
//    Approved PRs" panel (L25315-25331). See ISSUE-030.
//  - No expand-to-lines (L25276-25303) — the list payload has no lines — and so
//    the tip line at L25358 that advertises it is not shipped either (trap 1,
//    ISSUE-017).
//  - No Approve/Reject/Print row actions: see ISSUE-030. Both live on the
//    detail page, one click away via View.
//  - Search placeholder says what the API actually matches, not legacy's
//    "Search PO, vendor, item…" (trap 1 — legacy's box is a client-side filter
//    over rendered rows; ours is a server-side code/PR-ref/vendor-code match).

import {
  type ListPurchaseOrdersQuery,
  PO_STATUSES,
  PO_TYPES,
  poSendsMaterialOut,
  type PoStatus,
  type PoType,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseOrdersList } from '../api';
import { PoStatusBadge } from '../components/po-status-badge';

// No pagination — mirror the SO/WO list: one fetch, scroll (no Prev/Next). The
// PO list-query cap is 200; the count line flags a rare larger set.
const LIST_LIMIT = 200;

/** One cell of the card's metric strip — big mono number over a tiny uppercase
 *  label, mirroring the SO/WO list (TOTAL QTY / RECEIVED / PENDING / LINES). */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: number;
  color?: string;
  bordered?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PO_STATUSES).optional(),
  poType: z.enum(PO_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const purchaseOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders',
  validateSearch: listSearchSchema,
  component: PurchaseOrdersListPage,
});

function PurchaseOrdersListPage(): React.JSX.Element {
  const search = purchaseOrdersListRoute.useSearch();
  const navigate = purchaseOrdersListRoute.useNavigate();

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

  const query: ListPurchaseOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      poType: search.poType,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.status, search.poType],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseOrdersList(query);
  // Tier-driven, per department (po_create sits in Purchase). Replaces the old
  // admin-or-manager flag, which collapsed all seven tiers into two and gave a
  // manager the same rights everywhere.
  //   + New PO          -> entry (L2 Data Entry and up)
  //   Edit / Create DC  -> edit  (L3 Editor and up; L2 creates but cannot alter)
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'po_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];

  // Legacy L25347-25348: when a filter is on, the panel title names it and a
  // "Show All" button clears it. Legacy's `_poFlt` is set by the stat cards;
  // ours by the status / type selects, which drive the same table.
  const activeFilter = [search.status, search.poType]
    .filter((v): v is PoStatus | PoType => Boolean(v))
    .map((v) => v.replaceAll('_', ' '))
    .join(', ');

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          Title + search + filters + New button stay pinned while the PO cards
          scroll underneath. Background must be opaque var(--bg) or cards show
          through as they pass under. Not bled edge-to-edge — that would give the
          app a horizontal scrollbar. */}
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
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            🛒 Purchase Orders
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="innovic-input"
              placeholder="🔍 Search code, PR ref, vendor code…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 240, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as PoStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 140, fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              value={search.poType ?? ''}
              onChange={(e) => {
                const v = e.target.value as PoType | '';
                void navigate({
                  search: (prev) => ({ ...prev, poType: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 140, fontSize: 12 }}
            >
              <option value="">All types</option>
              {PO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/purchase-orders/new" className="btn btn-primary">
                <Plus size={14} /> New PO
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {activeFilter ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12 }}
        >
          <span className="text3">
            Filtered:{' '}
            <span className="amber" style={{ fontWeight: 700 }}>
              {activeFilter}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, status: undefined, poType: undefined, page: 1 }),
                replace: true,
              })
            }
          >
            Show All
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20, color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load purchase orders'}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>
            No purchase orders yet
          </div>
        </div>
      ) : (
        rows.map((po) => {
          const isJW = po.poType === 'job_work';
          const isSvc = po.poType === 'service';
          const pending = po.totalQty - po.receivedQty;
          const accent =
            po.status === 'closed'
              ? 'var(--green)'
              : po.status === 'cancelled'
                ? 'var(--red)'
                : 'var(--blue)';
          return (
            <div
              key={po.id}
              className="panel"
              style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
            >
              {/* Accent bar — green closed, red cancelled, blue otherwise. */}
              <div style={{ width: 4, flexShrink: 0, background: accent }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Band 1: identity + type + status + actions */}
                <div
                  onClick={() =>
                    void navigate({ to: '/purchase-orders/$id', params: { id: po.id } })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '10px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <Link
                    to="/purchase-orders/$id"
                    params={{ id: po.id }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                    title="Open the PO detail page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {po.code}
                  </Link>
                  <span className={`badge ${isJW ? 'b-amber' : isSvc ? 'b-teal' : 'b-blue'}`}>
                    {isJW ? 'JW' : isSvc ? 'SVC' : 'MAT'}
                  </span>
                  <span className="fw-700" style={{ fontSize: 13 }}>
                    {po.vendorName ?? po.vendorCodeText ?? '—'}
                  </span>
                  <PoStatusBadge status={po.status} />
                  <span style={{ flex: 1 }} />
                  <div
                    style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      to="/purchase-orders/$id"
                      params={{ id: po.id }}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11 }}
                      title="View"
                    >
                      👁 View
                    </Link>
                    {canEdit && po.status !== 'closed' ? (
                      <Link
                        to="/purchase-orders/$id/edit"
                        params={{ id: po.id }}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                      >
                        ✎ Edit
                      </Link>
                    ) : null}
                    {/* Job Work AND Service both send material out — same DC lane. */}
                    {canEdit && poSendsMaterialOut(po.poType) && po.status !== 'draft' ? (
                      <Link
                        to="/delivery-challans/new"
                        search={{ poId: po.id }}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                      >
                        📦 Create DC
                      </Link>
                    ) : null}
                    {po.status !== 'closed' && po.status !== 'cancelled' ? (
                      <AssignTaskButton
                        linkedRef={{
                          type: 'purchase_order',
                          id: po.id,
                          display: `PO ${po.code}`,
                          navPage: `/purchase-orders/${po.id}`,
                        }}
                        suggestedTitle={`Follow up ${po.code}`}
                        label=""
                      />
                    ) : null}
                  </div>
                </div>
                {/* Band 2: metric strip + meta line */}
                <div
                  onClick={() =>
                    void navigate({ to: '/purchase-orders/$id', params: { id: po.id } })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '0 14px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}
                  >
                    <QtyBox label="Total Qty" value={po.totalQty} />
                    <QtyBox
                      label="Received"
                      value={po.receivedQty}
                      color={po.receivedQty > 0 ? 'var(--green)' : 'var(--text3)'}
                      bordered
                    />
                    <QtyBox
                      label="Pending"
                      value={pending}
                      color={pending > 0 ? 'var(--red)' : 'var(--green)'}
                      bordered
                    />
                    <QtyBox label="Lines" value={po.lineCount} bordered />
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text3)',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="text2">{po.poDate}</span>
                    <span>·</span>
                    <span>
                      PR{' '}
                      <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                        {po.prCodeText ?? '—'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No purchase orders'
            : total > LIST_LIMIT
              ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
              : `Showing all ${total} purchase order${total === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}
