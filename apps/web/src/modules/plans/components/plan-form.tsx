// Shared plan form for new + edit. Mirrors legacy renderSOPlanning panels
// (HTML L9299) — type picker + type-specific sub-form + ops table for
// manufacture/assembly plans. Direct-purchase / full-outsource hide the
// ops table.

import type { CreatePlanInput, PlanType } from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDefaultRouteOps } from '../api';

export interface PlanFormValues {
  code: string;
  planDate: string;
  planType: PlanType;
  soLineId: string | null;
  soCodeText: string;
  lineNo: number | null;
  itemId: string | null;
  itemCodeText: string;
  itemNameText: string;
  orderQty: number;
  planQty: number;
  plannedStartDate: string;
  plannedEndDate: string;
  bomMasterId: string | null;
  bomParentCode: string;
  bomChildCode: string;
  dpVendorId: string | null;
  dpVendorCodeText: string;
  dpCost: number | null;
  dpRemarks: string;
  foVendorId: string | null;
  foVendorCodeText: string;
  foProcess: string;
  foRate: number | null;
  foMaterialSrc: string;
  foDeliveryDate: string;
  foCostCenter: string;
  foRemarks: string;
  remarks: string;
  ops: Array<{
    opSeq: number;
    operation: string;
    opType: 'process' | 'outsource' | 'qc';
    cycleTimeMin: number;
    qcRequired: boolean;
    machineCodeText: string;
    outsourceVendorText: string;
    outsourceCost: number;
    outsourceLeadDays: number | null;
  }>;
}

export const PLAN_TYPE_OPTIONS: Array<{ value: PlanType; label: string; icon: string; help: string }> = [
  { value: 'manufacture', label: 'Manufacture', icon: '🏭', help: 'In-house production with operations' },
  { value: 'direct_purchase', label: 'Direct Purchase', icon: '🛒', help: 'Buy from vendor — single PR generated' },
  { value: 'full_outsource', label: 'Full Outsource', icon: '📦', help: 'Outsource to job-work vendor (+ optional material PR)' },
  { value: 'assembly', label: 'Assembly', icon: '🔧', help: 'Assembly of equipment per BOM' },
];

export function emptyValues(): PlanFormValues {
  return {
    code: '',
    planDate: new Date().toISOString().slice(0, 10),
    planType: 'manufacture',
    soLineId: null,
    soCodeText: '',
    lineNo: null,
    itemId: null,
    itemCodeText: '',
    itemNameText: '',
    orderQty: 1,
    planQty: 1,
    plannedStartDate: '',
    plannedEndDate: '',
    bomMasterId: null,
    bomParentCode: '',
    bomChildCode: '',
    dpVendorId: null,
    dpVendorCodeText: '',
    dpCost: null,
    dpRemarks: '',
    foVendorId: null,
    foVendorCodeText: '',
    foProcess: '',
    foRate: null,
    foMaterialSrc: '',
    foDeliveryDate: '',
    foCostCenter: '',
    foRemarks: '',
    remarks: '',
    ops: [],
  };
}

