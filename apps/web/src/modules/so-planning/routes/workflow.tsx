// SO/JWSO Planning (PL-4b, rebuilt 2026-09-17 for ADR-170).
//
// Two levels, one screen:
//   Level 1 — the list of open orders. A SO | JWSO toggle in the header picks
//             which source is listed; the search box narrows it. Click a row
//             to open the order.
//   Level 2 — one order: a compact header (Order No, Customer, Type, Due,
//             Client PO) and ONE table with EVERY line, no paging, no
//             horizontal scrollbar (fixed layout, long text wraps). Each row
//             lists its plans as chips and carries the "+ Plan" / BOM actions.
//
// "+ Plan" opens the Create Plan box (create-plan-modal.tsx): qty + remark,
// schedule, raw material — nothing else. The plan is stored with
// opsSource 'route_card'; operations come from the item's Route Card when a
// Production Order is raised. Old plans (opsSource 'plan') keep their Edit /
// Execute / View JC / PR links inside their chip.
//
// URL state: ?src=so|jw (toggle), ?soId= (level 2), ?openPlan= (edit modal).

import {
  PLAN_DERIVED_STATUS_LABEL,
  type PlanDerivedStatus,
  type PlanStatus,
  type PrStatus,
  type PlanningLine,
  type PlanningPlanSummary,
  type PlanningSoListItem,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Activity, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { SortableHead } from '@/components/shared/sortable-head';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader, PageState } from '@/ui/layout';
import { useExecutePlan, usePlan } from '@/modules/plans/api';
import { soTypeLabel } from '@/modules/sales-orders/lib/so-status-label';
import {
  soPlanningKeys,
  usePlanningSoDetail,
  usePlanningSoDetails,
  usePlanningSoList,
} from '../api';
import { BomPlanningModal } from '../components/bom-planning-modal';
import { CreatePlanModal } from '../components/create-plan-modal';
import { RaisePrModal } from '../components/raise-pr-modal';
import { EditPlanModal } from '../components/edit-plan-modal';
import {
  AllocateStockModal,
  ReleaseStockModal,
  allocateCap,
  lineFacts,
} from '../components/reservation-modals';

const searchSchema = z.object({
  soId: z.string().uuid().optional(),
  openPlan: z.string().uuid().optional(),
  /** Which orders level 1 lists. Survives reload / Back. Default 'so'. */
  src: z.enum(['so', 'jw']).optional(),
});

export const soPlanningWorkflowRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning',
  validateSearch: searchSchema,
  component: PlanningWorkflowPage,
});

type Source = 'so' | 'jw';

// Legacy renders the raw stored status text (`esc(plan.status)`), which in the
// legacy store is Title Case ("In Planning", "JC Created", …). Our enum is
// snake_case, so map back to the legacy label. Same {status → label} shape the
// plans module already uses (routes/list.tsx, detail.tsx, dashboard.tsx).
const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

const PLAN_STATUS_COLOR: Record<PlanStatus, string> = {
  // Same colour per state as <StatusBadge kind="plan"> (wave 2).
  in_planning: 'var(--text3)',
  planned: 'var(--blue)',
  jc_created: 'var(--cyan)',
  pr_created: 'var(--cyan)',
  in_production: 'var(--amber)',
  complete: 'var(--green)',
  cancelled: 'var(--text3)',
};

const DERIVED_STATUS_COLOR: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'var(--text3)',
  gen_production_order: 'var(--blue)',
  in_production: 'var(--amber)',
  production_complete: 'var(--green)',
};

const ORDER_STATUS_LABEL: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'Fully Planned',
  partial: 'Partly Planned',
  unplanned: 'Unplanned',
};

const ORDER_STATUS_BADGE: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'b-green',
  partial: 'b-amber',
  unplanned: 'b-grey',
};

// ADR-171: a purchase request raised from a BUY line, chip label + colour.
const PR_STATUS_LABEL: Record<PrStatus, string> = {
  open: 'Open',
  approved: 'Approved',
  po_created: 'PO Created',
  cancelled: 'Cancelled',
};
const PR_STATUS_COLOR: Record<PrStatus, string> = {
  open: 'var(--amber)',
  approved: 'var(--blue)',
  po_created: 'var(--green)',
  cancelled: 'var(--text3)',
};

type ModalState =
  | { kind: 'none' }
  | { kind: 'create'; soLineId: string }
  | { kind: 'raise-pr'; soLineId: string }
  | { kind: 'allocate'; soLineId: string }
  | { kind: 'release'; soLineId: string }
  | { kind: 'edit'; planId: string }
  | { kind: 'equip-bom'; soLineId: string }
  | { kind: 'assembly-bom'; soLineId: string };

// The search-results view fetches one detail per matching SO. Cap it so a
// one-letter term does not fan out into a request per SO on the board; the
// header tells the user to refine when the cap is hit.
const MAX_SEARCH_SOS = 20;

