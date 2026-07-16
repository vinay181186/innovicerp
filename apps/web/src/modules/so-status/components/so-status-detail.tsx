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

// Line-status pill colour + label (legacy L4324-4325).
const LINE_STATUS_COLOR: Record<SoStatusLine['status'], string> = {
  complete: 'var(--green)',
  qc_pending: 'var(--amber)',
  no_jc: 'var(--text3)',
  in_progress: 'var(--cyan)',
};
const LINE_STATUS_LABEL: Record<SoStatusLine['status'], string> = {
  complete: 'Complete',
  qc_pending: 'QC Pending',
  no_jc: 'No JC',
  in_progress: 'In Progress',
};

// Tracker-chip palette. Legacy hard-codes dark-theme hex per chip (L4422-4427);
// per ISSUE-067 those map to the light-theme tokens here, with legacy's 0x08 /
// 0x30 alpha washes expressed as rgba of the token hex (var() can't be
// suffixed with an alpha — ISSUE-063).
type ChipTint = { color: string; bg: string; border: string };
const CHIP_TINT = {
  cyan: { color: 'var(--cyan)', bg: 'rgba(0,136,187,0.03)', border: 'rgba(0,136,187,0.19)' },
  purple: { color: 'var(--purple)', bg: 'rgba(124,58,237,0.03)', border: 'rgba(124,58,237,0.19)' },
  blue: { color: 'var(--blue)', bg: 'rgba(37,99,235,0.03)', border: 'rgba(37,99,235,0.19)' },
  green: { color: 'var(--green)', bg: 'rgba(22,163,74,0.03)', border: 'rgba(22,163,74,0.19)' },
  green2: { color: 'var(--green2)', bg: 'rgba(21,128,61,0.03)', border: 'rgba(21,128,61,0.19)' },
  amber: { color: 'var(--amber)', bg: 'rgba(196,122,0,0.03)', border: 'rgba(196,122,0,0.19)' },
} satisfies Record<string, ChipTint>;

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

      {/* SO header (legacy L4283-4310) — a bare bordered block, not a panel. */}
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--cyan)' }}>{header.code}</div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {TYPE_LABEL[header.type] ?? header.type} · {lines.length} line{lines.length === 1 ? '' : 's'}
            </div>
          </div>
          <HeaderFact label="CUSTOMER" value={header.customerName ?? '—'} sub={header.clientPoNo ? `PO: ${header.clientPoNo}` : undefined} bold />
          <HeaderFact label="SO DATE" value={header.soDate} />
          <HeaderFact label="DUE DATE" value={header.dueDate ?? '—'} color={dueOverdue ? 'var(--red)' : undefined} bold />
          {/* PROGRESS fact + header bar have no legacy counterpart — kept (ours is a superset). */}
          <HeaderFact label="PROGRESS" value={`${header.totalDoneQty}/${header.totalQty} · ${header.overallCompletionPct}%`} />
          {header.remarks ? (
            <div style={{ flex: 1 }}>
              <div className="text3" style={{ fontSize: 10 }}>REMARKS</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{header.remarks}</div>
            </div>
          ) : null}
          <div style={{ flexBasis: '100%' }}>
            <ProgBar pct={header.overallCompletionPct} />
          </div>
        </div>
        {header.type === 'equipment' && header.equipmentInfo ? (
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
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="panel"><div className="panel-body"><div className="empty-state">No lines on this SO yet.</div></div></div>
      ) : (
        lines.map((line) => (
          <LinePanel
            key={line.id}
            line={line}
            soId={header.id}
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
  // Legacy renders BOM STATUS as bold coloured text (L4300), not a badge.
  const bomStatusColor =
    bomStatus === 'BOM Pending' ? 'var(--amber)' : bomStatus === 'BOM Planned' ? 'var(--green)' : 'var(--cyan)';
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6, border: '1px solid var(--border)' }}>
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
        <div style={{ fontWeight: 700, color: bomStatusColor }}>{bomStatus ?? 'BOM Pending'}</div>
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
              <th>#</th><th>Item Code</th><th>Item Name</th><th>Qty/Set</th>
              <th style={{ color: 'var(--cyan)', fontWeight: 800 }}>Total Need</th><th>Type</th>
              <th style={{ color: 'var(--green)' }}>Stock</th>
              <th style={{ color: 'var(--red)' }}>Shortfall</th><th>Plan Status</th>
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
                  <td className="td-ctr mono fw-700">{c.qtyPerSet}</td>
                  <td className="td-ctr mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>{c.totalNeed}</td>
                  <td><span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>{typeLabel}</span></td>
                  <td className="td-ctr mono fw-700" style={{ color: c.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}>{c.stockQty}</td>
                  <td className="td-ctr mono fw-700" style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}>{c.shortfall}{c.shortfall <= 0 ? ' ✅' : ''}</td>
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
  soId,
  planningLine,
  onCreatePlan,
  onAssemblyBom,
}: {
  line: SoStatusLine;
  soId: string;
  planningLine: PlanningLine | undefined;
  onCreatePlan: () => void;
  onAssemblyBom: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const jcIssuedQty = line.chips.jcIssued.qty;
  const lineBalance = Math.max(0, line.orderQty - jcIssuedQty);
  // Plan-first flow: this line plans through "+ Plan" (no direct Job Card).
  //  - assembly BOM line → open BOM-planning modal
  //  - equipment-BOM line → planned via the header banner, not per line
  //  - plain line → "+ Plan N pcs" (create plan inline, or divert to Planning)
  const showAssemblyBom = planningLine?.hasAssemblyBom === true;
  const isEquipmentLine = planningLine?.hasEquipmentBom === true;
  // Use planning remaining once loaded (nets plans + direct JCs); fall back to
  // the SO balance so the button still shows before planning data arrives.
  const remainingToPlan = planningLine ? planningLine.remaining : lineBalance;
  const showPlan = !showAssemblyBom && !isEquipmentLine && remainingToPlan > 0;
  const onPlan = (): void => {
    // Inline Create-Plan modal when planning data is loaded; otherwise divert
    // to the SO/JW Planning screen for this SO.
    if (planningLine && planningLine.remaining > 0) onCreatePlan();
    else navigate({ to: '/planning', search: { soId } });
  };
  const statusColor = LINE_STATUS_COLOR[line.status];
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      {/* Line header (legacy L4438-4453) */}
      <div className="panel-hdr" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="text3 mono" style={{ fontSize: 11, fontWeight: 700 }}>LINE {line.lineNo}</span>
          {line.clientPoLineNo ? (
            <span style={{ fontSize: 10, color: 'var(--purple)', fontWeight: 700 }}>[CPO:{line.clientPoLineNo}]</span>
          ) : null}
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--purple)' }}>{line.itemCode ?? line.itemCodeText ?? ''}</span>
          <span style={{ fontSize: 13 }}>{line.partName ?? ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 10 }}>SO QTY</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{line.orderQty}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="text3" style={{ fontSize: 10 }}>PROGRESS</div>
            <div style={{ width: 90, height: 8, background: 'var(--bg5)', borderRadius: 4, margin: '4px auto 2px' }}>
              <div style={{ width: `${line.completionPct}%`, height: '100%', background: statusColor, borderRadius: 4 }} />
            </div>
            <div className="text3" style={{ fontSize: 10 }}>{line.completionPct}%</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, border: `1px solid ${statusColor}`, color: statusColor }}>
              {LINE_STATUS_LABEL[line.status]}
            </span>
          </div>
        </div>
      </div>

      {/* Status tracker strip (legacy L4420-4435) */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip label="JC Issued" icon="📋" tint={CHIP_TINT.cyan} qty={line.chips.jcIssued.qty} total={line.chips.jcIssued.total} />
          <Chip label="PO Raised" icon="🛒" tint={CHIP_TINT.purple} qty={line.chips.poRaised.qty} total={line.chips.poRaised.total} />
          <Chip label="GRN Recd" icon="📦" tint={CHIP_TINT.blue} qty={line.chips.grnReceived.qty} total={line.chips.grnReceived.total} />
          <Chip label="QC Accepted" icon="✅" tint={CHIP_TINT.green} qty={line.chips.qcAccepted.qty} total={line.chips.qcAccepted.total} />
          <Chip label="Produced" icon="⚙" tint={CHIP_TINT.green2} qty={line.chips.produced.qty} total={line.chips.produced.total} />
          <Chip label="Dispatched" icon="🚚" tint={CHIP_TINT.amber} qty={line.chips.dispatched.qty} total={line.chips.dispatched.total} />
        </div>
        <OutsourceAlertRows alert={line.outsourceAlert} />
      </div>

      {/* Linked Job Cards (legacy L4455-4458) */}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>JC No.</th><th>Item Code</th><th>JC Qty</th><th>Completed</th>
              <th style={{ color: 'var(--red)' }}>Remaining</th><th>Priority</th><th>Due Date</th>
              <th>JC Status</th><th>Operations</th><th></th>
            </tr>
          </thead>
          <tbody>
            {line.jobCards.length === 0 ? (
              <tr>
                <td colSpan={10} className="text3" style={{ padding: '10px 14px', fontSize: 12, fontStyle: 'italic' }}>
                  No Job Cards linked to this SO line.
                </td>
              </tr>
            ) : (
              line.jobCards.map((jc) => (
                <JcRow key={jc.id} jc={jc} pendingOpsForJc={line.outsourceAlert.pendingOps.filter((p) => p.jcId === jc.id)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Per-line action footer (legacy L4459-4462): ours plans instead of
          creating a Job Card directly — legacy's button also only redirects to
          Planning (_soStatusCreateJC L4565-4569). */}
      <div style={{ padding: '8px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
        {showPlan ? (
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(124,58,237,0.08)', color: 'var(--purple)', border: '1px solid rgba(124,58,237,0.25)', fontWeight: 700, fontSize: 11 }}
            onClick={onPlan}
            title="Create a plan for this line (planning → execute → Job Card)"
          >
            <Plus size={12} /> Plan {remainingToPlan} pcs
          </button>
        ) : !showAssemblyBom && !isEquipmentLine ? (
          <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>✓ Fully allocated</span>
        ) : null}
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
  );
}

function OutsourceAlertRows({ alert }: { alert: SoStatusOutsourceAlert }): React.JSX.Element | null {
  const hasAlert = alert.atVendorQty > 0 || alert.atVendorOpCount > 0 || alert.pendingPrCount > 0 || alert.prRaisedCount > 0;
  if (!hasAlert) return null;
  // Legacy L4429-4431. NOTE: legacy also renders three further alert rows here
  // — "⏳ QC Pending: N pcs", "⚠ GRN QC Rejected: N pcs" and "⚠ Production QC
  // Rejected: N pcs" (L4432-4434). GET /so-status returns no grnRejected /
  // line-level qcRejected figure, so they are not rendered rather than
  // recomputed in the browser (CLAUDE.md rule 1). Reported, not fixed.
  return (
    <>
      {alert.atVendorOpCount > 0 ? (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
          🏭 At Vendor: {alert.atVendorQty} pcs across {alert.atVendorOpCount} outsource op(s)
        </div>
      ) : null}
      {alert.pendingPrCount > 0 ? (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>
          📋 {alert.pendingPrCount} outsource op(s) awaiting Purchase Request
        </div>
      ) : null}
      {alert.prRaisedCount > 0 ? (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>
          🛒 {alert.prRaisedCount} PR(s) raised, awaiting PO creation
        </div>
      ) : null}
    </>
  );
}

function JcRow({ jc, pendingOpsForJc }: { jc: SoStatusJc; pendingOpsForJc: SoStatusPendingOsPrOp[] }): React.JSX.Element {
  const navigate = useNavigate();
  const jcColor = jc.status === 'complete' ? 'var(--green)' : jc.status === 'qc_pending' ? 'var(--amber)' : 'var(--cyan)';
  // Legacy shows "▶N running" beside the JC No (L4349) off db.runningOps; the
  // server flags each op with `running`, so this counts server-owned rows only.
  const runCount = jc.ops.filter((op) => op.running).length;
  const dueOverdue = !!jc.dueDate && jc.dueDate < todayStr() && jc.status !== 'complete';
  return (
    <tr>
      <td style={{ paddingLeft: 28, width: 130 }}>
        <Link to="/job-cards/$id" params={{ id: jc.id }} style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', textDecoration: 'underline dotted' }}>{jc.code}</Link>
        {runCount > 0 ? <span style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 4 }}>▶{runCount} running</span> : null}
      </td>
      <td style={{ fontSize: 12 }}>{jc.itemCode ?? '—'}</td>
      <td className="td-ctr" style={{ fontSize: 12 }}>{jc.orderQty}</td>
      <td className="td-ctr">
        <span style={{ fontSize: 13, fontWeight: 700, color: jcColor }}>{jc.doneQty}</span>
        <span style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 6, width: 80, height: 5, background: 'var(--bg5)', borderRadius: 3 }}>
          <span style={{ display: 'block', width: `${jc.completionPct}%`, height: '100%', background: jcColor, borderRadius: 3 }} />
        </span>
        <span className="text3" style={{ fontSize: 10, marginLeft: 4 }}>{jc.completionPct}%</span>
      </td>
      <td className="td-ctr" style={{ fontSize: 12, color: jc.remainingQty > 0 ? 'var(--red)' : 'var(--green)' }}>{jc.remainingQty}</td>
      <td><JcPriorityBadge priority={jc.priority} /></td>
      <td style={{ fontSize: 11, color: dueOverdue ? 'var(--red)' : 'var(--text3)' }}>{jc.dueDate ?? '—'}</td>
      <td><JcStatusBadge status={jc.status} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {jc.ops.map((op) => <OpChip key={op.id} op={op} />)}
        {jc.ops.length === 0 ? <span className="text3" style={{ fontSize: 11 }}>no ops</span> : null}
        {pendingOpsForJc.length > 0 ? (
          <div style={{ marginTop: 2 }}>
            {pendingOpsForJc.map((p) => (
              <button
                key={`${p.jcId}-${p.opSeq}`}
                type="button"
                className="btn btn-sm"
                style={{ background: 'rgba(255,176,32,0.1)', color: 'var(--amber)', border: '1px solid rgba(255,176,32,0.3)', fontSize: 9, padding: '2px 8px', margin: 1 }}
                title={`Raise PR for Op ${p.opSeq} — ${p.operation}`}
                onClick={() => navigate({ to: '/purchase-requests', search: { jc: p.jcCode, op: p.opSeq } as never })}
              >
                📋 PR Op{p.opSeq}
              </button>
            ))}
          </div>
        ) : null}
      </td>
      <td>
        <Link to="/job-cards/$id" params={{ id: jc.id }} className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}>View</Link>
      </td>
    </tr>
  );
}

