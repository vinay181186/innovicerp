// Edit Plan modal (PL-4b §5). Large modal with 3-tab type picker, ops table
// (process/QC/OSP), Full Outsource section, Direct Purchase section, and
// Required QC Documents section. Mirrors legacy editPlan (HTML L9500).
//
// Save vs. Save & Finalize:
//   Save        → updatePlan() only, status stays in_planning
//   Save & Finalize → updatePlan() + finalizePlan(), status → planned
// Once status is jc_created / pr_created / etc., the parent doesn't open
// this modal (uses view-only navigation instead).

import type {
  PlanDetail,
  PlanOpInput,
  PlanRequiredDoc,
  PlanType,
  UpdatePlanInput,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useCostCentersList } from '@/modules/cost-centers/api';
import { useMachinesList } from '@/modules/machines/api';
import { useFinalizePlan, useUpdatePlan, useDefaultRouteOps } from '@/modules/plans/api';
import { useQcProcessesList } from '@/modules/qc-processes/api';
import { useVendorsList } from '@/modules/vendors/api';
import { Modal } from './modal';

interface Props {
  plan: PlanDetail;
  onClose: () => void;
  /** Called after successful Save (with or without Finalize). */
  onSaved: () => void;
}

type OpRow = PlanOpInput & { uid: string };

const DOC_PRESETS_FALLBACK = [
  'Dimensional Inspection Report',
  'First Article Inspection (FAI)',
  'Material Test Certificate (MTC)',
  'Surface Finish Report',
  'Visual Inspection Report',
];

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function planOpToRow(op: { opSeq: number; operation: string; opType: string; machineCodeText: string | null; cycleTimeMin: string; outsourceVendorText: string | null; outsourceCost: string; outsourceLeadDays: number | null; qcRequired: boolean }): OpRow {
  return {
    uid: uid(),
    opSeq: op.opSeq,
    operation: op.operation,
    opType: (op.opType ?? 'process') as PlanOpInput['opType'],
    machineCodeText: op.machineCodeText ?? '',
    cycleTimeMin: Number(op.cycleTimeMin),
    qcRequired: op.qcRequired,
    outsourceVendorText: op.outsourceVendorText ?? '',
    outsourceCost: Number(op.outsourceCost),
    outsourceLeadDays: op.outsourceLeadDays,
  };
}

