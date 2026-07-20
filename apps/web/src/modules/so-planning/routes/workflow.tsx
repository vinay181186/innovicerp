// SO/JW Planning workflow (PL-4b §1, §2, §3). Two-pane layout mirroring
// legacy renderSOPlanning (HTML L9299):
//   Left  = 250px fixed SO list with planning %.
//   Right = per-line cards with status-specific action buttons.
// Clicking actions opens the modals (create, edit, equip-bom, assembly-bom).

import type { PlanStatus, PlanningPlanSummary, PlanningSoListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useExecutePlan, usePlan } from '@/modules/plans/api';
import { usePlanningSoDetail, usePlanningSoList } from '../api';
import { BomPlanningModal } from '../components/bom-planning-modal';
import { CreatePlanModal } from '../components/create-plan-modal';
import { EditPlanModal } from '../components/edit-plan-modal';

const searchSchema = z.object({
  soId: z.string().uuid().optional(),
  openPlan: z.string().uuid().optional(),
});

export const soPlanningWorkflowRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning',
  validateSearch: searchSchema,
  component: PlanningWorkflowPage,
});

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

type ModalState =
  | { kind: 'none' }
  | { kind: 'create'; soLineId: string }
  | { kind: 'edit'; planId: string }
  | { kind: 'equip-bom'; soLineId: string }
  | { kind: 'assembly-bom'; soLineId: string };

function PlanningWorkflowPage(): JSX.Element {
  const navigate = useNavigate();
  const { soId: soIdParam, openPlan } = soPlanningWorkflowRoute.useSearch();
  const soList = usePlanningSoList();
  const [selSoId, setSelSoId] = useState<string | null>(soIdParam ?? null);
  const [soSearch, setSoSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(
    openPlan ? { kind: 'edit', planId: openPlan } : { kind: 'none' },
  );

  // Auto-select first SO on first load.
  useEffect(() => {
    if (!selSoId && soList.data && soList.data.items.length > 0) {
      setSelSoId(soList.data.items[0]!.soId);
    }
  }, [soList.data, selSoId]);

  // Keep ?soId= in URL aligned with selection.
  useEffect(() => {
    if (selSoId && selSoId !== soIdParam) {
      void navigate({
        to: '/planning',
        search: (prev) => ({ ...prev, soId: selSoId }),
        replace: true,
      });
    }
  }, [selSoId, soIdParam, navigate]);

  // Client-side filter over the already-loaded SO list (presentational only —
  // the auto-select-first effect reads soList.data.items directly, unaffected).
  const soQuery = soSearch.trim().toLowerCase();
  const visibleSos = (soList.data?.items ?? []).filter(
    (so) =>
      !soQuery ||
      so.soCode.toLowerCase().includes(soQuery) ||
      (so.customerName ?? '').toLowerCase().includes(soQuery) ||
      (so.itemsText ?? '').toLowerCase().includes(soQuery),
  );

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 70px)' }}>
      {/* Left pane */}
      <div
        style={{
          width: 250,
          minWidth: 250,
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          background: 'var(--bg2)',
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
          }}
        >
          Select SO/JW
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <input
            className="innovic-input"
            style={{ width: '100%' }}
            placeholder="🔍 Search SO / customer / item…"
            value={soSearch}
            onChange={(e) => setSoSearch(e.target.value)}
          />
        </div>
        {soList.isLoading && (
          <div style={{ padding: 16 }}>
            <Loader2 className="inline-block animate-spin" /> Loading…
          </div>
        )}
        {soList.data && visibleSos.length === 0 && (
          <div className="empty-state" style={{ padding: 16 }}>
            No SOs found
          </div>
        )}
        {visibleSos.map((so) => (
          <SoListRow
            key={so.soId}
            so={so}
            active={so.soId === selSoId}
            onClick={() => setSelSoId(so.soId)}
          />
        ))}
      </div>

      {/* Right pane */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <RightPane
          soId={selSoId}
          modal={modal}
          setModal={setModal}
        />
      </div>
    </div>
  );
}

