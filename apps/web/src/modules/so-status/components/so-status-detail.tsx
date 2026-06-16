// SO Status Review — reusable detail view (right pane of the two-pane screen
// AND the standalone /sales-orders/$id/status route). Mirror of legacy
// renderSOStatus right pane (L4276-4559): action bar, SO header (with remarks +
// type + due colour), Equipment-BOM banner, per-line panels (tracker chips +
// OSP alerts + JC table + Create JC / Create PO), Equipment-BOM items table.

import type {
  PlanningLine,
  SoStatusBomItem,
  SoStatusEquipmentInfo,
  SoStatusJc,
  SoStatusLine,
  SoStatusOp,
  SoStatusOpStatus,
  SoStatusOutsourceAlert,
  SoStatusPendingOsPrOp,
} from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { usePlan } from '@/modules/plans/api';
import { usePlanningSoDetail } from '@/modules/so-planning/api';
import { BomPlanningModal } from '@/modules/so-planning/components/bom-planning-modal';
import { CreatePlanModal } from '@/modules/so-planning/components/create-plan-modal';
import { EditPlanModal } from '@/modules/so-planning/components/edit-plan-modal';
import { useSoStatus } from '../api';
import { exportSoStatusExcel } from '../lib/export';

// Inline component-planning modal state — lets the planner create/plan
// components straight from SO Status Review instead of bouncing to /planning.
// Reuses the so-planning modals + plan write hooks verbatim.
type PlanModal =
  | { kind: 'none' }
  | { kind: 'create'; soLineId: string }
  | { kind: 'edit'; planId: string }
  | { kind: 'equip-bom'; soLineId: string }
  | { kind: 'assembly-bom'; soLineId: string };

