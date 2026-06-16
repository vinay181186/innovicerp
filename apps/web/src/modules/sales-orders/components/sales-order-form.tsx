// Sales Order form — header + type-branching body. Mirror of legacy
// soHeaderForm (L12183): Equipment SOs show an Equipment Details section
// (Part No / Description / Qty / Due / SO Total Value / BOM picker) and no
// line table; Component / With-Material SOs show the line-items table with a
// per-line Amount, an SO Totals box, and an in-form Excel Template / Import.
// Header has an auto-suggested SO number + searchable client + item datalist.

import {
  type CreateSalesOrderInput,
  type SalesOrderDetail,
  SO_STATUSES,
  SO_TYPES,
  type SoStatus,
  type SoType,
  type UpdateSalesOrderInput,
  type Uom,
  UOMS,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useBomMastersList } from '@/modules/bom-master/api';
import { useClientsList } from '@/modules/clients/api';
import { useItemsList } from '@/modules/items/api';
import { useSalesOrdersList } from '../api';
import { downloadSoLineTemplate, parseSoLineFile } from '../lib/import-export';

interface LineFormValue {
  id?: string | undefined;
  itemId?: string | undefined;
  itemCodeText: string;
  partName: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
  uom: Uom;
  orderQty: number;
  rate: number;
  dueDate?: string | undefined;
  clientPoLineNo?: string | undefined;
  status?: SoStatus | undefined;
}

interface MilestoneFormValue {
  id?: string | undefined;
  lotNo: number;
  qty: number;
  dueDate?: string | undefined;
  remarks?: string | undefined;
}

