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
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useExecutePlan, usePlan } from '@/modules/plans/api';
import {
  soPlanningKeys,
  usePlanningSoDetail,
  usePlanningSoDetails,
  usePlanningSoList,
} from '../api';
import { BomPlanningModal } from '../components/bom-planning-modal';
import { CreatePlanModal } from '../components/create-plan-modal';
import { EditPlanModal } from '../components/edit-plan-modal';

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
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const PLAN_STATUS_COLOR: Record<PlanStatus, string> = {
  in_planning: 'var(--amber)',
  planned: 'var(--blue)',
  jc_created: 'var(--cyan)',
  pr_created: 'var(--purple)',
  in_production: 'var(--cyan)',
  complete: 'var(--green)',
  cancelled: 'var(--text3)',
};

const DERIVED_STATUS_COLOR: Record<PlanDerivedStatus, string> = {
  route_card_pending: 'var(--amber)',
  gen_production_order: 'var(--blue)',
  in_production: 'var(--cyan)',
  production_complete: 'var(--green)',
};

const ORDER_STATUS_LABEL: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'Fully Planned',
  partial: 'Partial',
  unplanned: 'Unplanned',
};

const ORDER_STATUS_BADGE: Record<PlanningSoListItem['planningStatus'], string> = {
  fully_planned: 'b-green',
  partial: 'b-amber',
  unplanned: 'b-grey',
};