// Legacy badge(jc.priority) L4354 → badge() map L1964: High=b-amber, Normal=b-grey.
function JcPriorityBadge({ priority }: { priority: string }): React.JSX.Element {
  return (
    <span className={`badge ${priority === 'high' ? 'b-amber' : 'b-grey'}`} style={{ textTransform: 'capitalize' }}>{priority}</span>
  );
}

// Legacy op chip (L4335-4341): an inline outlined chip — not a .badge. The
// trailing ✓ marks QC-REQUIRED (op.qcReq), not completion. 🏭 marks outsource.
function OpChip({ op }: { op: SoStatusOp }): React.JSX.Element {
  const isOS = op.opType === 'outsource';
  const ic = opChipColor(op);
  const title =
    `Op ${op.opSeq} — ${op.operation} (${op.opType})` +
    (isOS ? ` [OUTSOURCE: ${op.outsourceStatus ?? 'pending'}]` : '') +
    `\ninput ${op.inputAvail} · completed ${op.completed}` +
    (op.qcRequired || op.opType === 'qc' ? ` · qc-acc ${op.qcAccepted}/${op.qcRejected}-rej/${op.qcPending}-pend` : '') +
    `\nstatus: ${op.status}`;
  return (
    <>
      <span
        className="mono"
        title={title}
        style={{
          fontSize: 9,
          padding: '1px 5px',
          borderRadius: 3,
          border: `1px solid ${ic}`,
          color: ic,
          ...(isOS ? { background: 'rgba(255,176,32,0.06)' } : {}),
        }}
      >
        {isOS ? '🏭' : ''}Op{op.opSeq}{op.qcRequired ? '✓' : ''}
      </span>{' '}
    </>
  );
}