export function EditPlanModal({ plan, onClose, onSaved }: Props): JSX.Element {
  const [planQty, setPlanQty] = useState<number>(plan.planQty);
  const [planType, setPlanType] = useState<PlanType>(plan.planType);
  const [plannedStartDate, setPlannedStartDate] = useState<string>(plan.plannedStartDate ?? '');
  const [plannedEndDate, setPlannedEndDate] = useState<string>(plan.plannedEndDate ?? '');
  const [remarks, setRemarks] = useState<string>(plan.remarks ?? '');

  // Manufacture / ops
  const [ops, setOps] = useState<OpRow[]>(() => plan.ops.map(planOpToRow));

  // Full Outsource
  const [foVendor, setFoVendor] = useState<string>(plan.foVendorCodeText ?? '');
  const [foRate, setFoRate] = useState<number>(plan.foRate ? Number(plan.foRate) : 0);
  const [foProcess, setFoProcess] = useState<string>(plan.foProcess ?? '');
  const [foMaterialSrc, setFoMaterialSrc] = useState<string>(plan.foMaterialSrc ?? 'From Stock');
  const [foDeliveryDate, setFoDeliveryDate] = useState<string>(plan.foDeliveryDate ?? '');
  const [foCostCenter, setFoCostCenter] = useState<string>(plan.foCostCenter ?? '');
  const [foRemarks, setFoRemarks] = useState<string>(plan.foRemarks ?? '');

  // Direct Purchase
  const [dpVendor, setDpVendor] = useState<string>(plan.dpVendorCodeText ?? '');
  const [dpCost, setDpCost] = useState<number>(plan.dpCost ? Number(plan.dpCost) : 0);
  const [dpRemarks, setDpRemarks] = useState<string>(plan.dpRemarks ?? '');

  // Required QC Docs
  const [requiredDocs, setRequiredDocs] = useState<PlanRequiredDoc[]>(() =>
    Array.isArray(plan.requiredDocs) ? plan.requiredDocs : [],
  );

  const [err, setErr] = useState<string | null>(null);

  const update = useUpdatePlan(plan.id);
  const finalize = useFinalizePlan();

  // Searchable master pickers (server-searched via ?search=; one shared search
  // term per master, like the SO line table). Machine ← Machine Master,
  // Vendor ← Vendor Master.
  const [machineSearch, setMachineSearch] = useState('');
  const machines = useMachinesList({
    ...(machineSearch.trim() ? { search: machineSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const [vendorSearch, setVendorSearch] = useState('');
  const vendors = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const machineOpts = useMemo(
    () => (machines.data?.machines ?? []).map((m) => ({ id: m.id, code: m.code, name: m.name })),
    [machines.data],
  );
  const vendorOpts = useMemo(
    () => (vendors.data?.vendors ?? []).map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [vendors.data],
  );
  const machineById = useMemo(() => new Map(machineOpts.map((o) => [o.id, o])), [machineOpts]);
  const vendorById = useMemo(() => new Map(vendorOpts.map((o) => [o.id, o])), [vendorOpts]);
  const machineIdByCode = (code: string): string | null =>
    machineOpts.find((m) => m.code === code)?.id ?? null;
  const vendorIdByCode = (code: string): string | null =>
    vendorOpts.find((v) => v.code === code)?.id ?? null;

  // Datalists
  const costCenters = useCostCentersList({ limit: 200, offset: 0 });
  const qcProcesses = useQcProcessesList({ limit: 200, offset: 0 });
  const docPresets = useMemo(() => DOC_PRESETS_FALLBACK, []);
  const defaultOpsQuery = useDefaultRouteOps(plan.itemId);

  // Recompute ops when defaultOpsQuery resolves on first load AND the plan
  // currently has zero ops (initial blank state from chained-from-create).
  useEffect(() => {
    const incoming = (defaultOpsQuery.data?.ops ?? []) as PlanOpInput[];
    if (ops.length === 0 && incoming.length > 0) {
      setOps(
        incoming.map((op) => ({
          uid: uid(),
          ...op,
          machineCodeText: op.machineCodeText ?? '',
          outsourceVendorText: op.outsourceVendorText ?? '',
          outsourceCost: op.outsourceCost ?? 0,
          cycleTimeMin: op.cycleTimeMin ?? 0,
          opType: op.opType ?? 'process',
          qcRequired: op.qcRequired ?? false,
          outsourceLeadDays: op.outsourceLeadDays ?? null,
          operation: op.operation,
          opSeq: op.opSeq,
        })),
      );
    }
  }, [defaultOpsQuery.data, ops.length]);

  const buildPayload = (): UpdatePlanInput => ({
    planType,
    planQty,
    plannedStartDate: plannedStartDate || null,
    plannedEndDate: plannedEndDate || null,
    remarks: remarks || null,
    dpVendorCodeText: planType === 'direct_purchase' ? dpVendor || null : null,
    dpCost: planType === 'direct_purchase' ? dpCost : null,
    dpRemarks: planType === 'direct_purchase' ? dpRemarks || null : null,
    foVendorCodeText: planType === 'full_outsource' ? foVendor || null : null,
    foProcess: planType === 'full_outsource' ? foProcess || null : null,
    foRate: planType === 'full_outsource' ? foRate : null,
    foMaterialSrc: planType === 'full_outsource' ? foMaterialSrc || null : null,
    foDeliveryDate: planType === 'full_outsource' ? foDeliveryDate || null : null,
    foCostCenter: planType === 'full_outsource' ? foCostCenter || null : null,
    foRemarks: planType === 'full_outsource' ? foRemarks || null : null,
    requiredDocs,
    ops:
      planType === 'manufacture' || planType === 'assembly'
        ? ops.map((o, i) => ({
            opSeq: i + 1,
            operation: o.operation,
            opType: o.opType,
            machineCodeText: o.machineCodeText || null,
            cycleTimeMin: o.cycleTimeMin,
            qcRequired: o.qcRequired,
            outsourceVendorText: o.outsourceVendorText || null,
            outsourceCost: o.outsourceCost,
            outsourceLeadDays: o.outsourceLeadDays,
          }))
        : [],
  });

  const validate = (): string | null => {
    if (planQty <= 0) return 'Plan Qty must be > 0';
    if (planType === 'manufacture' || planType === 'assembly') {
      if (ops.length === 0) return 'Add at least one operation';
      const missingName = ops.find((o) => !o.operation);
      if (missingName) return 'Every op needs an operation name';
      const inHouseNoMachine = ops.find(
        (o) => o.opType === 'process' && !o.machineCodeText,
      );
      if (inHouseNoMachine) return 'In-house ops need a machine';
      const outsourceNoVendor = ops.find(
        (o) => o.opType === 'outsource' && !o.outsourceVendorText,
      );
      if (outsourceNoVendor) return 'Outsource ops need a vendor';
    } else if (planType === 'full_outsource') {
      if (!foVendor) return 'Select a vendor for outsourcing';
      if (!foProcess) return 'Enter process description';
    } else if (planType === 'direct_purchase') {
      if (!dpVendor) return 'Select a vendor for direct purchase';
    }
    return null;
  };

  const onSave = async (finalizeAfter: boolean) => {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    try {
      await update.mutateAsync(buildPayload());
      if (finalizeAfter) await finalize.mutateAsync(plan.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const addOp = (kind: 'process' | 'outsource' | 'qc') => {
    setOps((prev) => [
      ...prev,
      {
        uid: uid(),
        opSeq: prev.length + 1,
        operation: '',
        opType: kind,
        machineCodeText: kind === 'qc' ? 'QC' : '',
        cycleTimeMin: 0,
        qcRequired: kind === 'qc',
        outsourceVendorText: '',
        outsourceCost: 0,
        outsourceLeadDays: kind === 'outsource' ? 5 : null,
      },
    ]);
  };

  const updateOp = (uidVal: string, patch: Partial<OpRow>) => {
    setOps((prev) => prev.map((o) => (o.uid === uidVal ? { ...o, ...patch } : o)));
  };

  const removeOp = (uidVal: string) => {
    setOps((prev) => prev.filter((o) => o.uid !== uidVal));
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => onSave(false)}
        disabled={update.isPending || finalize.isPending}
      >
        Save Draft
      </button>
      <button
        type="button"
        className="btn btn-success"
        onClick={() => onSave(true)}
        disabled={update.isPending || finalize.isPending}
      >
        {update.isPending || finalize.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            …
          </>
        ) : (
          'Save & Finalize'
        )}
      </button>
    </>
  );

  const typeBtn = (val: PlanType, icon: string, label: string, help: string, color: string) => (
    <label
      style={{
        flex: 1,
        cursor: 'pointer',
        padding: '10px 14px',
        borderRadius: 8,
        border: `2px solid ${planType === val ? color : 'var(--border)'}`,
        background: planType === val ? `${color}1A` : 'var(--bg)',
        textAlign: 'center',
      }}
      onClick={() => setPlanType(val)}
    >
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{help}</div>
    </label>
  );

  return (
    <Modal
      title={`✏ Plan: ${plan.code} — ${plan.itemCode ?? plan.itemNameText ?? ''}`}
      size="lg"
      onClose={onClose}
      footer={footer}
    >
      {/* Header summary */}
      <div
        style={{
          background: 'var(--bg3)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>PLAN</span>
            <br />
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {plan.code}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO/JW</span>
            <br />
            <b className="mono">
              {plan.soCodeText ?? '—'} L{plan.lineNo ?? '—'}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>ITEM</span>
            <br />
            <b style={{ color: 'var(--purple)' }}>{plan.itemCode ?? plan.itemCodeText ?? ''}</b>{' '}
            {plan.itemName ?? plan.itemNameText ?? ''}
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO QTY</span>
            <br />
            <b style={{ fontSize: 16 }}>{plan.orderQty}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 700 }}>
              PLAN QTY ★
            </span>
            <br />
            <input
              type="number"
              min={1}
              max={plan.orderQty}
              value={planQty}
              onChange={(e) => setPlanQty(Number(e.target.value))}
              style={{
                width: 80,
                fontSize: 16,
                fontWeight: 800,
                textAlign: 'center',
                border: '2px solid var(--cyan)',
                color: 'var(--cyan)',
                padding: 4,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      </div>

      {/* 3-tab type picker */}
      <div
        style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <label
          className="form-label"
          style={{ marginBottom: 8, fontWeight: 700, display: 'block' }}
        >
          Plan Type ★
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {typeBtn('manufacture', '🏭', 'Manufacture', 'Job Card + Operations', '#22d3ee')}
          {typeBtn('full_outsource', '📦', 'Full Outsource', 'Our material, vendor does all', '#7c3aed')}
          {typeBtn('direct_purchase', '🛒', 'Direct Purchase', 'Buy finished item (with material)', '#22c55e')}
        </div>
      </div>

      {/* Dates */}
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-grp">
          <label className="form-label">Planned Start / Required Date</label>
          <input
            type="date"
            className="innovic-input"
            value={plannedStartDate}
            onChange={(e) => setPlannedStartDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Planned End Date</label>
          <input
            type="date"
            className="innovic-input"
            value={plannedEndDate}
            onChange={(e) => setPlannedEndDate(e.target.value)}
          />
        </div>
      </div>

      {/* Manufacture section */}
      {(planType === 'manufacture' || planType === 'assembly') && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            // Not 'hidden': the Machine / Vendor SearchableSelect dropdowns are
            // absolutely positioned and must overflow the table without clipping.
            overflow: 'visible',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg4)',
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="form-label" style={{ marginBottom: 0 }}>
              Operations Routing
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{ops.length} ops</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addOp('process')}
              >
                <Plus size={12} /> Add Op
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(124,58,237,0.08)',
                  color: '#7c3aed',
                  border: '1px solid rgba(124,58,237,0.25)',
                  fontSize: 11,
                }}
                onClick={() => addOp('outsource')}
              >
                + Add OSP Op
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  color: 'var(--green)',
                  border: '1px solid rgba(34,197,94,0.25)',
                  fontSize: 11,
                }}
                onClick={() => addOp('qc')}
              >
                + Add QC Op
              </button>
            </div>
          </div>
          {ops.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>
              No operations. Click + Add Op.
            </div>
          ) : (
            <>
              <table className="ops-routing">
                <thead>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th style={{ width: '34%' }}>Machine</th>
                    <th style={{ width: '30%' }}>Operation</th>
                    <th style={{ width: 110 }}>Cycle(h)</th>
                    <th style={{ width: 190, color: 'var(--amber)' }}>Outsource</th>
                    <th style={{ width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op, i) => {
                    const isQC = op.opType === 'qc';
                    const isOS = op.opType === 'outsource';
                    if (isQC) {
                      return (
                        <tr
                          key={op.uid}
                          style={{
                            background: 'rgba(34,197,94,0.06)',
                            borderLeft: '3px solid var(--green)',
                          }}
                        >
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                            {i + 1}
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                background: 'rgba(34,197,94,0.12)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                color: 'var(--green)',
                              }}
                            >
                              🔬 QC
                            </span>
                          </td>
                          <td>
                            <select
                              className="innovic-select"
                              value={op.operation}
                              onChange={(e) => {
                                const name = e.target.value;
                                const proc = (qcProcesses.data?.items ?? []).find(
                                  (p) => p.code === name,
                                );
                                updateOp(op.uid, {
                                  operation: name,
                                  cycleTimeMin: proc?.defaultCycleTimeMin
                                    ? Number(proc.defaultCycleTimeMin)
                                    : op.cycleTimeMin,
                                });
                              }}
                            >
                              <option value="">— Select QC Process —</option>
                              {(qcProcesses.data?.items ?? []).map((p) => (
                                <option key={p.id} value={p.code}>
                                  {p.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="innovic-input"
                              type="number"
                              step="0.01"
                              value={op.cycleTimeMin}
                              onChange={(e) =>
                                updateOp(op.uid, { cycleTimeMin: Number(e.target.value) })
                              }
                              style={{ textAlign: 'center' }}
                            />
                          </td>
                          <td style={{ color: 'var(--text3)', fontSize: 10 }}>—</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm btn-icon"
                              onClick={() => removeOp(op.uid)}
                            >
                              <Trash2 size={11} />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    // Non-QC op row — process by default. Ticking the OUTSOURCE box
                    // in the Outsource cell flips it to an outsource op (vendor from
                    // Vendor Master + ₹/pc rate); unticking flips it back.
                    return (
                      <tr
                        key={op.uid}
                        style={{
                          background: isOS
                            ? 'rgba(139,92,246,0.06)'
                            : i % 2 === 0
                              ? 'var(--bg)'
                              : 'var(--bg3)',
                          ...(isOS ? { borderLeft: '3px solid #7c3aed' } : {}),
                        }}
                      >
                        <td
                          className="td-ctr mono fw-700"
                          style={isOS ? { color: '#7c3aed' } : undefined}
                        >
                          {i + 1}
                        </td>
                        <td>
                          {isOS ? (
                            <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>
                              — outsourced —
                            </span>
                          ) : (
                            <SearchableSelect
                              id={`plan-mach-${op.uid}`}
                              value={machineIdByCode(op.machineCodeText ?? '')}
                              onChange={(id) =>
                                updateOp(op.uid, {
                                  machineCodeText: id ? (machineById.get(id)?.code ?? '') : '',
                                })
                              }
                              onSearch={setMachineSearch}
                              loading={machines.isFetching}
                              options={machineOpts}
                              placeholder="🔍 Machine"
                              valueLabel={op.machineCodeText || undefined}
                              selectedLabel={(o) => o.code ?? o.name}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            className="innovic-input"
                            value={op.operation}
                            onChange={(e) => updateOp(op.uid, { operation: e.target.value })}
                            placeholder={isOS ? 'Coating, Painting…' : 'Operation name'}
                            style={isOS ? { color: '#7c3aed', fontWeight: 600 } : undefined}
                          />
                        </td>
                        <td>
                          <input
                            className="innovic-input"
                            type="number"
                            step="0.01"
                            value={op.cycleTimeMin}
                            onChange={(e) =>
                              updateOp(op.uid, { cycleTimeMin: Number(e.target.value) })
                            }
                            style={{ textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'var(--amber)',
                              cursor: 'pointer',
                              letterSpacing: '.04em',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isOS}
                              onChange={(e) =>
                                updateOp(
                                  op.uid,
                                  e.target.checked
                                    ? {
                                        opType: 'outsource',
                                        outsourceLeadDays: op.outsourceLeadDays ?? 5,
                                      }
                                    : { opType: 'process' },
                                )
                              }
                            />
                            OUTSOURCE
                          </label>
                          {isOS ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                marginTop: 6,
                              }}
                            >
                              <SearchableSelect
                                id={`plan-osp-vend-${op.uid}`}
                                value={vendorIdByCode(op.outsourceVendorText ?? '')}
                                onChange={(id) =>
                                  updateOp(op.uid, {
                                    outsourceVendorText: id ? (vendorById.get(id)?.code ?? '') : '',
                                  })
                                }
                                onSearch={setVendorSearch}
                                loading={vendors.isFetching}
                                options={vendorOpts}
                                placeholder="🔍 Vendor"
                                valueLabel={op.outsourceVendorText || undefined}
                                selectedLabel={(o) => o.code ?? o.name}
                              />
                              <input
                                className="innovic-input"
                                type="number"
                                min={0}
                                step="0.01"
                                value={op.outsourceCost}
                                onChange={(e) =>
                                  updateOp(op.uid, { outsourceCost: Number(e.target.value) })
                                }
                                placeholder="₹/pc"
                              />
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            onClick={() => removeOp(op.uid)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* Full Outsource section */}
      {planType === 'full_outsource' && (
        <div
          style={{
            border: '1px solid rgba(124,58,237,0.3)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: 'rgba(124,58,237,0.04)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--purple)',
              marginBottom: 10,
            }}
          >
            📦 Full Outsource Details
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
            ℹ Our material will be sent to vendor. Vendor does all machining/processes and
            returns finished parts.
          </div>
          <datalist id="dlFOCC">
            {(costCenters.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </datalist>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--purple)' }}>
                Vendor ★
              </label>
              <SearchableSelect
                id="plan-fo-vend"
                value={vendorIdByCode(foVendor)}
                onChange={(id) => setFoVendor(id ? (vendorById.get(id)?.code ?? '') : '')}
                onSearch={setVendorSearch}
                loading={vendors.isFetching}
                options={vendorOpts}
                placeholder="🔍 Search vendor…"
                valueLabel={foVendor || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Rate ₹/pc</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={foRate}
                onChange={(e) => setFoRate(Number(e.target.value))}
                placeholder="0.00"
                style={{ fontSize: 14, color: 'var(--green)', fontWeight: 700 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Process Description ★</label>
              <input
                value={foProcess}
                onChange={(e) => setFoProcess(e.target.value)}
                placeholder="e.g. Complete machining as per drawing, Heat Treatment + Grinding"
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Material Source</label>
              <select
                value={foMaterialSrc}
                onChange={(e) => setFoMaterialSrc(e.target.value)}
              >
                <option>From Stock</option>
                <option>Purchase New</option>
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Expected Delivery Date</label>
              <input
                type="date"
                value={foDeliveryDate}
                onChange={(e) => setFoDeliveryDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">🏢 Cost Center</label>
              <input
                list="dlFOCC"
                value={foCostCenter}
                onChange={(e) => setFoCostCenter(e.target.value)}
                placeholder="🔍 Cost center…"
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Outsource Remarks / Specifications</label>
              <input
                value={foRemarks}
                onChange={(e) => setFoRemarks(e.target.value)}
                placeholder="Hardness, finish, tolerance requirements…"
              />
            </div>
          </div>
        </div>
      )}

      {/* Direct Purchase section */}
      {planType === 'direct_purchase' && (
        <div
          style={{
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: 'rgba(34,197,94,0.04)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green)',
              marginBottom: 10,
            }}
          >
            🛒 Direct Purchase Details
          </div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>
                Vendor ★
              </label>
              <SearchableSelect
                id="plan-dp-vend"
                value={vendorIdByCode(dpVendor)}
                onChange={(id) => setDpVendor(id ? (vendorById.get(id)?.code ?? '') : '')}
                onSearch={setVendorSearch}
                loading={vendors.isFetching}
                options={vendorOpts}
                placeholder="🔍 Search vendor…"
                valueLabel={dpVendor || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Est. Cost / pc (₹)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dpCost}
                onChange={(e) => setDpCost(Number(e.target.value))}
                style={{ fontSize: 14 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Purchase Remarks</label>
              <input
                value={dpRemarks}
                onChange={(e) => setDpRemarks(e.target.value)}
                placeholder="Specifications, grade, size, any special requirements"
              />
            </div>
          </div>
        </div>
      )}

      {/* Remarks */}
      <div className="form-grp">
        <label className="form-label">Remarks / Notes</label>
        <input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Planning notes, special instructions"
        />
      </div>

      {/* Required QC Documents */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          marginTop: 14,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--bg4)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--red)',
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '0.06em',
            }}
          >
            📋 REQUIRED QC DOCUMENTS
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setRequiredDocs((prev) => [...prev, { name: '', mandatory: true }])
            }
          >
            + Add Document
          </button>
        </div>
        <div>
          {requiredDocs.length === 0 ? (
            <div className="empty-state" style={{ padding: 14, fontSize: 12 }}>
              — No document requirements. Click + Add Document.
            </div>
          ) : (
            <>
              <datalist id="dlDocPresets">
                {docPresets.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <th style={{ width: 30 }}>#</th>
                    <th>Document Name ★</th>
                    <th style={{ width: 140 }}>Requirement</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {requiredDocs.map((d, i) => (
                    <tr
                      key={i}
                      style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}
                    >
                      <td className="td-ctr mono fw-700">{i + 1}</td>
                      <td>
                        <input
                          list="dlDocPresets"
                          value={d.name}
                          onChange={(e) =>
                            setRequiredDocs((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, name: e.target.value } : row,
                              ),
                            )
                          }
                          placeholder="🔍 Type or select document…"
                          style={{ width: '100%', fontSize: 12 }}
                        />
                      </td>
                      <td>
                        <select
                          value={d.mandatory ? 'mandatory' : 'optional'}
                          onChange={(e) =>
                            setRequiredDocs((prev) =>
                              prev.map((row, idx) =>
                                idx === i
                                  ? { ...row, mandatory: e.target.value === 'mandatory' }
                                  : row,
                              ),
                            )
                          }
                          style={{ width: '100%', fontSize: 11 }}
                        >
                          <option value="mandatory">★ Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() =>
                            setRequiredDocs((prev) => prev.filter((_, idx) => idx !== i))
                          }
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div
          style={{
            padding: '6px 12px',
            fontSize: 10,
            color: 'var(--text3)',
            borderTop: '1px solid var(--border)',
          }}
        >
          📌 QC person must upload these documents during inspection. Mandatory docs will block
          QC completion.
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