type ModalState =
  | { kind: 'none' }
  | { kind: 'create'; soLineId: string }
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
        ? `Partial (${line.remaining} left)`
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
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
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
          {/* ── Level 1 header: title · SO | JWSO toggle · search ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 14,
            }}
          >
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              SO / JWSO Planning
            </div>
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {(
                [
                  { key: 'so', label: 'SO' },
                  { key: 'jw', label: 'JWSO' },
                ] as { key: Source; label: string }[]
              ).map((tb) => (
                <button
                  key={tb.key}
                  type="button"
                  className={`btn btn-sm ${src === tb.key ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setSrc(tb.key)}
                >
                  {tb.label}
                </button>
              ))}
            </div>
            <input
              className="innovic-input"
              style={{ width: 300 }}
              placeholder="Search order no, customer, item, part name…"
              value={soSearch}
              onChange={(e) => setSoSearch(e.target.value)}
            />
          </div>

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
      { header: 'Order No', accessorKey: 'soCode' },
      { header: src === 'jw' ? 'Client' : 'Customer', accessorKey: 'customerName' },
      { header: 'Type', accessorKey: 'soType' },
      { header: 'Due', accessorKey: 'dueDate' },
      { header: 'Lines', accessorKey: 'totalLines' },
      { header: 'Order Qty', accessorKey: 'totalQty' },
      { header: 'Planned Qty', accessorKey: 'totalPlannedQty' },
      { header: '% Planned', accessorKey: 'planningPct' },
      { header: 'Status', accessorKey: 'planningStatus' },
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
        <table className="innovic-table">
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
                  style={{ color: 'var(--red)' }}
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
                    <td className="td-code">
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
                    <td
                      style={{
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={so.customerName ?? undefined}
                    >
                      {so.customerName ?? '—'}
                    </td>
                    <td>
                      <span className="badge b-grey">{so.soType.replaceAll('_', ' ')}</span>
                    </td>
                    <td className="mono">{so.dueDate ?? '—'}</td>
                    <td className="mono">{so.totalLines}</td>
                    <td className="mono fw-700">{so.totalQty}</td>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
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
const LINE_COLS: { key: string; label: string; width: number }[] = [
  { key: 'line', label: 'Line', width: 4 },
  { key: 'item', label: 'Item Code', width: 11 },
  { key: 'name', label: 'Item Name', width: 12 },
  { key: 'orderQty', label: 'Order Qty', width: 5 },
  { key: 'planned', label: 'Planned', width: 5 },
  { key: 'inProd', label: 'In Prod', width: 5 },
  { key: 'remaining', label: 'Remaining', width: 6 },
  { key: 'due', label: 'Due', width: 7 },
  { key: 'status', label: 'Status', width: 8 },
  { key: 'plans', label: 'Plans', width: 27 },
  { key: 'action', label: 'Action', width: 10 },
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
        style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em' }}
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
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          {detail.error instanceof Error ? detail.error.message : 'Failed to load order'}
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
        <HeaderField label="Order No">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {so.source === 'jw' ? <JwChip /> : null}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {so.soCode}
            </span>
          </span>
        </HeaderField>
        <HeaderField label={so.source === 'jw' ? 'Client' : 'Customer'}>
          <span className="fw-700">{so.customerName ?? '—'}</span>
        </HeaderField>
        <HeaderField label="Type">
          <span className="badge b-grey">{so.soType.replaceAll('_', ' ')}</span>
        </HeaderField>
        <HeaderField label="Due">
          <span className="mono">{so.dueDate ?? '—'}</span>
        </HeaderField>
        <HeaderField label="Client PO No">
          <span className="mono">{so.clientPoNo ?? '—'}</span>
        </HeaderField>
        <HeaderField label="Lines">
          <span className="mono">{so.lines.length}</span>
        </HeaderField>
      </div>

      {/* ── Every line, one table, no horizontal scroll ── */}
      <div className="panel">
        {so.lines.length === 0 ? (
          <div className="empty-state">This order has no lines.</div>
        ) : (
          <table
            className="innovic-table"
            style={{ tableLayout: 'fixed', width: '100%', margin: 0 }}
          >
            <colgroup>
              {LINE_COLS.map((c) => (
                <col key={c.key} style={{ width: `${c.width}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {LINE_COLS.map((c) => (
                  <th key={c.key} style={{ whiteSpace: 'normal', cursor: 'default' }}>
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
                        <div className="mono" style={{ fontSize: 9, color: 'var(--purple)' }}>
                          CPO {line.clientPoLineNo}
                        </div>
                      ) : null}
                    </td>
                    <td style={wrapCell} title={line.itemName ?? undefined}>
                      {line.itemName ?? '—'}
                    </td>
                    <td className="mono fw-700">{line.orderQty}</td>
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
                    <td className="mono">{line.dueDate ?? '—'}</td>
                    <td style={wrapCell}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: status.color }}>
                        {status.label}
                      </span>
                      <div className="mono text3" style={{ fontSize: 9 }}>
                        {status.pct}%
                      </div>
                    </td>
                    <td style={wrapCell}>
                      {line.plans.length === 0 && !status.hasDirectJc ? (
                        <span className="text3" style={{ fontSize: 11 }}>
                          —
                        </span>
                      ) : null}
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
                                : 'Execute failed'
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
                          <span className="mono text3" style={{ fontSize: 10 }}>
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
                            style={{ color: 'var(--cyan)', fontWeight: 700, whiteSpace: 'normal' }}
                            onClick={() => setModal({ kind: 'equip-bom', soLineId: line.soLineId })}
                          >
                            📦 Equipment BOM ({line.bomPartsCount})
                          </button>
                        ) : null}
                        {line.hasAssemblyBom && perms.entry ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--cyan)', fontWeight: 700, whiteSpace: 'normal' }}
                            onClick={() =>
                              setModal({ kind: 'assembly-bom', soLineId: line.soLineId })
                            }
                          >
                            📦 BOM Planning ({line.bomPartsCount})
                          </button>
                        ) : null}
                        {!line.hasEquipmentBom && line.remaining > 0 && perms.entry ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ fontWeight: 700 }}
                            onClick={() => setModal({ kind: 'create', soLineId: line.soLineId })}
                          >
                            + Plan {line.remaining}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    firstError instanceof Error ? firstError.message : failed.length > 0 ? 'Failed to load SO' : '';

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
        <div className="empty-state" style={{ color: 'var(--red)', padding: 12 }}>
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
            <col style={{ width: '16%' }} />
            <col style={{ width: '27%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ cursor: 'default' }}>Order No</th>
              <th style={{ cursor: 'default' }}>Line</th>
              <th style={{ cursor: 'default' }}>Item Code</th>
              <th style={{ cursor: 'default' }}>Item Name</th>
              <th style={{ cursor: 'default' }}>Order Qty</th>
              <th style={{ cursor: 'default' }}>Due</th>
              <th style={{ cursor: 'default' }}>Status</th>
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
                    {/* Item code is the thing the planner searched for —
                        strong, never muted. */}
                    <td style={wrapCell}>
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(line.itemCode, line.itemRevision, '')}
                      </span>
                    </td>
                    <td style={wrapCell}>{line.itemName ?? '—'}</td>
                    <td className="mono fw-700">{line.orderQty}</td>
                    <td className="mono">{line.dueDate ?? '—'}</td>
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
    plan.plannedStartDate ? `Start: ${plan.plannedStartDate}` : null,
    plan.plannedEndDate ? `End: ${plan.plannedEndDate}` : null,
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
        <span className="text3" style={{ fontSize: 9 }}>
          ({plan.opsCount} ops{plan.hasOutsourceOp ? ', 🏭 outsrc' : ''})
        </span>
      ) : null}
      {isFO && plan.foVendorCodeText ? (
        <span style={{ fontSize: 9, color: 'var(--purple)' }}>→ {plan.foVendorCodeText}</span>
      ) : null}
      <span style={{ fontWeight: 700, color: stColor, fontSize: 10 }}>{statusLabel}</span>

      {/* Route-card plan: the Production Order (once raised) is the way on. */}
      {isRouteCard && plan.productionOrderId && plan.productionOrderCode ? (
        <Link
          to="/production-orders/$id"
          params={{ id: plan.productionOrderId }}
          className="mono fw-700"
          style={{ fontSize: 10, color: 'var(--blue)' }}
          title="Open the Production Order"
        >
          {plan.productionOrderCode}
        </Link>
      ) : null}

      {/* Old-flow plan actions — unchanged behaviour, compact buttons. */}
      {!isRouteCard && plan.planStatus === 'in_planning' && canEdit ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}
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
            style={{ fontSize: 10, fontWeight: 700, opacity: isExecuting ? 0.7 : 1 }}
            disabled={isExecuting}
            title={executeError ?? undefined}
            onClick={onExecute}
          >
            {isExecuting ? (
              <>
                <Loader2 size={11} className="inline-block animate-spin" /> Executing…
              </>
            ) : executeError ? (
              '⚠ Retry'
            ) : (
              '⚡ Execute'
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10 }}
            disabled={isExecuting}
            onClick={onEdit}
            title="Edit plan"
          >
            ✏
          </button>
        </>
      ) : null}
      {plan.planStatus === 'pr_created' ? (
        <span className="mono" style={{ color: 'var(--purple)', fontSize: 10, fontWeight: 700 }}>
          PR:
          <PrLink
            id={plan.foPrId ?? plan.dpPrId}
            code={plan.foPrCode ?? plan.dpPrCode ?? ''}
            color="var(--purple)"
          />
          {plan.foMatPrCode ? (
            <span style={{ color: 'var(--amber)', marginLeft: 4 }}>
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
            fontSize: 10,
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
          style={{ fontSize: 10, color: 'var(--cyan)' }}
          onClick={onViewJc}
          title="Open the Job Card"
        >
          <Activity size={11} /> {plan.jcCode ?? 'View JC'}
        </button>
      ) : null}
    </div>
  );
}