// Mirrors legacy's `ic` ternary (L4337) over our richer op-status union.
function opChipColor(op: SoStatusOp): string {
  if (op.status === 'complete') return 'var(--green)';
  if (op.status === 'qc_pending' || op.status === 'in_progress' || op.status === 'running') return 'var(--amber)';
  if (op.opType === 'outsource') {
    if (op.outsourceStatus === 'sent' || op.outsourceStatus === 'po_created') return 'var(--purple)';
    if (op.outsourceStatus === 'pr_raised') return 'var(--blue)';
    return 'var(--amber)';
  }
  return 'var(--text3)';
}

function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  const color = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : pct > 0 ? 'var(--amber)' : 'var(--bg4)';
  return (
    <div className="prog-wrap">
      <div className="prog-bar" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
    </div>
  );
}

// Legacy _stChip (L4396-4406): icon + label on the left, val/total on the
// right, a colour-filled bar beneath. Unfilled (val=0) chips stay grey.
function Chip({ label, icon, tint, qty, total }: { label: string; icon: string; tint: ChipTint; qty: number; total: number }): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((qty / total) * 100)) : 0;
  const filled = qty > 0;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 100,
        padding: '8px 10px',
        background: filled ? tint.bg : 'var(--bg3)',
        border: `1px solid ${filled ? tint.border : 'var(--border)'}`,
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span className="text3" style={{ fontSize: 10, fontWeight: 600 }}>{icon} {label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: filled ? tint.color : 'var(--text3)' }}>
          {qty}<span className="text3" style={{ fontSize: 10, fontWeight: 400 }}> /{total}</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--bg5)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: 4, background: tint.color, borderRadius: 2 }} />
      </div>
    </div>
  );
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