// Plan/line lifecycle → the status label + colour a line is shown with. ONE
// helper, used by the line row AND the search-results row, so the two views
// can never disagree about what a line's state is.
//  - "executed" = work actually allocated: JC created, outsource/direct PR
//    raised, in production, or complete.
//  - covered but plan still a draft (in_planning/planned) → "In Planning"
//  - covered AND every plan executed → "Fully Planned"
//  - covered only by a plan-less direct JC → "In Production (no plan)"
// Green must mean executed, NOT "a draft plan exists for the full qty".
function lineStatusOf(line: PlanningLine): {
  label: string;
  color: string;
  /** 0–100: covered qty (plans + in-production direct JCs) over order qty. */
  pct: number;
  hasDirectJc: boolean;
} {
  const totalQty = line.orderQty;
  const hasDirectJc = line.directJcQty > 0;
  const planExecuted = (s: string): boolean =>
    s === 'jc_created' || s === 'pr_created' || s === 'in_production' || s === 'complete';
  const allPlansExecuted =
    line.plans.length > 0 && line.plans.every((p) => planExecuted(p.planStatus));
  const coveredByDraftPlans = line.remaining <= 0 && line.plans.length > 0 && !allPlansExecuted;

  const coveredQty = Math.min(totalQty, line.totalPlanned + line.directJcQty);
  const pct = totalQty > 0 ? Math.min(100, Math.round((coveredQty / totalQty) * 100)) : 0;
  const label =
    line.remaining <= 0
      ? line.plans.length === 0 && hasDirectJc
        ? 'In Production (no plan)'
        : coveredByDraftPlans
          ? 'In Planning'
          : 'Fully Planned'
      : line.plans.length > 0 || hasDirectJc
        ? `Partly Planned (${line.remaining} pending)`
        : 'Unplanned';
  const color =
    line.remaining <= 0
      ? line.plans.length === 0 && hasDirectJc
        ? 'var(--cyan)'
        : coveredByDraftPlans
          ? 'var(--amber)'
          : 'var(--green)'
      : line.plans.length > 0 || hasDirectJc
        ? 'var(--amber)'
        : 'var(--text3)';
  return { label, color, pct, hasDirectJc };
}

/** Small purple "JW" tag next to a Job Work order's number. */
function JwChip(): JSX.Element {
  return (
    <span className="tag" style={{ color: 'var(--purple)', background: 'var(--bg4)' }}>
      JW
    </span>
  );
}