const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component',
  equipment: 'Equipment',
  with_material: 'With Material',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SoStatusDetailView({ soId }: { soId: string }): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useSoStatus(soId);
  // Planning detail powers the inline plan actions (remaining qty, BOM flags).
  const planning = usePlanningSoDetail(soId);
  const [modal, setModal] = useState<PlanModal>({ kind: 'none' });
  // Mirrors the planning workflow: usePlan fires with '' when not editing
  // (harmless background 404) and EditPlanModal renders only once data arrives.
  const editingPlan = usePlan(modal.kind === 'edit' ? modal.planId : '');

  const refreshAll = (): void => {
    void refetch();
    void planning.refetch();
  };

  if (isLoading) {
    return (
      <div className="text3" style={{ fontSize: 12, padding: 16 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading SO status…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)', padding: 24 }}>
        {error instanceof Error ? error.message : 'Unable to load SO status'}
      </div>
    );
  }

  const { header, lines, bomItems } = data;
  const dueOverdue = !!header.dueDate && header.dueDate < todayStr() && header.status !== 'closed';

  // Join planning lines (remaining qty + BOM flags) to status lines by soLineId.
  const planningLines = new Map<string, PlanningLine>();
  for (const l of planning.data?.lines ?? []) planningLines.set(l.soLineId, l);
  // Equipment BOM hangs off the first SO line (service derives equipmentInfo
  // from it); used as the soLineId for the equipment BOM-planning modal.
  const equipmentSoLineId = lines[0]?.id ?? null;

  return (
    <div>
      {/* Action bar (legacy L4552-4556) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          SO Status — <span style={{ color: 'var(--cyan)' }}>{header.code}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)', fontSize: 11 }}
            onClick={() => exportSoStatusExcel(data)}
          >
            ⬇ Export Excel
          </button>
          <Link to="/sales-orders/$id" params={{ id: header.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
            ✎ Edit in SO Master
          </Link>
        </div>
      </div>

      {/* SO header (legacy L4283-4310) */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--cyan)' }}>{header.code}</div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {TYPE_LABEL[header.type] ?? header.type} · {lines.length} line{lines.length === 1 ? '' : 's'}
            </div>
          </div>
          <HeaderFact label="CUSTOMER" value={header.customerName ?? '—'} sub={header.clientPoNo ? `PO: ${header.clientPoNo}` : undefined} bold />
          <HeaderFact label="SO DATE" value={header.soDate} />
          <HeaderFact label="DUE DATE" value={header.dueDate ?? '—'} color={dueOverdue ? 'var(--red)' : undefined} bold />
          <HeaderFact label="PROGRESS" value={`${header.totalDoneQty}/${header.totalQty} · ${header.overallCompletionPct}%`} />
          {header.remarks ? (
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="text3" style={{ fontSize: 10 }}>REMARKS</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{header.remarks}</div>
            </div>
          ) : null}
          <div style={{ flexBasis: '100%' }}>
            <ProgBar pct={header.overallCompletionPct} />
          </div>
          {header.type === 'equipment' && header.equipmentInfo ? (
            <div style={{ flexBasis: '100%' }}>
              <EquipmentBomBanner
                soId={header.id}
                info={header.equipmentInfo}
                bomStatus={header.bomStatus}
                bomLinked={!!header.bomMasterId}
                onPlanBom={
                  equipmentSoLineId
                    ? () => setModal({ kind: 'equip-bom', soLineId: equipmentSoLineId })
                    : null
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="panel"><div className="panel-body"><div className="empty-state">No lines on this SO yet.</div></div></div>
      ) : (
        lines.map((line) => (
          <LinePanel
            key={line.id}
            line={line}
            planningLine={planningLines.get(line.id)}
            onCreatePlan={() => setModal({ kind: 'create', soLineId: line.id })}
            onAssemblyBom={() => setModal({ kind: 'assembly-bom', soLineId: line.id })}
          />
        ))
      )}

      {bomItems.length > 0 ? (
        <BomItemsTable bomNo={header.equipmentInfo?.bomNo ?? ''} equipmentQty={header.equipmentInfo?.equipmentQty ?? 0} items={bomItems} />
      ) : null}

      {/* ── Inline component-planning modals (reused from so-planning) ── */}
      {modal.kind === 'create' && planning.data
        ? (() => {
            const line = planningLines.get(modal.soLineId);
            if (!line) return null;
            return (
              <CreatePlanModal
                so={planning.data}
                line={line}
                onClose={() => setModal({ kind: 'none' })}
                onCreated={(planId) => {
                  setModal({ kind: 'edit', planId });
                  refreshAll();
                }}
              />
            );
          })()
        : null}

      {modal.kind === 'edit' && editingPlan.data ? (
        <EditPlanModal
          plan={editingPlan.data}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refreshAll();
            void editingPlan.refetch();
          }}
        />
      ) : null}

      {modal.kind === 'equip-bom' ? (
        <BomPlanningModal
          mode="equipment"
          soId={header.id}
          soCode={header.code}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refreshAll();
          }}
        />
      ) : null}

      {modal.kind === 'assembly-bom' ? (
        <BomPlanningModal
          mode="assembly"
          soId={header.id}
          soCode={header.code}
          soLineId={modal.soLineId}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => {
            setModal({ kind: 'none' });
            refreshAll();
          }}
        />
      ) : null}
    </div>
  );
}

function HeaderFact({ label, value, sub, color, bold }: { label: string; value: string; sub?: string | undefined; color?: string | undefined; bold?: boolean | undefined }): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: bold ? 700 : 400, color }}>{value}</div>
      {sub ? <div className="text3" style={{ fontSize: 11 }}>{sub}</div> : null}
    </div>
  );
}