export function toCreateInput(v: PlanFormValues): CreatePlanInput {
  return {
    code: v.code,
    planDate: v.planDate,
    planType: v.planType,
    soLineId: v.soLineId ?? null,
    soCodeText: v.soCodeText || null,
    lineNo: v.lineNo,
    itemId: v.itemId ?? null,
    itemCodeText: v.itemCodeText || null,
    itemNameText: v.itemNameText || null,
    orderQty: v.orderQty,
    planQty: v.planQty,
    plannedStartDate: v.plannedStartDate || null,
    plannedEndDate: v.plannedEndDate || null,
    bomMasterId: v.bomMasterId ?? null,
    bomParentCode: v.bomParentCode || null,
    bomChildCode: v.bomChildCode || null,
    dpVendorId: v.dpVendorId ?? null,
    dpVendorCodeText: v.dpVendorCodeText || null,
    dpCost: v.dpCost,
    dpRemarks: v.dpRemarks || null,
    foVendorId: v.foVendorId ?? null,
    foVendorCodeText: v.foVendorCodeText || null,
    foProcess: v.foProcess || null,
    foRate: v.foRate,
    foMaterialSrc: v.foMaterialSrc || null,
    foDeliveryDate: v.foDeliveryDate || null,
    foCostCenter: v.foCostCenter || null,
    foRemarks: v.foRemarks || null,
    remarks: v.remarks || null,
    ops:
      v.planType === 'manufacture' || v.planType === 'assembly'
        ? v.ops.map((op) => ({
            opSeq: op.opSeq,
            operation: op.operation,
            opType: op.opType,
            cycleTimeMin: op.cycleTimeMin,
            qcRequired: op.qcRequired,
            machineCodeText: op.machineCodeText || null,
            outsourceVendorText: op.outsourceVendorText || null,
            outsourceCost: op.outsourceCost,
            outsourceLeadDays: op.outsourceLeadDays,
          }))
        : [],
  };
}

interface PlanFormProps {
  initialValues: PlanFormValues;
  onSubmit: (values: PlanFormValues) => void;
  isSubmitting: boolean;
  submitLabel: string;
  submitError?: string | null;
  /** True for edit mode — code field becomes read-only. */
  isEdit?: boolean;
}