interface FormValues {
  header: {
    code: string;
    soDate: string;
    type: SoType;
    status: SoStatus;
    gstPercent: number;
    clientId?: string;
    customerName?: string;
    clientPoNo?: string;
    bomMasterId?: string;
    bomStatus?: string;
    costCenter?: string;
    remarks?: string;
  };
  lines: LineFormValue[];
  milestones: MilestoneFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  soDate: new Date().toISOString().slice(0, 10),
  type: 'component_manufacturing',
  status: 'open',
  gstPercent: 18,
};
const NEW_LINE: LineFormValue = { itemCodeText: '', partName: '', uom: 'NOS', orderQty: 1, rate: 0 };
const NEW_MILESTONE: MilestoneFormValue = { lotNo: 1, qty: 0 };

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};
type EditMode = {
  mode: 'edit';
  detail: SalesOrderDetail;
  onSubmit: (values: UpdateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};
export type SalesOrderFormProps = CreateMode | EditMode;

export function SalesOrderForm(props: SalesOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }], milestones: [] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const {
    fields: msFields,
    append: appendMs,
    remove: removeMs,
  } = useFieldArray({ control, name: 'milestones' });

  const { data: clientsData } = useClientsList({ limit: 200, offset: 0 });
  const clients = clientsData?.clients ?? [];
  const { data: bomsData } = useBomMastersList({ status: 'active', limit: 200, offset: 0 });
  const boms = bomsData?.items ?? [];
  const { data: itemsData } = useItemsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];
  const { data: soListData } = useSalesOrdersList({ limit: 200, offset: 0 });

  const headerType = watch('header.type');
  const isEquip = headerType === 'equipment';
  const watchedLines = watch('lines');
  const gstPercent = Number(watch('header.gstPercent')) || 0;

  // Auto-suggest the next IN-SO-##### on a fresh create form.
  useEffect(() => {
    if (isEdit || getValues('header.code')) return;
    const codes = soListData?.items.map((i) => i.code) ?? [];
    let max = 0;
    for (const c of codes) {
      const m = c.match(/IN-SO-(\d+)\s*$/i);
      if (m) max = Math.max(max, Number(m[1]));
    }
    setValue('header.code', `IN-SO-${String(max + 1).padStart(5, '0')}`);
  }, [soListData, isEdit, getValues, setValue]);

  // In-form line import.
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseSoLineFile(file);
      for (const r of rows) append({ ...NEW_LINE, ...r });
      setImportMsg(`Added ${rows.length} line(s)${errs.length ? ` · ${errs.length} skipped` : ''}.`);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      if (lineFileRef.current) lineFileRef.current.value = '';
    }
  }

  const subtotal = (watchedLines ?? []).reduce((s, l) => s + (Number(l.orderQty) || 0) * (Number(l.rate) || 0), 0);
  const gstAmt = subtotal * (gstPercent / 100);
  const grand = subtotal + gstAmt;

  const onValid = async (values: FormValues): Promise<void> => {
    const equip = values.header.type === 'equipment';
    const headerOut = {
      ...values.header,
      // customerName is snapshotted server-side from the client master.
      customerName: undefined,
      clientId: values.header.clientId || undefined,
      clientPoNo: values.header.clientPoNo?.trim() || undefined,
      bomMasterId: equip ? values.header.bomMasterId?.trim() || undefined : undefined,
      bomStatus: equip ? (values.header.bomMasterId?.trim() ? 'BOM Assigned' : 'BOM Pending') : undefined,
      costCenter: values.header.costCenter?.trim() || undefined,
      remarks: values.header.remarks?.trim() || undefined,
    };

    // Equipment → a single line carrying the equipment; Component → all lines.
    const srcLines = equip ? values.lines.slice(0, 1) : values.lines;
    const linesOut = srcLines.map((l) => {
      const trimmedCode = l.itemCodeText.trim();
      const refs: { itemId?: string; itemCodeText?: string } = trimmedCode
        ? { itemCodeText: trimmedCode }
        : l.itemId
          ? { itemId: l.itemId }
          : {};
      return {
        ...(l.id ? { id: l.id } : {}),
        ...refs,
        partName: l.partName.trim(),
        material: l.material?.trim() || undefined,
        drawingNo: l.drawingNo?.trim() || undefined,
        uom: l.uom,
        orderQty: Number(l.orderQty),
        rate: Number(l.rate),
        dueDate: l.dueDate || undefined,
        clientPoLineNo: l.clientPoLineNo?.trim() || undefined,
        ...(l.status ? { status: l.status } : {}),
      };
    });

    // Delivery-schedule milestones (ISSUE-015) — component SOs only.
    const milestonesOut = equip
      ? []
      : (values.milestones ?? []).map((m) => ({
          ...(m.id ? { id: m.id } : {}),
          lotNo: Number(m.lotNo) || 1,
          qty: Number(m.qty) || 0,
          dueDate: m.dueDate || undefined,
          remarks: m.remarks?.trim() || undefined,
        }));

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut, milestones: milestonesOut });
    } else {
      await props.onSubmit({
        header: headerOut,
        lines: linesOut,
        milestones: milestonesOut,
      } as CreateSalesOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <datalist id="dlSoItems">
        {items.map((it) => (
          <option key={it.id} value={it.code}>{it.name}</option>
        ))}
      </datalist>

      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">SO/WO No.<span className="req">★</span></label>
          <input id="code" className="innovic-input" autoFocus={!isEdit} autoComplete="off" readOnly={isEdit} {...register('header.code', { required: 'SO/WO No. is required' })} />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.header?.code?.message ? <div className="form-error">{errors.header.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="soDate">Date<span className="req">★</span></label>
          <input id="soDate" type="date" className="innovic-input" {...register('header.soDate', { required: 'Date is required' })} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="type">Type<span className="req">★</span></label>
          <select id="type" className="innovic-select" {...register('header.type')}>
            {SO_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">Status</label>
          <select id="status" className="innovic-select" {...register('header.status')}>
            {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstPercent" style={{ color: 'var(--green)' }}>GST %</label>
          <select id="gstPercent" className="innovic-select" {...register('header.gstPercent', { valueAsNumber: true })}>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="costCenter">🏢 Cost Center</label>
          <input id="costCenter" className="innovic-input" autoComplete="off" placeholder="Cost center" {...register('header.costCenter')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="clientId">
            Client<span className="req">★</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              id="clientId"
              className="innovic-select"
              style={{ flex: 1 }}
              {...register('header.clientId', { required: 'Pick a client from the master' })}
            >
              <option value="">— Select a client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <Link to="/clients/new" className="btn btn-ghost btn-sm" title="Add a new client" style={{ whiteSpace: 'nowrap' }}>+ New</Link>
          </div>
          {errors.header?.clientId?.message ? (
            <div className="form-error">{errors.header.clientId.message}</div>
          ) : null}
          <div className="form-help">
            Sales Orders must reference a client from the master. Not listed? Use <b>+ New</b>.
          </div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="clientPoNo">Client PO No.</label>
          <input id="clientPoNo" className="innovic-input" autoComplete="off" {...register('header.clientPoNo')} />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">Remarks</label>
          <textarea id="remarks" className="innovic-textarea" rows={2} {...register('header.remarks')} />
        </div>
      </div>

      {isEquip ? (
        /* ── Equipment Details (legacy L12258) ── */
        <div>
          <div style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, margin: '4px 0 8px' }}>▸ EQUIPMENT DETAILS</div>
          <div className="form-grid form-grid-3">
            <div className="form-grp">
              <label className="form-label">Equipment / Part No.<span className="req">★</span></label>
              <input className="innovic-input" autoComplete="off" placeholder="Equipment ID" {...register('lines.0.itemCodeText', { required: isEquip ? 'Part No. is required' : false })} />
            </div>
            <div className="form-grp">
              <label className="form-label">Description<span className="req">★</span></label>
              <input className="innovic-input" autoComplete="off" placeholder="Equipment description" {...register('lines.0.partName', { required: isEquip ? 'Description is required' : false })} />
            </div>
            <div className="form-grp">
              <label className="form-label">Order Qty<span className="req">★</span></label>
              <input type="number" min={1} className="innovic-input" {...register('lines.0.orderQty', { valueAsNumber: true, min: { value: 1, message: 'Min 1' } })} />
            </div>
            <div className="form-grp">
              <label className="form-label">Due Date</label>
              <input type="date" className="innovic-input" {...register('lines.0.dueDate')} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>💰 SO Value (₹ / unit)</label>
              <input type="number" step="0.01" min={0} className="innovic-input" style={{ fontWeight: 700, color: 'var(--green)' }} {...register('lines.0.rate', { valueAsNumber: true })} />
            </div>
            <div className="form-grp">
              <label className="form-label">📦 BOM (Bill of Materials)</label>
              <select className="innovic-select" {...register('header.bomMasterId')}>
                <option value="">— No BOM (BOM Pending) —</option>
                {boms.map((b) => <option key={b.id} value={b.id}>{b.bomNo} — {b.bomName} (Rev {b.revision}, {b.lineCount} items)</option>)}
              </select>
              <div className="form-help">Select an active BOM from BOM Master. Equipment value total = SO Value × Order Qty.</div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Component / With-Material line items ── */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>▸ Line Items</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => downloadSoLineTemplate()}>⬇ Template</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => lineFileRef.current?.click()}>📄 Import Excel</button>
              <input ref={lineFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLines(f); }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add line</button>
            </div>
          </div>
          {importMsg ? <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>{importMsg} <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button></div> : null}

          {fields.length === 0 ? (
            <div className="empty-state" style={{ padding: 24, border: '1px dashed var(--border)' }}>No lines yet. Click <strong>Add line</strong> or import from Excel.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fields.map((field, idx) => {
                const amt = (Number(watchedLines?.[idx]?.orderQty) || 0) * (Number(watchedLines?.[idx]?.rate) || 0);
                return (
                  <div key={field.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 700 }}>
                      <span>Line {idx + 1}</span>
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ color: 'var(--green)' }}>Amount ₹{amt.toFixed(2)}</span>
                        <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => remove(idx)} aria-label={`Remove line ${idx + 1}`}><Trash2 size={12} /></button>
                      </span>
                    </div>
                    <div className="form-grid form-grid-3">
                      <div className="form-grp">
                        <label className="form-label">Item Code</label>
                        <input className="innovic-input" autoComplete="off" list="dlSoItems" placeholder="🔍 ITM-001" {...register(`lines.${idx}.itemCodeText` as const)} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Part Name<span className="req">★</span></label>
                        <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.partName` as const, { required: 'Part name is required' })} />
                        {errors.lines?.[idx]?.partName?.message ? <div className="form-error">{errors.lines[idx]?.partName?.message}</div> : null}
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Material</label>
                        <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.material` as const)} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Drawing No.</label>
                        <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.drawingNo` as const)} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">UOM</label>
                        <select className="innovic-select" {...register(`lines.${idx}.uom` as const)}>
                          {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Qty<span className="req">★</span></label>
                        <input type="number" min={1} className="innovic-input" {...register(`lines.${idx}.orderQty` as const, { valueAsNumber: true, min: { value: 1, message: 'Min 1' } })} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Rate</label>
                        <input type="number" step="0.01" min={0} className="innovic-input" {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Due date</label>
                        <input type="date" className="innovic-input" {...register(`lines.${idx}.dueDate` as const)} />
                      </div>
                      <div className="form-grp">
                        <label className="form-label">Client PO line</label>
                        <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.clientPoLineNo` as const)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SO Totals (legacy L12291) */}
          <div style={{ marginTop: 12, border: '2px solid var(--green)', borderRadius: 8, padding: '10px 16px', background: 'rgba(34,197,94,0.03)', display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Tot label="Subtotal" value={subtotal} />
            <Tot label={`GST (${gstPercent}%)`} value={gstAmt} />
            <Tot label="Grand Total" value={grand} bold />
          </div>

          {/* Delivery Schedule / Milestones (ISSUE-015, legacy L12294) */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>📅 Delivery Schedule / Milestones</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => appendMs({ ...NEW_MILESTONE, lotNo: msFields.length + 1 })}><Plus size={13} /> Add Lot</button>
            </div>
            {msFields.length === 0 ? (
              <div className="text3" style={{ fontSize: 11 }}>No delivery lots planned. Optional — click <strong>Add Lot</strong> to schedule partial deliveries.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msFields.map((field, idx) => (
                  <div key={field.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg2)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-grp" style={{ width: 80 }}>
                      <label className="form-label">Lot #</label>
                      <input type="number" min={1} className="innovic-input" {...register(`milestones.${idx}.lotNo` as const, { valueAsNumber: true })} />
                    </div>
                    <div className="form-grp" style={{ width: 110 }}>
                      <label className="form-label">Qty</label>
                      <input type="number" min={0} className="innovic-input" {...register(`milestones.${idx}.qty` as const, { valueAsNumber: true })} />
                    </div>
                    <div className="form-grp" style={{ width: 160 }}>
                      <label className="form-label">Due Date</label>
                      <input type="date" className="innovic-input" {...register(`milestones.${idx}.dueDate` as const)} />
                    </div>
                    <div className="form-grp" style={{ flex: 1, minWidth: 160 }}>
                      <label className="form-label">Remarks</label>
                      <input className="innovic-input" autoComplete="off" {...register(`milestones.${idx}.remarks` as const)} />
                    </div>
                    <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeMs(idx)} aria-label={`Remove lot ${idx + 1}`}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {props.submitError ? (
          <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginBottom: 10 }}>{props.submitError}</div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? <button type="button" className="btn btn-ghost" onClick={props.onCancel}>Cancel</button> : null}
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create SO')}
          </button>
        </div>
      </div>
    </form>
  );
}

function Tot({ label, value, bold }: { label: string; value: number; bold?: boolean }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: bold ? 18 : 14, fontWeight: 700, color: bold ? 'var(--green)' : 'var(--text)' }}>₹{value.toFixed(2)}</div>
    </div>
  );
}