function SoListRow({
  so,
  active,
  onClick,
}: {
  so: PlanningSoListItem;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const dotColor =
    so.planningStatus === 'fully_planned'
      ? 'var(--green)'
      : so.planningStatus === 'partial'
        ? 'var(--amber)'
        : 'var(--text3)';
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        borderLeft: `3px solid ${active ? 'var(--cyan)' : 'transparent'}`,
        background: active ? 'var(--bg3)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {so.source === 'jw' ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--purple)',
                background: 'rgba(124,58,237,0.12)',
                padding: '1px 4px',
                borderRadius: 3,
              }}
            >
              JW
            </span>
          ) : null}
          <span className="mono fw-700" style={{ fontSize: 12, color: 'var(--cyan)' }}>
            {so.soCode}
          </span>
        </span>
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            background: dotColor,
            color: '#fff',
            fontWeight: 700,
          }}
        >
          {so.planningPct}%
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{so.customerName ?? '—'}</div>
      {so.itemsText ? (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={so.itemsText}
        >
          {so.itemsText}
        </div>
      ) : null}
    </div>
  );
}

function RightPane({
  soId,
  modal,
  setModal,
}: {
  soId: string | null;
  modal: ModalState;
  setModal: (m: ModalState) => void;
}): JSX.Element {
  const detail = usePlanningSoDetail(soId);
  const editingPlan = usePlan(modal.kind === 'edit' ? modal.planId : '');
  const executePlan = useExecutePlan();
  const navigate = useNavigate();

  // Legacy always renders the header row, then the right content; with no SO
  // selected the header reads "Select an SO" (renderSOPlanning L9439-9441).
  if (!soId) {
    return (
      <>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Select an SO
          </div>
        </div>
        <div className="empty-state">
          Select an SO from the left panel to view and plan its lines.
        </div>
      </>
    );
  }
  if (detail.isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Loader2 className="inline-block animate-spin" /> Loading…
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div
        style={{
          padding: 12,
          color: 'var(--red)',
          background: 'rgba(239,68,68,0.1)',
          borderRadius: 4,
        }}
      >
        {detail.error instanceof Error ? detail.error.message : 'Failed to load SO'}
      </div>
    );
  }

  const so = detail.data;
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Planning: {so.soCode} {so.customerName ? <small>({so.customerName})</small> : null}
        </div>
      </div>
      {so.lines.length === 0 ? (
        <div className="empty-state">
          Select an SO from the left panel to view and plan its lines.
        </div>
      ) : (
        so.lines.map((line) => {
          const totalQty = line.orderQty;
          const hasDirectJc = line.directJcQty > 0;
          // Plan/line lifecycle (shared by the header label AND the bar colour):
          //  - "executed" = work actually allocated: JC created, outsource/direct
          //    PR raised, in production, or complete.
          //  - covered but plan still a draft (in_planning/planned) → "In Planning"
          //  - covered AND every plan executed → "Fully Planned"
          //  - covered only by a plan-less direct JC → "In Production (no plan)"
          // Green must mean executed, NOT "a draft plan exists for the full qty".
          const planExecuted = (s: string): boolean =>
            s === 'jc_created' || s === 'pr_created' || s === 'in_production' || s === 'complete';
          const allPlansExecuted =
            line.plans.length > 0 && line.plans.every((p) => planExecuted(p.planStatus));
          const coveredByDraftPlans =
            line.remaining <= 0 && line.plans.length > 0 && !allPlansExecuted;

          // Bar FILL = covered qty (plans + in-production direct JCs).
          const coveredQty = Math.min(totalQty, line.totalPlanned + line.directJcQty);
          const pct = totalQty > 0 ? Math.min(100, Math.round((coveredQty / totalQty) * 100)) : 0;
          // Bar COLOUR follows execution, not just coverage: amber while covered
          // only by draft plans (in planning, nothing allocated yet), green once
          // executed (JC/PR) or in production, cyan when partial, grey when none.
          const barColor = coveredByDraftPlans
            ? 'var(--amber)'
            : pct >= 100
              ? 'var(--green)'
              : pct > 0
                ? 'var(--cyan)'
                : 'var(--text3)';
          const lineStatusLabel =
            line.remaining <= 0
              ? line.plans.length === 0 && hasDirectJc
                ? 'In Production (no plan)'
                : coveredByDraftPlans
                  ? 'In Planning'
                  : 'Fully Planned'
              : line.plans.length > 0 || hasDirectJc
                ? `Partial (${line.remaining} left)`
                : 'Unplanned';
          const lineStatusColor =
            line.remaining <= 0
              ? line.plans.length === 0 && hasDirectJc
                ? 'var(--cyan)'
                : coveredByDraftPlans
                  ? 'var(--amber)'
                  : 'var(--green)'
              : line.plans.length > 0 || hasDirectJc
                ? 'var(--amber)'
                : 'var(--text3)';
          return (
            <div
              key={line.soLineId}
              className="card"
              style={{
                marginBottom: 12,
                padding: 0,
                overflow: 'hidden',
                borderLeft: `3px solid ${lineStatusColor}`,
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text3)',
                      fontFamily: 'var(--mono)',
                    }}
                  >
                    LINE {line.lineNo}
                  </span>
                  {line.clientPoLineNo ? (
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--purple)',
                        fontWeight: 700,
                        background: 'rgba(124,58,237,0.1)',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}
                    >
                      [CPO:{line.clientPoLineNo}]
                    </span>
                  ) : null}
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>
                    {line.itemCode ?? ''}
                  </span>
                  <span style={{ fontSize: 12 }}>{line.itemName ?? ''}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12 }}>
                    SO: <b>{line.orderQty}</b>
                  </span>
                  <span style={{ fontSize: 12 }}>
                    Due: <b>{line.dueDate ?? '—'}</b>
                  </span>
                </div>
              </div>
              {/* Progress */}
              <div
                style={{
                  padding: '6px 14px',
                  background: 'var(--bg)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                    Planned:{' '}
                    <b style={{ color: 'var(--cyan)' }}>{line.totalPlanned}</b>
                    {hasDirectJc ? (
                      <>
                        {' '}
                        + <b style={{ color: 'var(--cyan)' }}>{line.directJcQty}</b> in prod
                      </>
                    ) : null}{' '}
                    / {line.orderQty} pcs ({pct}%)
                  </span>
                  <span
                    style={{ fontSize: 10, fontWeight: 700, color: lineStatusColor }}
                  >
                    {lineStatusLabel}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg5)', borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: 6,
                      background: barColor,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
              {/* Plan sub-cards */}
              {line.plans.length > 0 && (
                <div style={{ padding: '6px 14px' }}>
                  {line.plans.map((p) => (
                    <PlanCard
                      key={p.id}
                      plan={p}
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
                </div>
              )}
              {/* Plan-less Job Cards created from SO Status — shown so planners
                  see production that bypassed planning and don't double-issue. */}
              {hasDirectJc && (
                <div style={{ padding: '6px 14px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      margin: '4px 0',
                      background: 'rgba(34,211,238,0.06)',
                      borderRadius: 6,
                      border: '1px solid rgba(34,211,238,0.3)',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>🏭</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)' }}>
                      In Production (no plan)
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                      {line.directJcQty} pcs
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}
                    >
                      {line.directJcCodes.join(', ')}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                    Job Card(s) created directly from SO Status — counted as covered.
                    {line.remaining > 0 ? ` Plan only the remaining ${line.remaining} pcs.` : ''}
                  </div>
                </div>
              )}
              {/* Footer actions */}
              <div
                style={{
                  padding: '6px 14px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 6,
                  borderTop: '1px solid var(--border)',
                }}
              >
                {line.hasEquipmentBom ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      background: 'rgba(34,211,238,0.08)',
                      color: 'var(--cyan)',
                      border: '1px solid rgba(34,211,238,0.3)',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                    onClick={() => setModal({ kind: 'equip-bom', soLineId: line.soLineId })}
                  >
                    📦 Equipment BOM Planning ({line.bomPartsCount} parts)
                  </button>
                ) : null}
                {line.hasAssemblyBom ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      background: 'rgba(34,211,238,0.08)',
                      color: 'var(--cyan)',
                      border: '1px solid rgba(34,211,238,0.3)',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                    onClick={() => setModal({ kind: 'assembly-bom', soLineId: line.soLineId })}
                  >
                    📦 BOM Planning ({line.bomPartsCount} parts)
                  </button>
                ) : null}
                {!line.hasEquipmentBom && line.remaining > 0 ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      background: 'var(--cyan)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                    onClick={() => setModal({ kind: 'create', soLineId: line.soLineId })}
                  >
                    + Plan {line.remaining} pcs
                  </button>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {/* Modals */}
      {modal.kind === 'create' &&
        (() => {
          const targetLine = so.lines.find((l) => l.soLineId === modal.soLineId);
          if (!targetLine) return null;
          return (
            <CreatePlanModal
              so={so}
              line={targetLine}
              onClose={() => setModal({ kind: 'none' })}
              onCreated={(planId) => {
                setModal({ kind: 'edit', planId });
                void detail.refetch();
              }}
            />
          );
        })()}

      {modal.kind === 'edit' && editingPlan.data ? (
        <EditPlanModal
          plan={editingPlan.data}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            void detail.refetch();
            void editingPlan.refetch();
          }}
        />
      ) : null}

      {modal.kind === 'equip-bom' && (
        <BomPlanningModal
          mode="equipment"
          soId={so.soId}
          soCode={so.soCode}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            void detail.refetch();
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
            void detail.refetch();
          }}
        />
      )}
    </>
  );
}

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
    <Link to="/purchase-requests/$id" params={{ id }} className="td-code" style={{ color }}>
      {code}
    </Link>
  );
}