export function PlanForm({
  initialValues,
  onSubmit,
  isSubmitting,
  submitLabel,
  submitError,
  isEdit,
}: PlanFormProps): React.JSX.Element {
  const [values, setValues] = useState<PlanFormValues>(initialValues);

  // Reload default ops button is wired against itemId; query enabled only when item is set.
  const { data: defaultOps, isFetching: loadingOps } = useDefaultRouteOps(values.itemId);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const update = <K extends keyof PlanFormValues>(key: K, val: PlanFormValues[K]): void => {
    setValues((v) => ({ ...v, [key]: val }));
  };

  const handleLoadDefaultOps = (): void => {
    if (!defaultOps || defaultOps.ops.length === 0) return;
    setValues((v) => ({
      ...v,
      ops: defaultOps.ops.map((op) => ({
        opSeq: op.opSeq,
        operation: op.operation,
        opType: op.opType ?? 'process',
        cycleTimeMin: op.cycleTimeMin ?? 0,
        qcRequired: op.qcRequired ?? false,
        machineCodeText: op.machineCodeText ?? '',
        outsourceVendorText: op.outsourceVendorText ?? '',
        outsourceCost: op.outsourceCost ?? 0,
        outsourceLeadDays: op.outsourceLeadDays ?? null,
      })),
    }));
  };

  const addOp = (): void => {
    setValues((v) => ({
      ...v,
      ops: [
        ...v.ops,
        {
          opSeq: (v.ops[v.ops.length - 1]?.opSeq ?? 0) + 1,
          operation: '',
          opType: 'process',
          cycleTimeMin: 0,
          qcRequired: false,
          machineCodeText: '',
          outsourceVendorText: '',
          outsourceCost: 0,
          outsourceLeadDays: null,
        },
      ],
    }));
  };

  const removeOp = (idx: number): void => {
    setValues((v) => ({ ...v, ops: v.ops.filter((_, i) => i !== idx) }));
  };

  const showOps = values.planType === 'manufacture' || values.planType === 'assembly';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {submitError ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          {submitError}
        </div>
      ) : null}

      {/* Header block */}
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Plan header</div>
        </div>
        <div
          className="panel-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="Plan code *">
            <input
              className="innovic-input"
              required
              readOnly={isEdit}
              value={values.code}
              onChange={(e) => update('code', e.target.value)}
            />
          </Field>
          <Field label="Plan date *">
            <input
              type="date"
              className="innovic-input"
              required
              value={values.planDate}
              onChange={(e) => update('planDate', e.target.value)}
            />
          </Field>
          <Field label="Plan type *">
            <select
              className="innovic-select"
              value={values.planType}
              onChange={(e) => update('planType', e.target.value as PlanType)}
              disabled={isEdit}
              title={isEdit ? 'Type cannot be changed after create' : undefined}
            >
              {PLAN_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.icon} {opt.label}
                </option>
              ))}
            </select>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              {PLAN_TYPE_OPTIONS.find((o) => o.value === values.planType)?.help}
            </div>
          </Field>
        </div>
      </div>

      {/* Item + SO link */}
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Item &amp; source</div>
        </div>
        <div
          className="panel-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="Item code *">
            <input
              className="innovic-input"
              required
              value={values.itemCodeText}
              onChange={(e) => update('itemCodeText', e.target.value)}
            />
          </Field>
          <Field label="Item name">
            <input
              className="innovic-input"
              value={values.itemNameText}
              onChange={(e) => update('itemNameText', e.target.value)}
            />
          </Field>
          <Field label="Item id (UUID, optional)">
            <input
              className="innovic-input"
              placeholder="optional — auto-resolves item code if blank"
              value={values.itemId ?? ''}
              onChange={(e) => update('itemId', e.target.value || null)}
            />
          </Field>
          <Field label="Order qty *">
            <input
              type="number"
              min={1}
              className="innovic-input"
              required
              value={values.orderQty}
              onChange={(e) => update('orderQty', Number(e.target.value))}
            />
          </Field>
          <Field label="Plan qty *">
            <input
              type="number"
              min={1}
              className="innovic-input"
              required
              value={values.planQty}
              onChange={(e) => update('planQty', Number(e.target.value))}
            />
          </Field>
          <Field label="SO line id (UUID, optional)">
            <input
              className="innovic-input"
              placeholder="optional — link to a sales order line"
              value={values.soLineId ?? ''}
              onChange={(e) => update('soLineId', e.target.value || null)}
            />
          </Field>
          <Field label="SO code text">
            <input
              className="innovic-input"
              value={values.soCodeText}
              onChange={(e) => update('soCodeText', e.target.value)}
            />
          </Field>
          <Field label="Line #">
            <input
              type="number"
              className="innovic-input"
              value={values.lineNo ?? ''}
              onChange={(e) =>
                update('lineNo', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Planned start">
            <input
              type="date"
              className="innovic-input"
              value={values.plannedStartDate}
              onChange={(e) => update('plannedStartDate', e.target.value)}
            />
          </Field>
          <Field label="Planned end">
            <input
              type="date"
              className="innovic-input"
              value={values.plannedEndDate}
              onChange={(e) => update('plannedEndDate', e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Type-specific block */}
      {values.planType === 'direct_purchase' ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">🛒 Direct purchase</div>
          </div>
          <div
            className="panel-body"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            <Field label="Vendor code *">
              <input
                className="innovic-input"
                required
                value={values.dpVendorCodeText}
                onChange={(e) => update('dpVendorCodeText', e.target.value)}
              />
            </Field>
            <Field label="Vendor id (optional)">
              <input
                className="innovic-input"
                value={values.dpVendorId ?? ''}
                onChange={(e) => update('dpVendorId', e.target.value || null)}
              />
            </Field>
            <Field label="Unit cost">
              <input
                type="number"
                step="0.01"
                className="innovic-input"
                value={values.dpCost ?? ''}
                onChange={(e) =>
                  update('dpCost', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Remarks" full>
              <textarea
                className="innovic-input"
                value={values.dpRemarks}
                onChange={(e) => update('dpRemarks', e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {values.planType === 'full_outsource' ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">📦 Full outsource</div>
          </div>
          <div
            className="panel-body"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            <Field label="JW Vendor code *">
              <input
                className="innovic-input"
                required
                value={values.foVendorCodeText}
                onChange={(e) => update('foVendorCodeText', e.target.value)}
              />
            </Field>
            <Field label="Process *">
              <input
                className="innovic-input"
                required
                placeholder="e.g. Heat treat, Plating"
                value={values.foProcess}
                onChange={(e) => update('foProcess', e.target.value)}
              />
            </Field>
            <Field label="Rate">
              <input
                type="number"
                step="0.01"
                className="innovic-input"
                value={values.foRate ?? ''}
                onChange={(e) =>
                  update('foRate', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Material source">
              <input
                className="innovic-input"
                placeholder="'inhouse' or supplier code"
                value={values.foMaterialSrc}
                onChange={(e) => update('foMaterialSrc', e.target.value)}
              />
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                Type 'inhouse' / 'self' to skip the material PR.
              </div>
            </Field>
            <Field label="Delivery date">
              <input
                type="date"
                className="innovic-input"
                value={values.foDeliveryDate}
                onChange={(e) => update('foDeliveryDate', e.target.value)}
              />
            </Field>
            <Field label="Cost centre">
              <input
                className="innovic-input"
                value={values.foCostCenter}
                onChange={(e) => update('foCostCenter', e.target.value)}
              />
            </Field>
            <Field label="Remarks" full>
              <textarea
                className="innovic-input"
                value={values.foRemarks}
                onChange={(e) => update('foRemarks', e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {/* Ops block (manufacture + assembly) */}
      {showOps ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Operations ({values.ops.length})</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {defaultOps && defaultOps.ops.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleLoadDefaultOps}
                  disabled={loadingOps}
                  title="Replaces ops with the item's active route card"
                >
                  {loadingOps ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : null}
                  Load route card ({defaultOps.ops.length})
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={addOp}>
                <Plus size={13} /> Add op
              </button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Operation</th>
                  <th>Type</th>
                  <th>Machine</th>
                  <th className="td-right">Cycle (hrs)</th>
                  <th className="td-ctr">QC?</th>
                  <th>OSP vendor</th>
                  <th className="td-right">OSP cost</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {values.ops.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty-state">
                      No operations. Add one or load from the item's route card.
                    </td>
                  </tr>
                ) : (
                  values.ops.map((op, idx) => (
                    <tr key={idx}>
                      <td>
                        <input
                          type="number"
                          min={1}
                          className="innovic-input"
                          style={{ width: 50 }}
                          value={op.opSeq}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, opSeq: Number(e.target.value) } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="innovic-input"
                          value={op.operation}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, operation: e.target.value } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="innovic-select"
                          value={op.opType}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx
                                  ? { ...o, opType: e.target.value as 'process' | 'outsource' | 'qc' }
                                  : o,
                              ),
                            }))
                          }
                        >
                          <option value="process">Process</option>
                          <option value="outsource">Outsource</option>
                          <option value="qc">QC</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className="innovic-input"
                          value={op.machineCodeText}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, machineCodeText: e.target.value } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td className="td-right">
                        <input
                          type="number"
                          step="0.1"
                          className="innovic-input"
                          style={{ width: 70 }}
                          value={op.cycleTimeMin}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, cycleTimeMin: Number(e.target.value) } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td className="td-ctr">
                        <input
                          type="checkbox"
                          checked={op.qcRequired}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, qcRequired: e.target.checked } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="innovic-input"
                          disabled={op.opType !== 'outsource'}
                          value={op.outsourceVendorText}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, outsourceVendorText: e.target.value } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td className="td-right">
                        <input
                          type="number"
                          step="0.01"
                          className="innovic-input"
                          style={{ width: 80 }}
                          disabled={op.opType !== 'outsource'}
                          value={op.outsourceCost}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              ops: v.ops.map((o, i) =>
                                i === idx ? { ...o, outsourceCost: Number(e.target.value) } : o,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeOp(idx)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Remarks */}
      <div className="panel">
        <div className="panel-body">
          <Field label="Plan remarks" full>
            <textarea
              className="innovic-input"
              rows={2}
              value={values.remarks}
              onChange={(e) => update('remarks', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}): React.JSX.Element {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label
        className="text3"
        style={{
          display: 'block',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