function detailToFormValues(detail: SalesOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      soDate: detail.soDate,
      type: detail.type,
      status: detail.status,
      gstPercent: Number(detail.gstPercent),
      ...(detail.clientId ? { clientId: detail.clientId } : {}),
      ...(detail.customerName ? { customerName: detail.customerName } : {}),
      ...(detail.clientPoNo ? { clientPoNo: detail.clientPoNo } : {}),
      ...(detail.bomMasterId ? { bomMasterId: detail.bomMasterId } : {}),
      ...(detail.bomStatus ? { bomStatus: detail.bomStatus } : {}),
      ...(detail.costCenter ? { costCenter: detail.costCenter } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines:
      detail.lines.length > 0
        ? detail.lines.map((l): LineFormValue => ({
            id: l.id,
            ...(l.itemId ? { itemId: l.itemId } : {}),
            itemCodeText: l.itemCodeText ?? '',
            partName: l.partName,
            ...(l.material ? { material: l.material } : {}),
            ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
            uom: l.uom,
            orderQty: l.orderQty,
            rate: Number(l.rate),
            ...(l.dueDate ? { dueDate: l.dueDate } : {}),
            ...(l.clientPoLineNo ? { clientPoLineNo: l.clientPoLineNo } : {}),
            status: l.status,
          }))
        : [{ ...NEW_LINE }],
    milestones: detail.milestones.map((m): MilestoneFormValue => ({
      id: m.id,
      lotNo: m.lotNo,
      qty: m.qty,
      ...(m.dueDate ? { dueDate: m.dueDate } : {}),
      ...(m.remarks ? { remarks: m.remarks } : {}),
    })),
  };
}