function PlanCard({
  plan,
  onEdit,
  onExecute,
  onViewJc,
  isExecuting = false,
  executeError = null,
}: {
  plan: PlanningPlanSummary;
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
  const stColor =
    plan.planStatus === 'in_planning'
      ? 'var(--amber)'
      : plan.planStatus === 'planned'
        ? 'var(--blue)'
        : plan.planStatus === 'jc_created'
          ? 'var(--cyan)'
          : plan.planStatus === 'pr_created'
            ? // Legacy: var(--purple,#8b5cf6). --purple IS defined (#7c3aed), so
              // the #8b5cf6 fallback is dead code in legacy and must not be ported.
              'var(--purple)'
            : 'var(--green)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        margin: '4px 0',
        background: 'var(--bg)',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 11 }}>{typeIcon}</span>
      <span className="mono fw-700" style={{ fontSize: 11, color: 'var(--cyan)' }}>
        {plan.code}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text2)' }}>
        {typeLabel} · <b>{plan.planQty} pcs</b>
      </span>
      {!isDP && !isFO && plan.opsCount > 0 ? (
        <span style={{ fontSize: 9, color: 'var(--text3)' }}>
          ({plan.opsCount} ops{plan.hasOutsourceOp ? ', 🏭 outsrc' : ''})
        </span>
      ) : null}
      {isFO && plan.foVendorCodeText ? (
        <span style={{ fontSize: 9, color: 'var(--purple)' }}>→ {plan.foVendorCodeText}</span>
      ) : null}
      <span
        style={{
          fontWeight: 700,
          color: stColor,
          fontSize: 10,
          marginLeft: 'auto',
        }}
      >
        {PLAN_STATUS_LABEL[plan.planStatus]}
      </span>
      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
        {plan.planStatus === 'in_planning' && (
          <button
            type="button"
            className="btn btn-sm"
            style={{
              background: 'var(--amber)',
              color: '#000',
              fontSize: 10,
              fontWeight: 700,
            }}
            onClick={onEdit}
          >
            ✏ Edit
          </button>
        )}
        {plan.planStatus === 'planned' && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: executeError ? 'var(--red)' : 'var(--green)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                opacity: isExecuting ? 0.7 : 1,
              }}
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
            >
              ✏
            </button>
          </>
        )}
        {plan.planStatus === 'pr_created' && (
          <span
            className="mono"
            style={{ color: 'var(--purple)', fontSize: 10, fontWeight: 700 }}
          >
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
        )}
        {plan.ospPrs.length > 0 && (
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
        )}
        {(plan.planStatus === 'jc_created' ||
          plan.planStatus === 'in_production' ||
          plan.planStatus === 'complete') && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10, color: 'var(--cyan)' }}
            onClick={onViewJc}
          >
            <Activity size={11} /> {plan.jcCode ?? 'View JC'}
          </button>
        )}
      </div>
    </div>
  );
}
