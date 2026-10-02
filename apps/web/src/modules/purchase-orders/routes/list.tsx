// Purchase Orders list (UI-003-04).
//
// ADR-199 table standard: ONE shared FIT table (<DataTable tableKey=…>), one
// line per PO, the fit engine sizing columns to the screen and dropping the
// rightmost unpinned ones into a ▸ detail row when it is too narrow. The old
// List View / Card View toggle is gone — the hand-built card layout and the
// hand-rolled PoSheetTable it toggled with are both retired. Row click opens
// the PO; the ▸ reveals the PO's line items (own fetch, PoExpandedLines).
//
// Columns (first pinned): PO No. · PO Date · PO Type · Vendor · PR No. · Qty ·
// Received · Pending · Value · PO Status — see components/po-list-columns.tsx.
// Value keeps its price gate (API nulls totalAmount for viewers without price).
//
// Row actions (RowActions prop): Edit (edit tier, not closed), Create DC (edit
// tier, Job Work / Service, not draft), Assign (open-ish POs) — the same gates
// the retired card / sheet used, carried over verbatim.
//
// Row tint by PO status (rowClassName + ROW_TINT): draft / qc_pending = pending,
// closed = done, cancelled = cancelled; open and partial carry no tint (active).
//
// Search is server-side: the API matches PO code, PR ref, vendor code AND name,
// status, PO type, PO date and the item code / name on the lines, so the
// placeholder names the columns rather than listing every matched field.

import {
  type ListPurchaseOrdersQuery,
  PO_STATUSES,
  PO_TYPES,
  poSendsMaterialOut,
  type PoStatus,
  type PoType,
  type PurchaseOrderListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { usePurchaseOrdersList } from '../api';
import { PoExpandedLines } from '../components/po-expanded-lines';
import { purchaseOrderListColumns } from '../components/po-list-columns';
import { PO_STATUS_LABELS, PO_TYPE_LABELS } from '../lib/po-labels';

// No pagination — mirror the SO/WO list: one fetch, scroll (no Prev/Next). The
// PO list-query cap is 200; the count line flags a rare larger set.
const LIST_LIMIT = 200;

// PO status → row tint (ADR-199 ROW_TINT). Real status enum only: draft and
// qc_pending read as pending work, closed is done, cancelled is cancelled; the
// active middle (open, partly received) stays untinted.
const ROW_TINT_BY_STATUS: Record<PoStatus, string | undefined> = {
  draft: ROW_TINT.pending,
  open: undefined,
  partial: undefined,
  qc_pending: ROW_TINT.pending,
  closed: ROW_TINT.done,
  cancelled: ROW_TINT.cancelled,
};

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
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-PO  26 " and "IN-PO 26" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is capped at
  // LIST_LIMIT, so filtering only the loaded rows would miss POs. Every change
  // goes back to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.poList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListPurchaseOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      poType: search.poType,
      sf: sf.param,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [sf.param, search.search, search.status, search.poType],
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

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row so a closed PO never fetches its lines.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo(
    () => purchaseOrderListColumns({ canSeePrice: perms.price }),
    [perms.price],
  );

  // Row actions — Edit · Create DC · Assign, with the gates the retired card and
  // sheet used, unchanged. No View button: the row click opens the PO.
  const rowActions = (po: PurchaseOrderListItem): React.JSX.Element => (
    <RowActions
      editTo={canEdit && po.status !== 'closed' ? `/purchase-orders/${po.id}/edit` : undefined}
      renderLink={(p) => <Link {...p} />}
      extra={
        <>
          {/* Job Work AND Service both send material out — same DC lane. */}
          {canEdit && poSendsMaterialOut(po.poType) && po.status !== 'draft' ? (
            <Link
              to="/delivery-challans/new"
              search={{ poId: po.id }}
              className="btn btn-ghost btn-sm"
              title="Create DC"
            >
              Create DC
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
              className="btn btn-ghost btn-sm btn-icon"
              label=""
            />
          ) : null}
        </>
      }
    />
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view POs. Ask an admin.
      </div>
    );
  }

  const emptyText =
    sf.filtering || search.search || search.status || search.poType
      ? 'No POs match.'
      : 'No POs yet.';

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · + New PO, then
          the filter bar (search · status · type · Clear). */}
      <ListHeader
        title="Purchase Orders"
        icon="📋"
        count={total}
        noun="purchase order"
        filterNote={
          [
            search.status ? PO_STATUS_LABELS[search.status] : null,
            search.poType ? PO_TYPE_LABELS[search.poType] : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search PO no, vendor, PR, item, status, type, date…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="PO status"
              title="PO status"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as PoStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
            >
              <option value="">All Statuses</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PO_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              aria-label="PO type"
              title="PO type"
              value={search.poType ?? ''}
              onChange={(e) => {
                const v = e.target.value as PoType | '';
                void navigate({
                  search: (prev) => ({ ...prev, poType: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
            >
              <option value="">All Types</option>
              {PO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PO_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              status: undefined,
              poType: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={
          sf.filtering ||
          search.status !== undefined ||
          search.poType !== undefined ||
          searchInput !== ''
        }
        primary={
          canAdd ? (
            <Link to="/purchase-orders/from-pr" className="btn btn-primary">
              <Plus size={14} /> New PO
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load purchase orders. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.poList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={emptyText}
            defaultHidden={['created_on']}
            sortFilterServer={sf}
            onRowClick={(po) =>
              void navigate({ to: '/purchase-orders/$id', params: { id: po.id } })
            }
            rowClassName={(po) => ROW_TINT_BY_STATUS[po.status]}
            rowActions={(po) => rowActions(po)}
            // The part list is fetched only for a row that is actually open —
            // returning null for a collapsed row means PoExpandedLines (and its
            // detail query) never mounts for it.
            renderExpanded={(po) =>
              expandedIds.has(po.id) ? <PoExpandedLines poId={po.id} /> : null
            }
            // The fit table's ▸ is the row's one expand control: it opens the
            // line items too.
            onToggleExpanded={(po) => toggleExpand(po.id)}
          />
        </Panel>
      )}

      <ListFooter total={total} noun="purchase order" limit={LIST_LIMIT} />
    </div>
  );
}