function PlanningWorkflowPage(): JSX.Element {
  const navigate = useNavigate();
  const { soId, openPlan, src: srcParam } = soPlanningWorkflowRoute.useSearch();
  const src: Source = srcParam ?? 'so';
  const soList = usePlanningSoList();
  const qc = useQueryClient();
  // Page + write gate (plan_create, Planning dept). Writes on this page (create
  // plan, edit, execute, BOM planning) live in the plans module; here we hide
  // their entry points by tier and hide the whole page if VIEW was removed.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  const [soSearch, setSoSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(
    openPlan ? { kind: 'edit', planId: openPlan } : { kind: 'none' },
  );
  // ?openPlan= deep link (from the Plans list): the edit modal needs only the
  // plan id, so it lives at page level and works on either level.
  const editingPlan = usePlan(modal.kind === 'edit' ? modal.planId : '');

  const setSrc = (s: Source): void => {
    void navigate({
      to: '/planning',
      search: (prev) => ({ ...prev, src: s, soId: undefined }),
      replace: true,
    });
  };
  const openOrder = (id: string): void => {
    void navigate({ to: '/planning', search: (prev) => ({ ...prev, soId: id }) });
  };
  const backToList = (): void => {
    void navigate({ to: '/planning', search: (prev) => ({ ...prev, soId: undefined }) });
  };
  const refreshPlanning = (): void => {
    void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
  };

  // Client-side filter over the already-loaded list (it is fetched whole — it
  // scrolls, it does not page): the toggle picks the source, then the shared
  // matcher narrows within it — case-insensitive, partial, across every column
  // the row shows plus the item code + part name text behind it.
  const searchTerm = normalizeSearchTerm(soSearch);
  const visibleSos = useMemo(
    () =>
      (soList.data?.items ?? []).filter(
        (so) =>
          so.source === src &&
          matchesSearchTerm(
            [
              so.soCode,
              so.customerName,
              so.soType,
              so.dueDate,
              ORDER_STATUS_LABEL[so.planningStatus],
              so.itemsText,
            ],
            soSearch,
          ),
      ),
    [soList.data, src, soSearch],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed sees the no-access panel, not the page. `eff` is undefined
  // only while access is still loading — don't block then.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {soId ? (
        <OrderDetail
          soId={soId}
          perms={perms}
          modal={modal}
          setModal={setModal}
          onBack={backToList}
          onChanged={refreshPlanning}
        />
      ) : (
        <>
          {/* ── Level 1 header: the ONE list header (ui/layout ListHeader) —
              title · count, then the filter bar: client-side search · SO /
              JWSO source dropdown · Clear. ── */}
          <ListHeader
            title="SO/JWSO Planning"
            icon="📋"
            count={soList.data ? visibleSos.length : undefined}
            noun={src === 'jw' ? 'JWSO' : 'SO'}
            search={soSearch}
            onSearch={setSoSearch}
            searchPlaceholder="Search SO / JWSO No., customer, item code or name, due date, status…"
            updating={soList.isFetching && !soList.isLoading}
            filters={
              <select
                className="innovic-select"
                aria-label="Order source"
                title="Order source"
                value={src}
                onChange={(e) => setSrc(e.target.value === 'jw' ? 'jw' : 'so')}
              >
                <option value="so">SO</option>
                <option value="jw">JWSO</option>
              </select>
            }
            onClearFilters={() => {
              setSoSearch('');
              if (src !== 'so') setSrc('so');
            }}
            filtersActive={soSearch !== '' || src !== 'so'}
          />

          <OrderList
            src={src}
            items={visibleSos}
            loading={soList.isLoading}
            error={soList.error instanceof Error ? soList.error.message : null}
            onOpen={openOrder}
          />

          {/* Cross-order line search: while a term is typed, every LINE the
              term hits across the listed orders, under the order list. */}
          {searchTerm !== '' && visibleSos.length > 0 ? (
            <SearchResults term={searchTerm} sos={visibleSos} onPick={openOrder} />
          ) : null}
        </>
      )}

      {modal.kind === 'edit' && editingPlan.data ? (
        <EditPlanModal
          plan={editingPlan.data}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refreshPlanning();
            void editingPlan.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Level 1: order list ─────────────────────────────────────────────────

function OrderList({
  src,
  items,
  loading,
  error,
  onOpen,
}: {
  src: Source;
  items: PlanningSoListItem[];
  loading: boolean;
  error: string | null;
  onOpen: (soId: string) => void;
}): JSX.Element {
  // Header/sort config only — rows are rendered as plain <tr>/<td> below so
  // the cell classes (td-code, mono…) land on the <td> itself.
  const columns = useMemo<ColumnDef<PlanningSoListItem>[]>(
    () => [
      { header: src === 'jw' ? 'JWSO No.' : 'SO No.', accessorKey: 'soCode' },
      { header: 'Customer', accessorKey: 'customerName' },
      { header: src === 'jw' ? 'JWSO Type' : 'SO Type', accessorKey: 'soType' },
      { header: 'Due Date', accessorKey: 'dueDate' },
      { header: 'Lines', accessorKey: 'totalLines' },
      { header: 'Order Qty', accessorKey: 'totalQty' },
      { header: 'Plan Qty', accessorKey: 'totalPlannedQty' },
      { header: '% Planned', accessorKey: 'planningPct' },
      { header: 'Plan Status', accessorKey: 'planningStatus' },
    ],
    [src],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <SortableHead table={table} />
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="empty-state"
                  style={{ color: 'var(--red2)' }}
                >
                  {error}
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  No open {src === 'jw' ? 'JWSOs' : 'SOs'} to plan
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const so = row.original;
                return (
                  <tr
                    key={row.id}
                    onClick={() => onOpen(so.soId)}
                    style={{ cursor: 'pointer' }}
                    title="Open this order's lines"
                  >
                    <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {so.source === 'jw' ? <JwChip /> : null}
                        <span
                          className="mono fw-700"
                          style={{ color: 'var(--text)', fontSize: 13 }}
                        >
                          {so.soCode}
                        </span>
                      </span>
                    </td>
                    <td title={so.customerName ?? undefined}>{so.customerName ?? '—'}</td>
                    <td>
                      <span className="badge b-grey">{soTypeLabel(so.soType)}</span>
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(so.dueDate)}
                    </td>
                    <td className="mono td-num">{so.totalLines}</td>
                    <td className="mono fw-700 td-num">{so.totalQty}</td>
                    <td className="mono fw-700 td-num" style={{ color: 'var(--cyan)' }}>
                      {so.totalPlannedQty}
                    </td>
                    <td>
                      <span className={`badge ${ORDER_STATUS_BADGE[so.planningStatus]}`}>
                        {so.planningPct}%
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${ORDER_STATUS_BADGE[so.planningStatus]}`}>
                        {ORDER_STATUS_LABEL[so.planningStatus]}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Level 2: one order, every line ──────────────────────────────────────

/** Fixed-layout column widths (percent, sum 100). The table is `table-layout:
 *  fixed` at 100% width so it can never grow a horizontal scrollbar; long
 *  text wraps inside its column instead. */
// ADR-180 columns: Physical / Reserved / Available are three different numbers
// and each gets its own column, with the wording the whole app now uses.
// PHYSICAL = on the shelf · RESERVED = promised but still on the shelf ·
// AVAILABLE = Physical − Reserved.
const LINE_COLS: { key: string; label: string; width: number; title?: string }[] = [
  { key: 'line', label: 'Ln', width: 3 },
  { key: 'item', label: 'Item Code', width: 9 },
  { key: 'name', label: 'Item Name', width: 9 },
  { key: 'orderQty', label: 'Order Qty', width: 4 },
  {
    key: 'dispatched',
    label: 'Dispatched',
    width: 5,
    title: 'Already shipped to the customer against this line',
  },
  {
    key: 'physical',
    label: 'Physical',
    width: 4,
    title: 'On the shelf',
  },
  {
    key: 'reservedAll',
    label: 'Reserved (all lines)',
    width: 5,
    title: 'Promised to every SO line for this item, still on the shelf',
  },
  {
    key: 'reservedLine',
    label: 'Reserved (this line)',
    width: 5,
    title: 'Booked to this SO line',
  },
  {
    key: 'available',
    label: 'Available',
    width: 4,
    title: 'Physical − Reserved: free stock anyone may still be promised',
  },
  {
    key: 'balance',
    label: 'Pending to Plan',
    width: 5,
    title: 'Still to make or buy',
  },
  { key: 'planned', label: 'Plan Qty', width: 4 },
  { key: 'inProd', label: 'In Production', width: 4 },
  { key: 'remaining', label: 'Pending', width: 5 },
  { key: 'due', label: 'Due Date', width: 5 },
  { key: 'status', label: 'Plan Status', width: 6 },
  { key: 'plans', label: 'Plans', width: 15 },
  { key: 'action', label: 'Action', width: 8 },
];

/** A cell that may hold long text: wraps inside its fixed column instead of
 *  forcing the table wider (the shared `.innovic-table td` is nowrap). */
const wrapCell: React.CSSProperties = { whiteSpace: 'normal', overflowWrap: 'anywhere' };

function HeaderField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="mono text3"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function OrderDetail({
  soId,
  perms,
  modal,
  setModal,
  onBack,
  onChanged,
}: {
  soId: string;
  perms: { view: boolean; entry: boolean; edit: boolean };
  modal: ModalState;
  setModal: (m: ModalState) => void;
  onBack: () => void;
  /** Invalidate every planning query (list + details) after a write. */
  onChanged: () => void;
}): JSX.Element {
  const detail = usePlanningSoDetail(soId);
  const executePlan = useExecutePlan();
  const navigate = useNavigate();
  // ADR-180 — the three numbers as they stood right after the last Allocate /
  // Release, read off that action's own response.
  const [stockNote, setStockNote] = useState<{
    what: string;
    physicalQty: number;
    reservedQty: number;
    availableQty: number;
  } | null>(null);

  const backBtn = (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
      ← Back to list
    </button>
  );

  if (detail.isLoading) {
    return (
      <>
        <div style={{ marginBottom: 14 }}>{backBtn}</div>
        <div style={{ padding: 24 }}>
          <Loader2 className="inline-block animate-spin" /> Loading…
        </div>
      </>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <>
        <div style={{ marginBottom: 14 }}>{backBtn}</div>
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {detail.error instanceof Error
            ? detail.error.message
            : 'Could not load order. Try again.'}
        </div>
      </>
    );
  }

  const so = detail.data;
  const refresh = (): void => {
    onChanged();
    void detail.refetch();
  };

  return (
    <>
      {/* ── Compact order header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        {backBtn}
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Planning
        </div>
      </div>
      <div
        className="panel"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 28px',
          padding: '10px 14px',
          marginBottom: 12,
        }}
      >
        <HeaderField label={so.source === 'jw' ? 'JWSO No.' : 'SO No.'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {so.source === 'jw' ? <JwChip /> : null}
            {/* The order number opens the order itself — SO Master detail, or
                the JWSO detail for a JWSO. */}
            {so.source === 'jw' ? (
              <Link
                to="/job-work-orders/$id"
                params={{ id: soId }}
                className="td-code"
                title="Open the JWSO"
              >
                {so.soCode}
              </Link>
            ) : (
              <Link
                to="/sales-orders/$id"
                params={{ id: soId }}
                className="td-code"
                title="Open the SO"
              >
                {so.soCode}
              </Link>
            )}
          </span>
        </HeaderField>
        <HeaderField label="Customer">
          <span className="fw-700">{so.customerName ?? '—'}</span>
        </HeaderField>
        <HeaderField label={so.source === 'jw' ? 'JWSO Type' : 'SO Type'}>
          <span className="badge b-grey">{soTypeLabel(so.soType)}</span>
        </HeaderField>
        <HeaderField label="Due Date">
          <span className="mono">{fmtDate(so.dueDate)}</span>
        </HeaderField>
        <HeaderField label="Client PO No.">
          <span className="mono">{so.clientPoNo ?? '—'}</span>
        </HeaderField>
        <HeaderField label="Lines">
          <span className="mono">{so.lines.length}</span>
        </HeaderField>
      </div>

      {/* ADR-180 confirmation — the position straight after the last action. */}
      {stockNote ? (
        <div
          className="panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
            padding: '8px 14px',
            marginBottom: 12,
            borderColor: 'var(--green)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green2)' }}>
            ✓ {stockNote.what}
          </span>
          <span className="text3" style={{ fontSize: 11 }}>
            Physical{' '}
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {stockNote.physicalQty}
            </b>{' '}
            · Reserved{' '}
            <b className="mono" style={{ color: 'var(--purple)' }}>
              {stockNote.reservedQty}
            </b>{' '}
            · Available{' '}
            <b className="mono" style={{ color: 'var(--green2)' }}>
              {stockNote.availableQty}
            </b>
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setStockNote(null)}
            style={{ marginLeft: 'auto' }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ── Every line, one table ── */}
      <div className="panel">
        {so.lines.length === 0 ? (
          <div className="empty-state">This order has no lines.</div>
        ) : (
          // `tbl-wrap` so the ADR-180 stock columns (Physical / Reserved /
          // Available / Pending to Plan) scroll sideways on a narrow screen
          // instead of crushing every number into two lines. On a normal wide
          // screen the sheet still fills the panel exactly as before.
          <div className="tbl-wrap">
            <table
              className="innovic-table"
              style={{ tableLayout: 'fixed', width: '100%', minWidth: 1500, margin: 0 }}
            >
              <colgroup>
                {LINE_COLS.map((c) => (
                  <col key={c.key} style={{ width: `${c.width}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {LINE_COLS.map((c) => (
                    <th
                      key={c.key}
                      style={{ whiteSpace: 'normal', cursor: 'default' }}
                      title={c.title}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {so.lines.map((line) => {
                  const status = lineStatusOf(line);
                  return (
                    <tr key={line.soLineId}>
                      <td className="mono fw-700 text3">{line.lineNo}</td>
                      {/* `CODE/REV` — the customer's drawing revision from this
                        line; a JW line has none and keeps the bare code. The
                        code is the main thing: strong mono, darkest text. */}
                      <td style={wrapCell}>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {itemCodeWithRev(line.itemCode, line.itemRevision, '')}
                        </span>
                        {line.clientPoLineNo ? (
                          <div className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                            POL {line.clientPoLineNo}
                          </div>
                        ) : null}
                        {/* ADR-171: Item Master "Source" — why the Action cell
                          offers + Plan (make) or + PR (buy). */}
                        <div style={{ marginTop: 2 }}>
                          <span
                            className={`badge ${line.itemProcurementType === 'buy' ? 'b-amber' : 'b-grey'}`}
                            style={{ fontSize: 11, padding: '0 6px' }}
                            title={
                              line.itemProcurementType === 'buy'
                                ? 'Bought-in item — raise a purchase request'
                                : 'Made in-house — plan it'
                            }
                          >
                            {line.itemProcurementType === 'buy' ? 'Buy' : 'Make'}
                          </span>
                        </div>
                      </td>
                      <td style={wrapCell} title={line.itemName ?? undefined}>
                        {line.itemName ?? '—'}
                      </td>
                      <td className="mono fw-700">{line.orderQty}</td>
                      {/* ADR-180 stock block. Physical never moves when stock is
                        reserved — only a dispatch/issue changes it. */}
                      <td
                        className="mono"
                        style={{ color: line.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                      >
                        {line.dispatchedQty}
                      </td>
                      <td
                        className="mono fw-700"
                        style={{ color: line.physicalQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}
                      >
                        {line.physicalQty}
                      </td>
                      <td
                        className="mono"
                        style={{
                          color: line.totalReservedQty > 0 ? 'var(--purple)' : 'var(--text3)',
                        }}
                      >
                        {line.totalReservedQty}
                      </td>
                      <td
                        className="mono fw-700"
                        style={{ color: line.reservedQty > 0 ? 'var(--purple)' : 'var(--text3)' }}
                      >
                        {line.reservedQty}
                      </td>
                      <td
                        className="mono fw-700"
                        style={{ color: line.availableQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                      >
                        {line.availableQty}
                      </td>
                      <td
                        className="mono fw-700"
                        style={{ color: line.balanceToPlan > 0 ? 'var(--amber)' : 'var(--green)' }}
                      >
                        {line.balanceToPlan}
                      </td>
                      <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                        {line.totalPlanned}
                      </td>
                      <td
                        className="mono"
                        style={{ color: status.hasDirectJc ? 'var(--cyan)' : 'var(--text3)' }}
                      >
                        {line.directJcQty}
                      </td>
                      <td
                        className="mono fw-700"
                        style={{ color: line.remaining > 0 ? 'var(--amber)' : 'var(--green)' }}
                      >
                        {line.remaining}
                      </td>
                      <td className="mono">{fmtDate(line.dueDate)}</td>
                      <td style={wrapCell}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>
                          {status.label}
                        </span>
                        <div className="mono text3" style={{ fontSize: 11 }}>
                          {status.pct}%
                        </div>
                      </td>
                      <td style={wrapCell}>
                        {line.plans.length === 0 && line.prs.length === 0 && !status.hasDirectJc ? (
                          <span className="text3" style={{ fontSize: 11 }}>
                            —
                          </span>
                        ) : null}
                        {/* ADR-171: purchase requests raised from this BUY line. */}
                        {line.prs.map((pr) => (
                          <PrChip key={pr.id} pr={pr} />
                        ))}
                        {line.plans.map((p) => (
                          <PlanChip
                            key={p.id}
                            plan={p}
                            canEdit={perms.edit}
                            onEdit={() => setModal({ kind: 'edit', planId: p.id })}
                            onExecute={() => executePlan.mutate(p.id)}
                            isExecuting={executePlan.isPending && executePlan.variables === p.id}
                            executeError={
                              executePlan.isError && executePlan.variables === p.id
                                ? executePlan.error instanceof Error
                                  ? executePlan.error.message
                                  : 'Could not create the Job Card / PR. Try again.'
                                : null
                            }
                            onViewJc={() => {
                              // Open the Job Card page (not Operation Entry).
                              if (p.jcId) {
                                void navigate({ to: '/job-cards/$id', params: { id: p.jcId } });
                              }
                            }}
                          />
                        ))}
                        {/* Plan-less Job Cards created from SO Status — shown so
                          planners see production that bypassed planning and
                          don't double-issue. */}
                        {status.hasDirectJc ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 6,
                              padding: '3px 8px',
                              margin: '2px 0',
                              background: 'var(--cyan3)',
                              border: '1px solid var(--cyan2)',
                              borderRadius: 6,
                              fontSize: 11,
                            }}
                            title="Job Card(s) created directly from SO Status — counted as covered."
                          >
                            <span>🏭</span>
                            <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                              In Production (no plan)
                            </span>
                            <span className="text2">{line.directJcQty} pcs</span>
                            <span className="mono text3" style={{ fontSize: 11 }}>
                              {line.directJcCodes.join(', ')}
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td style={wrapCell}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {line.hasEquipmentBom && perms.entry ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{
                                color: 'var(--cyan)',
                                fontWeight: 700,
                                whiteSpace: 'normal',
                              }}
                              onClick={() =>
                                setModal({ kind: 'equip-bom', soLineId: line.soLineId })
                              }
                            >
                              📦 Equipment BOM ({line.bomPartsCount})
                            </button>
                          ) : null}
                          {line.hasAssemblyBom && perms.entry ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{
                                color: 'var(--cyan)',
                                fontWeight: 700,
                                whiteSpace: 'normal',
                              }}
                              onClick={() =>
                                setModal({ kind: 'assembly-bom', soLineId: line.soLineId })
                              }
                            >
                              📦 BOM Planning ({line.bomPartsCount})
                            </button>
                          ) : null}
                          {/* ADR-171: a BUY line is purchased, not planned. SO
                            lines get + PR; a JWSO line is the client's own
                            material and is never bought in. */}
                          {line.itemProcurementType === 'buy' ? (
                            so.source === 'jw' ? (
                              <span className="text3" style={{ fontSize: 11 }}>
                                Buy item — client material
                              </span>
                            ) : line.remaining > 0 && perms.entry ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                style={{ fontWeight: 700 }}
                                onClick={() =>
                                  setModal({ kind: 'raise-pr', soLineId: line.soLineId })
                                }
                              >
                                + PR {line.remaining}
                              </button>
                            ) : null
                          ) : !line.hasEquipmentBom && line.remaining > 0 && perms.entry ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ fontWeight: 700 }}
                              onClick={() => setModal({ kind: 'create', soLineId: line.soLineId })}
                            >
                              + Plan {line.remaining}
                            </button>
                          ) : null}
                          {/* ADR-180: book free stock to this line (Allocate) or
                            give a booking back (Release). Neither moves
                            Physical stock. */}
                          {perms.entry && line.itemId ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--amber2)', fontWeight: 700 }}
                              disabled={allocateCap(lineFacts(so.soCode, line)) <= 0}
                              title={
                                allocateCap(lineFacts(so.soCode, line)) > 0
                                  ? `Reserve up to ${allocateCap(lineFacts(so.soCode, line))} pcs of free stock to this line`
                                  : 'Nothing can be allocated to this line right now'
                              }
                              onClick={() =>
                                setModal({ kind: 'allocate', soLineId: line.soLineId })
                              }
                            >
                              Allocate
                            </button>
                          ) : null}
                          {perms.entry && line.reservedQty > 0 ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--purple)', fontWeight: 700 }}
                              title={`Give back some or all of the ${line.reservedQty} pcs reserved to this line`}
                              onClick={() => setModal({ kind: 'release', soLineId: line.soLineId })}
                            >
                              Release
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modal.kind === 'create' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <CreatePlanModal
              so={so}
              line={targetLine}
              onClose={() => setModal({ kind: 'none' })}
              onCreated={() => {
                // The plan is complete as saved (route-card flow) — no edit
                // modal to chain into. Close and refresh the lines.
                setModal({ kind: 'none' });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'raise-pr' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <RaisePrModal
              so={so}
              line={targetLine}
              onClose={() => setModal({ kind: 'none' })}
              onRaised={() => {
                // The PR is a Purchase document from here on; the refreshed
                // line shows it as a chip.
                setModal({ kind: 'none' });
                refresh();
              }}
            />
          );
        })()}

      {/* ADR-180 — Allocate / Release. Both read the post-action Physical /
          Reserved / Available straight off the response, so the strip under
          the header shows the new position without waiting for a refetch. */}
      {modal.kind === 'allocate' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <AllocateStockModal
              facts={lineFacts(so.soCode, targetLine)}
              onClose={() => setModal({ kind: 'none' })}
              onDone={(result) => {
                setModal({ kind: 'none' });
                setStockNote({
                  what: `Allocated ${result.qtyMoved} pcs to line ${targetLine.lineNo}`,
                  physicalQty: result.physicalQty,
                  reservedQty: result.reservedQty,
                  availableQty: result.availableQty,
                });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'release' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <ReleaseStockModal
              facts={lineFacts(so.soCode, targetLine)}
              onClose={() => setModal({ kind: 'none' })}
              onDone={(result) => {
                setModal({ kind: 'none' });
                setStockNote({
                  what: `Released ${result.qtyMoved} pcs from line ${targetLine.lineNo}`,
                  physicalQty: result.physicalQty,
                  reservedQty: result.reservedQty,
                  availableQty: result.availableQty,
                });
                refresh();
              }}
            />
          );
        })()}

      {modal.kind === 'equip-bom' && (
        <BomPlanningModal
          mode="equipment"
          soId={so.soId}
          soCode={so.soCode}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refresh();
          }}
        />
      )}

      {modal.kind === 'assembly-bom' && (
        <BomPlanningModal
          mode="assembly"
          soId={so.soId}
          soCode={so.soCode}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Cross-order line search ─────────────────────────────────────────────

/** Cross-SO search results: one row per SO LINE the term hits, in list order.
 *  Loads each SO's detail through the same query the single-SO view uses, so
 *  clicking a row opens that SO from cache with no second fetch. */
function SearchResults({
  term,
  sos,
  onPick,
}: {
  term: string;
  sos: PlanningSoListItem[];
  onPick: (soId: string) => void;
}): JSX.Element {
  const capped = sos.slice(0, MAX_SEARCH_SOS);
  const details = usePlanningSoDetails(capped.map((so) => so.soId));
  const anyLoading = details.some((d) => d.isLoading);
  // A failed detail (expired session, 500, network) must not silently drop its
  // SO — the list above still shows it, so a quiet "no lines match" would be a
  // confident wrong answer. Surface it the way the single-SO view does.
  const failed = details.filter((d) => d.isError);
  const firstError = failed[0]?.error;
  const failedMsg =
    firstError instanceof Error
      ? firstError.message
      : failed.length > 0
        ? 'Could not load SO. Try again.'
        : '';

  const groups = capped.flatMap((so, i) => {
    const data = details[i]?.data;
    if (!data) return [];
    const hits = data.lines.filter((line) =>
      matchesSearchTerm(
        [
          so.soCode,
          so.customerName,
          `L${line.lineNo}`,
          line.lineNo,
          itemCodeWithRev(line.itemCode, line.itemRevision, ''),
          line.itemCode,
          line.itemName,
        ],
        term,
      ),
    );
    // The list matched this SO on its `itemsText`, which is built from the SO
    // line's typed `itemCodeText` / `partName`; the detail's `itemCode` /
    // `itemName` prefer the item master's code/name, and the two can differ.
    // If none of the lines hit on the detail's fields, show them all rather
    // than let an SO that is in the list go silent here.
    const lines = hits.length > 0 ? hits : data.lines;
    return [{ so, lines }];
  });
  const lineCount = groups.reduce((n, g) => n + g.lines.length, 0);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-hdr">
        <div className="panel-title">
          Matching lines: {lineCount} line{lineCount === 1 ? '' : 's'} in {groups.length} order
          {groups.length === 1 ? '' : 's'} for “{term}”
          {sos.length > MAX_SEARCH_SOS ? (
            <div className="text3" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              Showing first {MAX_SEARCH_SOS} of {sos.length} matching orders — refine your search
            </div>
          ) : null}
        </div>
      </div>
      {anyLoading ? (
        <div style={{ padding: 24 }}>
          <Loader2 className="inline-block animate-spin" /> Loading…
        </div>
      ) : null}
      {failed.length > 0 ? (
        <div className="empty-state" style={{ color: 'var(--red2)', padding: 12 }}>
          Could not load {failed.length} of {capped.length} orders — {failedMsg}
        </div>
      ) : null}
      {!anyLoading && failed.length === 0 && lineCount === 0 ? (
        <div className="empty-state">No lines match “{term}”</div>
      ) : null}
      {lineCount > 0 ? (
        <table className="innovic-table" style={{ tableLayout: 'fixed', width: '100%', margin: 0 }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '5%' }} />
            {/* POL. The 5% comes out of Item Name (27% → 22%) so the set still
                totals exactly 100. */}
            <col style={{ width: '5%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ cursor: 'default' }}>SO / JWSO No.</th>
              <th style={{ cursor: 'default' }}>Ln</th>
              {/* POL is the CUSTOMER's own line number — an extra value beside
                  our "Line", never a substitute for it. */}
              <th style={{ cursor: 'default', color: 'var(--purple)' }}>POL</th>
              <th style={{ cursor: 'default' }}>Item Code</th>
              <th style={{ cursor: 'default' }}>Item Name</th>
              <th style={{ cursor: 'default' }}>Order Qty</th>
              <th style={{ cursor: 'default' }}>Due Date</th>
              <th style={{ cursor: 'default' }}>Plan Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ so, lines }) =>
              lines.map((line) => {
                const status = lineStatusOf(line);
                return (
                  <tr
                    key={line.soLineId}
                    onClick={() => onPick(so.soId)}
                    style={{ cursor: 'pointer' }}
                    title="Open this order"
                  >
                    <td className="td-code" style={wrapCell}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {so.source === 'jw' ? <JwChip /> : null}
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {so.soCode}
                        </span>
                      </span>
                    </td>
                    <td className="mono text3">{line.lineNo}</td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {line.clientPoLineNo ?? '—'}
                    </td>
                    {/* Item code is the thing the planner searched for —
                        strong, never muted. */}
                    <td style={wrapCell}>
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(line.itemCode, line.itemRevision, '')}
                      </span>
                    </td>
                    <td style={wrapCell}>{line.itemName ?? '—'}</td>
                    <td className="mono fw-700">{line.orderQty}</td>
                    <td className="mono">{fmtDate(line.dueDate)}</td>
                    <td style={wrapCell}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ─── PR chip (ADR-171) ───────────────────────────────────────────────────

/** One purchase request raised from a BUY line: 🛒 code (link to the PR) ·
 *  qty · status — the PO code once one is raised from it. */
function PrChip({ pr }: { pr: PlanningLine['prs'][number] }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '3px 8px',
        margin: '2px 0',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      <span>🛒</span>
      <Link
        to="/purchase-requests/$id"
        params={{ id: pr.id }}
        className="mono fw-700"
        style={{ color: 'var(--text)' }}
        title="Open the purchase request"
      >
        {pr.code}
      </Link>
      <span className="text2">
        PR · <b>{pr.qty} pcs</b>
      </span>
      <span style={{ fontWeight: 700, color: PR_STATUS_COLOR[pr.status], fontSize: 11 }}>
        {pr.status === 'po_created' && pr.poCode ? (
          <>
            PO <span className="mono">{pr.poCode}</span>
          </>
        ) : (
          PR_STATUS_LABEL[pr.status]
        )}
      </span>
    </div>
  );
}

// ─── Plan chip ───────────────────────────────────────────────────────────

/** A generated PR number, clickable to its detail page when the id is known
 *  (mirrors how a JC number links to /job-cards/$id). Falls back to plain text. */
function PrLink({
  id,
  code,
  color,
}: {
  id: string | null;
  code: string;
  color: string;
}): React.JSX.Element {
  if (!id) return <>{code}</>;
  return (
    <Link
      to="/purchase-requests/$id"
      params={{ id }}
      className="td-code"
      style={{ color }}
      onClick={(e) => e.stopPropagation()}
    >
      {code}
    </Link>
  );
}

/** One plan inside a line's Plans cell: code · type · qty · status, then the
 *  actions that apply.
 *   - opsSource 'plan' (old flow): Edit while in_planning; Execute + Edit
 *     while planned; PR links once raised; View JC once a JC exists.
 *   - opsSource 'route_card' (ADR-170): NO Edit / Execute. The derived status
 *     label, and a link to the Production Order once one exists. */
function PlanChip({
  plan,
  canEdit,
  onEdit,
  onExecute,
  onViewJc,
  isExecuting = false,
  executeError = null,
}: {
  plan: PlanningPlanSummary;
  canEdit: boolean;
  onEdit: () => void;
  onExecute: () => void | Promise<void>;
  onViewJc: () => void;
  isExecuting?: boolean;
  executeError?: string | null;
}): JSX.Element {
  const isDP = plan.planType === 'direct_purchase';
  const isFO = plan.planType === 'full_outsource';
  const typeIcon = isDP ? '🛒' : isFO ? '📦' : '🏭';
  const typeLabel = isDP ? 'Buy' : isFO ? 'OSP' : 'Mfg';
  const isRouteCard = plan.opsSource === 'route_card';
  // Raising a Production Order is its own permission (prodorder_create), not
  // this page's plan_create — the same gate the Plans list uses.
  const { data: eff } = useMyAccess();
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;
  const statusLabel =
    isRouteCard && plan.derivedStatus
      ? PLAN_DERIVED_STATUS_LABEL[plan.derivedStatus]
      : PLAN_STATUS_LABEL[plan.planStatus];
  const stColor =
    isRouteCard && plan.derivedStatus
      ? DERIVED_STATUS_COLOR[plan.derivedStatus]
      : PLAN_STATUS_COLOR[plan.planStatus];
  // Schedule / raw material / remark ride along as a tooltip so the chip stays
  // one line; the Plans page shows them in full.
  const tip = [
    plan.plannedStartDate ? `Start: ${fmtDate(plan.plannedStartDate)}` : null,
    plan.plannedEndDate ? `End: ${fmtDate(plan.plannedEndDate)}` : null,
    plan.rawMaterialGradeText ? `Grade: ${plan.rawMaterialGradeText}` : null,
    plan.rawMaterialSizeText ? `Size: ${plan.rawMaterialSizeText}` : null,
    plan.remarks ? `Remark: ${plan.remarks}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join('\n');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '3px 8px',
        margin: '2px 0',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 11,
      }}
      title={tip || undefined}
    >
      <span>{typeIcon}</span>
      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
        {plan.code}
      </span>
      <span className="text2">
        {typeLabel} · <b>{plan.planQty} pcs</b>
      </span>
      {!isRouteCard && !isDP && !isFO && plan.opsCount > 0 ? (
        <span className="text3" style={{ fontSize: 11 }}>
          ({plan.opsCount} ops{plan.hasOutsourceOp ? ', 🏭 outsrc' : ''})
        </span>
      ) : null}
      {isFO && plan.foVendorCodeText ? (
        <span style={{ fontSize: 11, color: 'var(--purple)' }}>→ {plan.foVendorCodeText}</span>
      ) : null}
      <span style={{ fontWeight: 700, color: stColor, fontSize: 11 }}>{statusLabel}</span>

      {/* Route-card plan: the Production Order (once raised) is the way on. */}
      {isRouteCard && plan.productionOrderId && plan.productionOrderCode ? (
        <Link
          to="/production-orders/$id"
          params={{ id: plan.productionOrderId }}
          className="mono fw-700"
          style={{ fontSize: 11, color: 'var(--blue)' }}
          title="Open the Production Order"
        >
          {plan.productionOrderCode}
        </Link>
      ) : null}

      {/* Route-card plan ready for its Production Order (ADR-185 derived
          status 'gen_production_order' = "RC Created"): the next step, same
          link + gate as the Plans list's Action column. */}
      {isRouteCard && plan.derivedStatus === 'gen_production_order' && canProductionOrder ? (
        <Link
          to="/production-orders/new"
          search={{ planId: plan.id, planCode: plan.code }}
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11 }}
          title="Raise the Production Order for this plan"
        >
          + Production Order
        </Link>
      ) : null}

      {/* Old-flow plan actions — unchanged behaviour, compact buttons. */}
      {!isRouteCard && plan.planStatus === 'in_planning' && canEdit ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--amber2)', fontWeight: 700 }}
          onClick={onEdit}
        >
          ✏ Edit
        </button>
      ) : null}
      {!isRouteCard && plan.planStatus === 'planned' && canEdit ? (
        <>
          <button
            type="button"
            className={`btn btn-sm ${executeError ? 'btn-danger' : 'btn-success'}`}
            style={{ fontSize: 11, fontWeight: 700, opacity: isExecuting ? 0.7 : 1 }}
            disabled={isExecuting}
            title={executeError ?? undefined}
            onClick={onExecute}
          >
            {isExecuting ? (
              <>
                <Loader2 size={11} className="inline-block animate-spin" /> Creating…
              </>
            ) : executeError ? (
              '⚠ Retry'
            ) : isDP || isFO ? (
              '⚡ Raise PR'
            ) : (
              '⚡ Create JC'
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={isExecuting}
            onClick={onEdit}
            title="Edit plan"
          >
            ✏
          </button>
        </>
      ) : null}
      {plan.planStatus === 'pr_created' ? (
        <span className="mono" style={{ color: 'var(--purple)', fontSize: 11, fontWeight: 700 }}>
          PR:
          <PrLink
            id={plan.foPrId ?? plan.dpPrId}
            code={plan.foPrCode ?? plan.dpPrCode ?? ''}
            color="var(--purple)"
          />
          {plan.foMatPrCode ? (
            <span style={{ color: 'var(--amber2)', marginLeft: 4 }}>
              Mat:
              <PrLink id={plan.foMatPrId} code={plan.foMatPrCode} color="var(--amber)" />
            </span>
          ) : null}
        </span>
      ) : null}
      {plan.ospPrs.length > 0 ? (
        <span
          className="mono"
          style={{
            color: 'var(--purple)',
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            gap: 3,
            alignItems: 'center',
          }}
          title="OSP purchase request(s) auto-raised for this plan's outsource op(s)"
        >
          PR:
          {plan.ospPrs.map((pr, i) => (
            <span key={pr.id}>
              <PrLink id={pr.id} code={pr.code} color="var(--purple)" />
              {i < plan.ospPrs.length - 1 ? ',' : ''}
            </span>
          ))}
        </span>
      ) : null}
      {plan.jcId &&
      (plan.planStatus === 'jc_created' ||
        plan.planStatus === 'in_production' ||
        plan.planStatus === 'complete' ||
        isRouteCard) ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11, color: 'var(--cyan)' }}
          onClick={onViewJc}
          title="Open the Job Card"
        >
          <Activity size={11} /> {plan.jcCode ?? 'View JC'}
        </button>
      ) : null}
    </div>
  );
}