function EquipmentBomBanner({
  soId,
  info,
  bomStatus,
  bomLinked,
  onPlanBom,
}: {
  soId: string;
  info: SoStatusEquipmentInfo;
  bomStatus: string | null;
  bomLinked: boolean;
  // When set, "Plan BOM Items" opens the BOM-planning modal in place; null
  // falls back to navigating to the Planning screen (e.g. planning not loaded).
  onPlanBom: (() => void) | null;
}): React.JSX.Element {
  const bomStatusCls = bomStatus === 'BOM Pending' ? 'b-amber' : bomStatus === 'BOM Planned' ? 'b-green' : 'b-cyan';
  return (
    <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div>
        <div className="text3" style={{ fontSize: 10 }}>EQUIPMENT</div>
        <div style={{ fontWeight: 700, color: 'var(--purple)' }}>{info.equipmentItemCode ?? '—'} {info.equipmentItemName ?? ''}</div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 10 }}>EQUIP QTY</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{info.equipmentQty}</div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 10 }}>BOM STATUS</div>
        <span className={`badge ${bomStatusCls}`}>{bomStatus ?? 'BOM Pending'}</span>
      </div>
      {bomLinked && info.bomNo ? (
        <>
          <div>
            <div className="text3" style={{ fontSize: 10 }}>LINKED BOM</div>
            <div style={{ fontWeight: 700, color: 'var(--green)' }}>{info.bomNo} Rev {info.bomRev ?? '—'}</div>
            <div className="text3" style={{ fontSize: 11 }}>{info.bomName} ({info.bomPartsCount} items)</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {onPlanBom ? (
              <button
                type="button"
                onClick={onPlanBom}
                className="btn btn-sm"
                style={{ background: 'rgba(34,211,238,0.08)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', fontWeight: 700, fontSize: 11 }}
              >
                📦 Plan BOM Items
              </button>
            ) : (
              <Link to="/planning" search={{ soId }} className="btn btn-sm" style={{ background: 'rgba(34,211,238,0.08)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', fontWeight: 700, fontSize: 11 }}>
                📦 Plan BOM Items
              </Link>
            )}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, color: 'var(--amber)', fontSize: 12, fontWeight: 600, alignSelf: 'center' }}>
          ⚠ No BOM linked — assign a BOM in SO Master to plan items.
        </div>
      )}
    </div>
  );
}

