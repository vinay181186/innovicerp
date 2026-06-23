// Job Work Order form — mirror of legacy jwHeaderForm (L12784). Header +
// a header-level CLIENT MATERIAL DETAILS section (client supplies raw material
// → we process → deliver finished parts) + line items with per-line Rate +
// Amount. Auto-suggested JW number, client + New, item + -rm datalists.

import {
  type CreateJobWorkOrderInput,
  type JobWorkOrderDetail,
  SO_STATUSES,
  type SoStatus,
  type UpdateJobWorkOrderInput,
  type Uom,
  UOMS,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useClientsList } from '@/modules/clients/api';
import { useItemsList } from '@/modules/items/api';
import { downloadJwLineTemplate, parseJwLineFile } from '../lib/import-export';

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
  status?: SoStatus | undefined;
}

interface FormValues {
  header: {
    code: string;
    jwDate: string;
    status: SoStatus;
    clientId?: string;
    customerName?: string;
    clientPoNo?: string;
    remarks?: string;
    clientMaterial?: string;
    clientMaterialQty?: number;
    materialReceivedDate?: string;
    materialReceivedQty?: number;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  jwDate: new Date().toISOString().slice(0, 10),
  status: 'open',
};
const NEW_LINE: LineFormValue = { itemCodeText: '', partName: '', uom: 'NOS', orderQty: 1, rate: 0 };

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};
type EditMode = {
  mode: 'edit';
  detail: JobWorkOrderDetail;
  onSubmit: (values: UpdateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};
export type JobWorkOrderFormProps = CreateMode | EditMode;

export function JobWorkOrderForm(props: JobWorkOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const { data: clientsData } = useClientsList({ limit: 200, offset: 0 });
  const clients = clientsData?.clients ?? [];
  const { data: itemsData } = useItemsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];
  const rmItems = items.filter((it) => it.code.toLowerCase().includes('-rm'));
  // Code → master item, for auto-filling the line from the item master (bug 2.1).
  const itemsByCode = new Map(items.map((it) => [it.code.trim().toUpperCase(), it]));

  /** On item-code change, fill empty line fields from the master (fill-only, so
   *  manual edits are never clobbered); UOM mirrors the master. */
  function fillLineFromItem(idx: number, codeValue: string): void {
    const it = itemsByCode.get(codeValue.trim().toUpperCase());
    if (!it) return;
    if (!getValues(`lines.${idx}.partName`)) setValue(`lines.${idx}.partName`, it.name);
    if (!getValues(`lines.${idx}.material`)) setValue(`lines.${idx}.material`, it.material ?? '');
    if (!getValues(`lines.${idx}.drawingNo`)) setValue(`lines.${idx}.drawingNo`, it.drawingNo ?? '');
    setValue(`lines.${idx}.uom`, it.uom);
  }

  const watchedLines = watch('lines');

  // In-form line import (appends lines to the JW being created/edited).
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseJwLineFile(file);
      for (const r of rows) append({ ...NEW_LINE, ...r });
      setImportMsg(`Added ${rows.length} line(s)${errs.length ? ` · ${errs.length} skipped` : ''}.`);
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      if (lineFileRef.current) lineFileRef.current.value = '';
    }
  }

  const onValid = async (values: FormValues): Promise<void> => {
    const h = values.header;
    const headerOut = {
      ...h,
      // Code is generated server-side in series; never send a client value on
      // create (an empty string would fail the schema's min-length check).
      code: h.code?.trim() || undefined,
      // customerName is snapshotted server-side from the client master.
      customerName: undefined,
      clientId: h.clientId || undefined,
      clientPoNo: h.clientPoNo?.trim() || undefined,
      remarks: h.remarks?.trim() || undefined,
      clientMaterial: h.clientMaterial?.trim() || undefined,
      clientMaterialQty:
        h.clientMaterialQty !== undefined && !Number.isNaN(Number(h.clientMaterialQty))
          ? Number(h.clientMaterialQty)
          : undefined,
      materialReceivedDate: h.materialReceivedDate || undefined,
      materialReceivedQty:
        h.materialReceivedQty !== undefined && !Number.isNaN(Number(h.materialReceivedQty))
          ? Number(h.materialReceivedQty)
          : undefined,
    };

    const linesOut = values.lines.map((l) => {
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
        rate: Number(l.rate) || 0,
        dueDate: l.dueDate || undefined,
        ...(l.status ? { status: l.status } : {}),
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateJobWorkOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <datalist id="dlJwItems">
        {items.map((it) => (
          <option key={it.id} value={it.code}>{it.name}</option>
        ))}
      </datalist>
      <datalist id="dlRmItems">
        {rmItems.map((it) => (
          <option key={it.id} value={it.code}>{it.name}{it.material ? ` [${it.material}]` : ''}</option>
        ))}
      </datalist>

      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">JWSO No.</label>
          <input id="code" className="innovic-input" autoComplete="off" readOnly placeholder={isEdit ? undefined : 'Auto-generated on save'} {...register('header.code')} />
          <div className="form-help">{isEdit ? 'Code cannot be changed after creation.' : 'Generated automatically in series (IN-JW-…) when you save.'}</div>
          {errors.header?.code?.message ? <div className="form-error">{errors.header.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwDate">Date<span className="req">★</span></label>
          <input id="jwDate" type="date" className="innovic-input" {...register('header.jwDate', { required: 'Date is required' })} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="status">Status</label>
          <select id="status" className="innovic-select" {...register('header.status')}>
            {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
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
            Job Work orders must reference a client from the master. Not listed? Use <b>+ New</b>.
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

      {/* Client Material Details (legacy L12839) */}
      <div style={{ border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: 12, margin: '0 0 16px', background: 'rgba(34,197,94,0.04)' }}>
        <div style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.08em', marginBottom: 8 }}>▸ CLIENT MATERIAL DETAILS</div>
        <div className="form-grid form-grid-3">
          <div className="form-grp form-full">
            <label className="form-label">Client Material (Party Supplied Item)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="innovic-input" style={{ flex: 1 }} autoComplete="off" list="dlRmItems" placeholder="🔍 Search -rm items…" {...register('header.clientMaterial')} />
              <Link to="/items/new" className="btn btn-ghost btn-sm" title="Create a new -rm item" style={{ whiteSpace: 'nowrap' }}>+ New</Link>
            </div>
          </div>
          <div className="form-grp">
            <label className="form-label">Material Qty (Client Supplied)</label>
            <input type="number" min={0} step="0.01" className="innovic-input" placeholder="0" {...register('header.clientMaterialQty', { valueAsNumber: true })} />
          </div>
          <div className="form-grp">
            <label className="form-label">Material Received Date</label>
            <input type="date" className="innovic-input" {...register('header.materialReceivedDate')} />
          </div>
          <div className="form-grp">
            <label className="form-label">Material Received Qty</label>
            <input type="number" min={0} step="0.01" className="innovic-input" placeholder="0" {...register('header.materialReceivedQty', { valueAsNumber: true })} />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>▸ JWSO Line Items</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => downloadJwLineTemplate()}>⬇ Template</button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => lineFileRef.current?.click()}>📄 Import Excel</button>
          <input ref={lineFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLines(f); }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add line</button>
        </div>
      </div>
      {importMsg ? <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>{importMsg} <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button></div> : null}

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: 24, border: '1px dashed var(--border)' }}>No lines yet. Click <strong>Add line</strong> — at least one is required.</div>
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
                    <input className="innovic-input" autoComplete="off" list="dlJwItems" placeholder="🔍 ITM-001" {...register(`lines.${idx}.itemCodeText` as const, { onChange: (e) => fillLineFromItem(idx, e.target.value) })} />
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
                    <label className="form-label" style={{ color: 'var(--green)' }}>Rate ₹</label>
                    <input type="number" step="0.01" min={0} className="innovic-input" {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Due date</label>
                    <input type="date" className="innovic-input" {...register(`lines.${idx}.dueDate` as const)} />
                  </div>
                </div>
              </div>
            );
          })}
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
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create JWSO')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: JobWorkOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      jwDate: detail.jwDate,
      status: detail.status,
      ...(detail.clientId ? { clientId: detail.clientId } : {}),
      ...(detail.customerName ? { customerName: detail.customerName } : {}),
      ...(detail.clientPoNo ? { clientPoNo: detail.clientPoNo } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
      ...(detail.clientMaterial ? { clientMaterial: detail.clientMaterial } : {}),
      ...(detail.clientMaterialQty !== null ? { clientMaterialQty: Number(detail.clientMaterialQty) } : {}),
      ...(detail.materialReceivedDate ? { materialReceivedDate: detail.materialReceivedDate } : {}),
      ...(detail.materialReceivedQty !== null ? { materialReceivedQty: Number(detail.materialReceivedQty) } : {}),
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
            status: l.status,
          }))
        : [{ ...NEW_LINE }],
  };
}