function BomItemsTable({ bomNo, equipmentQty, items }: { bomNo: string; equipmentQty: number; items: SoStatusBomItem[] }): React.JSX.Element {
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cyan)' }}>📦 BOM Items — {bomNo} × {equipmentQty} sets</span>
        <span className="text3" style={{ fontSize: 11 }}>(Equipment Qty × Qty per Set = Total Need)</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th><th>Item Code</th><th>Item Name</th><th className="td-right">Qty/Set</th>
              <th className="td-right" style={{ color: 'var(--cyan)' }}>Total Need</th><th>Type</th>
              <th className="td-right" style={{ color: 'var(--green)' }}>Stock</th>
              <th className="td-right" style={{ color: 'var(--red)' }}>Shortfall</th><th>Plan Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, idx) => {
              const typeLabel = c.bomType === 'manufacture' ? '🏭 Mfg' : c.bomType === 'purchase' ? '🛒 Buy' : '🏭 Outsrc';
              const typeColor = c.bomType === 'manufacture' ? 'var(--cyan)' : c.bomType === 'purchase' ? 'var(--green)' : 'var(--amber)';
              const rowBg = c.shortfall > 0 ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)';
              return (
                <tr key={c.childItemId} style={{ background: rowBg }}>
                  <td className="td-ctr mono fw-700">{idx + 1}</td>
                  <td className="td-code" style={{ color: 'var(--purple)' }}>{c.childItemCode}</td>
                  <td>{c.childItemName}</td>
                  <td className="td-right mono">{c.qtyPerSet}</td>
                  <td className="td-right mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>{c.totalNeed}</td>
                  <td><span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>{typeLabel}</span></td>
                  <td className="td-right mono fw-700" style={{ color: c.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}>{c.stockQty}</td>
                  <td className="td-right mono fw-700" style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}>{c.shortfall}{c.shortfall <= 0 ? ' ✅' : ''}</td>
                  <td>
                    {c.planStatus ? (
                      <>
                        <span style={{ fontWeight: 700, color: c.planStatus === 'in_planning' ? 'var(--amber)' : c.planStatus === 'jc_created' ? 'var(--cyan)' : 'var(--green)' }}>{c.planStatus}</span>
                        {c.jcCode ? <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)', marginLeft: 6 }}>{c.jcCode}</span> : null}
                      </>
                    ) : (
                      <span className="text3">Not planned</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinePanel({
  line,
  planningLine,
  onCreatePlan,
  onAssemblyBom,
}: {
  line: SoStatusLine;
  planningLine: PlanningLine | undefined;
  onCreatePlan: () => void;
  onAssemblyBom: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const jcIssuedQty = line.chips.jcIssued.qty;
  const lineBalance = Math.max(0, line.orderQty - jcIssuedQty);
  // Plan actions mirror the Planning screen's per-line buttons:
  //  - assembly BOM line → open BOM-planning modal
  //  - plain line with planning remaining → "+ Plan N pcs" (create plan)
  // Equipment-BOM lines are planned via the header banner, not per line.
  const showAssemblyBom = planningLine?.hasAssemblyBom === true;
  const planRemaining = planningLine?.remaining ?? 0;
  const showCreatePlan =
    !!planningLine && !planningLine.hasEquipmentBom && !showAssemblyBom && planRemaining > 0;
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <div className="td-code" style={{ color: 'var(--purple)', fontSize: 14, fontWeight: 700 }}>
            #{line.lineNo} · {line.itemCode ?? line.itemCodeText ?? '—'}
          </div>
          <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
            {line.partName ?? '—'}
            {line.clientPoLineNo ? ` · client PO L#${line.clientPoLineNo}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LineStatusBadge status={line.status} />
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)', minWidth: 110, textAlign: 'right' }}>
            {line.doneQty}/{line.orderQty} · <b style={{ color: 'var(--text)' }}>{line.completionPct}%</b>
          </span>
        </div>
      </div>
      <div className="panel-body">
        <ProgBar pct={line.completionPct} />
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <Chip label="JC Issued" qty={line.chips.jcIssued.qty} total={line.chips.jcIssued.total} />
          <Chip label="PO Raised" qty={line.chips.poRaised.qty} total={line.chips.poRaised.total} />
          <Chip label="GRN Recd" qty={line.chips.grnReceived.qty} total={line.chips.grnReceived.total} />
          <Chip label="QC Accepted" qty={line.chips.qcAccepted.qty} total={line.chips.qcAccepted.total} />
          <Chip label="Produced" qty={line.chips.produced.qty} total={line.chips.produced.total} />
          <Chip label="Dispatched" qty={line.chips.dispatched.qty} total={line.chips.dispatched.total} />
        </div>

        <OutsourceAlertRows alert={line.outsourceAlert} />

        <div style={{ marginTop: 16 }}>
          <div className="section-hdr" style={{ marginBottom: 6 }}>Linked Job Cards ({line.jobCards.length})</div>
          {line.jobCards.length === 0 ? (
            <div className="text3" style={{ fontSize: 12, padding: 8 }}>No Job Cards yet for this line.</div>
          ) : (
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>JC</th><th>Item</th><th className="td-right">Qty</th><th>Progress</th>
                    <th className="td-right">Remaining</th><th>Priority</th><th>Due</th><th>Status</th><th>Ops</th>
                  </tr>
                </thead>
                <tbody>
                  {line.jobCards.map((jc) => (
                    <JcRow key={jc.id} jc={jc} pendingOpsForJc={line.outsourceAlert.pendingOps.filter((p) => p.jcId === jc.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Per-line action footer: Plan + Create Job Card + Create PO (legacy L4459-4462) */}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {showAssemblyBom ? (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'rgba(34,211,238,0.08)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', fontWeight: 700, fontSize: 11 }}
              onClick={onAssemblyBom}
            >
              📦 BOM Planning ({planningLine?.bomPartsCount ?? 0} parts)
            </button>
          ) : null}
          {showCreatePlan ? (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'rgba(124,58,237,0.08)', color: 'var(--purple)', border: '1px solid rgba(124,58,237,0.25)', fontWeight: 700, fontSize: 11 }}
              onClick={onCreatePlan}
            >
              <Plus size={12} /> Plan {planRemaining} pcs
            </button>
          ) : null}
          {lineBalance > 0 ? (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'rgba(34,211,238,0.1)', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', fontWeight: 700, fontSize: 11 }}
              onClick={() => navigate({ to: '/job-cards/new', search: { sourceLineId: line.id } })}
            >
              <Plus size={12} /> Create Job Card ({lineBalance} pcs balance)
            </button>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>✓ Fully allocated</span>
          )}
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(124,58,237,0.08)', color: 'var(--purple)', border: '1px solid rgba(124,58,237,0.25)', fontWeight: 700, fontSize: 11 }}
            onClick={() => navigate({ to: '/purchase-orders/new', search: { soLineId: line.id } as never })}
          >
            🛒 Create PO
          </button>
        </div>
      </div>
    </div>
  );
}

function OutsourceAlertRows({ alert }: { alert: SoStatusOutsourceAlert }): React.JSX.Element | null {
  const hasAlert = alert.atVendorQty > 0 || alert.atVendorOpCount > 0 || alert.pendingPrCount > 0 || alert.prRaisedCount > 0;
  if (!hasAlert) return null;
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {alert.atVendorOpCount > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
          🏭 At Vendor: {alert.atVendorQty} pcs across {alert.atVendorOpCount} outsource op{alert.atVendorOpCount === 1 ? '' : 's'}
        </div>
      ) : null}
      {alert.pendingPrCount > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>
          📋 {alert.pendingPrCount} outsource op{alert.pendingPrCount === 1 ? '' : 's'} awaiting Purchase Request
        </div>
      ) : null}
      {alert.prRaisedCount > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>
          🛒 {alert.prRaisedCount} PR{alert.prRaisedCount === 1 ? '' : 's'} raised, awaiting PO creation
        </div>
      ) : null}
    </div>
  );
}

function JcRow({ jc, pendingOpsForJc }: { jc: SoStatusJc; pendingOpsForJc: SoStatusPendingOsPrOp[] }): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <tr>
      <td>
        <Link to="/op-entry" search={{ jc: jc.code }} className="td-code" style={{ color: 'var(--cyan)' }}>{jc.code}</Link>
      </td>
      <td><span className="text3" style={{ fontSize: 12 }}>{jc.itemCode ?? '—'}</span></td>
      <td className="td-right">{jc.orderQty}</td>
      <td style={{ minWidth: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>
          <span>{jc.doneQty}</span>
          <ProgBar pct={jc.completionPct} small />
          <span style={{ color: 'var(--text3)' }}>{jc.completionPct}%</span>
        </div>
      </td>
      <td className="td-right" style={{ color: jc.remainingQty > 0 ? 'var(--red2)' : 'var(--text3)' }}>{jc.remainingQty}</td>
      <td><span className="text3" style={{ fontSize: 12, textTransform: 'capitalize' }}>{jc.priority}</span></td>
      <td><span className="text3" style={{ fontSize: 12 }}>{jc.dueDate ?? '—'}</span></td>
      <td><JcStatusBadge status={jc.status} /></td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {jc.ops.map((op) => <OpChip key={op.id} op={op} />)}
          {jc.ops.length === 0 ? <span className="text3" style={{ fontSize: 11 }}>no ops</span> : null}
        </div>
        {pendingOpsForJc.length > 0 ? (
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pendingOpsForJc.map((p) => (
              <button
                key={`${p.jcId}-${p.opSeq}`}
                type="button"
                className="btn btn-sm"
                style={{ background: 'rgba(255,176,32,0.1)', color: 'var(--amber)', border: '1px solid rgba(255,176,32,0.3)', fontSize: 9, padding: '2px 8px' }}
                title={`Raise PR for Op ${p.opSeq} — ${p.operation}`}
                onClick={() => navigate({ to: '/purchase-requests', search: { jc: p.jcCode, op: p.opSeq } as never })}
              >
                📋 PR Op{p.opSeq}
              </button>
            ))}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function OpChip({ op }: { op: SoStatusOp }): React.JSX.Element {
  const cls = opStatusBadgeClass(op.status);
  const icon = op.opType === 'outsource' ? '🏭' : op.opType === 'qc' || op.qcRequired ? '🔧' : null;
  const title =
    `Op ${op.opSeq} — ${op.operation} (${op.opType})\n` +
    `input ${op.inputAvail} · completed ${op.completed}` +
    (op.qcRequired || op.opType === 'qc' ? ` · qc-acc ${op.qcAccepted}/${op.qcRejected}-rej/${op.qcPending}-pend` : '') +
    `\nstatus: ${op.status}`;
  return (
    <span className={`badge ${cls}`} style={{ padding: '1px 5px', fontSize: 10, textTransform: 'none' }} title={title}>
      {icon ? `${icon} ` : ''}Op{op.opSeq}{op.status === 'complete' ? ' ✓' : ''}
    </span>
  );
}

function ProgBar({ pct, small = false }: { pct: number; small?: boolean }): React.JSX.Element {
  const color = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : pct > 0 ? 'var(--amber)' : 'var(--bg4)';
  return (
    <div className="prog-wrap" style={small ? { height: 4, width: 60 } : undefined}>
      <div className="prog-bar" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
    </div>
  );
}

function Chip({ label, qty, total }: { label: string; qty: number; total: number }): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((qty / total) * 100)) : 0;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg2)' }}>
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>
        {qty}<span className="text3" style={{ fontWeight: 400 }}> / {total}</span>
        <span className="text3" style={{ fontWeight: 400, float: 'right', fontSize: 11 }}>{pct}%</span>
      </div>
      <ProgBar pct={pct} small />
    </div>
  );
}

function LineStatusBadge({ status }: { status: 'no_jc' | 'complete' | 'qc_pending' | 'in_progress' }): React.JSX.Element {
  const map: Record<typeof status, { cls: string; label: string }> = {
    no_jc: { cls: 'b-grey', label: 'No JC' },
    complete: { cls: 'b-green', label: 'Complete' },
    qc_pending: { cls: 'b-amber', label: 'QC Pending' },
    in_progress: { cls: 'b-blue', label: 'In Progress' },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function JcStatusBadge({ status }: { status: 'complete' | 'qc_pending' | 'in_progress' | 'no_ops' }): React.JSX.Element {
  const map: Record<typeof status, { cls: string; label: string }> = {
    complete: { cls: 'b-green', label: 'Complete' },
    qc_pending: { cls: 'b-amber', label: 'QC Pending' },
    in_progress: { cls: 'b-blue', label: 'In Progress' },
    no_ops: { cls: 'b-grey', label: 'No Ops' },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function opStatusBadgeClass(status: SoStatusOpStatus): string {
  switch (status) {
    case 'complete':
      return 'b-green';
    case 'qc_pending':
      return 'b-amber';
    case 'running':
    case 'in_progress':
      return 'b-blue';
    case 'available':
      return 'b-cyan';
    case 'waiting':
      return 'b-grey';
    case 'outsource_pending':
    case 'outsource_pr_raised':
      return 'b-amber';
    case 'outsource_po_created':
    case 'outsource_at_vendor':
      return 'b-blue';
    case 'outsource_received':
      return 'b-green';
    default:
      return 'b-grey';
  }
}
