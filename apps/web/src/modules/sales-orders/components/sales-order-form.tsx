// Sales Order form (UI-003-05) — header + dynamic line items.

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
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useClientsList } from '@/modules/clients/api';

interface LineFormValue {
  id?: string;
  itemId?: string;
  itemCodeText: string;
  partName: string;
  material?: string;
  drawingNo?: string;
  uom: Uom;
  orderQty: number;
  rate: number;
  dueDate?: string;
  clientPoLineNo?: string;
  status?: SoStatus;
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
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  soDate: new Date().toISOString().slice(0, 10),
  type: 'component_manufacturing',
  status: 'open',
  gstPercent: 18,
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  partName: '',
  uom: 'NOS',
  orderQty: 1,
  rate: 0,
};

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
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch } = form;
  const errors = formState.errors;

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const { data: clientsData } = useClientsList({ limit: 200, offset: 0 });
  const clients = clientsData?.clients ?? [];

  const headerType = watch('header.type');

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      customerName: values.header.customerName?.trim() || undefined,
      clientId: values.header.clientId || undefined,
      clientPoNo: values.header.clientPoNo?.trim() || undefined,
      bomMasterId: values.header.bomMasterId?.trim() || undefined,
      bomStatus: values.header.bomStatus?.trim() || undefined,
      costCenter: values.header.costCenter?.trim() || undefined,
      remarks: values.header.remarks?.trim() || undefined,
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
        rate: Number(l.rate),
        dueDate: l.dueDate || undefined,
        clientPoLineNo: l.clientPoLineNo?.trim() || undefined,
        ...(l.status ? { status: l.status } : {}),
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateSalesOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            SO/WO No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('header.code', { required: 'SO/WO No. is required' })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.header?.code?.message ? (
            <div className="form-error">{errors.header.code.message}</div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="soDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="soDate"
            type="date"
            className="innovic-input"
            {...register('header.soDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="type">
            Type
          </label>
          <select id="type" className="innovic-select" {...register('header.type')}>
            {SO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Status
          </label>
          <select id="status" className="innovic-select" {...register('header.status')}>
            {SO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstPercent">
            GST %
          </label>
          <select
            id="gstPercent"
            className="innovic-select"
            {...register('header.gstPercent', { valueAsNumber: true })}
          >
            {[0, 5, 12, 18, 28].map((g) => (
              <option key={g} value={g}>
                {g}%
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="costCenter">
            Cost center
          </label>
          <input
            id="costCenter"
            className="innovic-input"
            autoComplete="off"
            {...register('header.costCenter')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="clientId">
            Client
          </label>
          <select id="clientId" className="innovic-select" {...register('header.clientId')}>
            <option value="">— Free-text customer below —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="customerName">
            Customer name (fallback)
          </label>
          <input
            id="customerName"
            className="innovic-input"
            autoComplete="off"
            placeholder="Required if no client picked"
            {...register('header.customerName')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="clientPoNo">
            Client PO No.
          </label>
          <input
            id="clientPoNo"
            className="innovic-input"
            autoComplete="off"
            {...register('header.clientPoNo')}
          />
        </div>

        {headerType === 'equipment' ? (
          <>
            <div className="form-grp">
              <label className="form-label" htmlFor="bomMasterId">
                BOM master id (forward)
              </label>
              <input
                id="bomMasterId"
                className="innovic-input"
                autoComplete="off"
                {...register('header.bomMasterId')}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="bomStatus">
                BOM status
              </label>
              <input
                id="bomStatus"
                className="innovic-input"
                autoComplete="off"
                {...register('header.bomStatus')}
              />
            </div>
          </>
        ) : null}

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">
            Remarks
          </label>
          <textarea
            id="remarks"
            className="innovic-textarea"
            rows={2}
            {...register('header.remarks')}
          />
        </div>
      </div>

      {/* Lines */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div
          className="form-label"
          style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}
        >
          Line items
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => append({ ...NEW_LINE })}
        >
          <Plus size={13} /> Add line
        </button>
      </div>

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: 24, border: '1px dashed var(--border)' }}>
          No lines yet. Equipment SOs can be saved without lines (BOM expansion lands later);
          otherwise click <strong>Add line</strong>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field, idx) => (
            <div
              key={field.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
                background: 'var(--bg2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  fontSize: 11,
                  color: 'var(--text3)',
                  fontFamily: 'var(--mono)',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                <span>Line {idx + 1}</span>
                <button
                  type="button"
                  className="btn btn-danger btn-sm btn-icon"
                  onClick={() => remove(idx)}
                  aria-label={`Remove line ${idx + 1}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="form-grid form-grid-3">
                <div className="form-grp">
                  <label className="form-label">Item Code</label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    placeholder="ITM-001"
                    {...register(`lines.${idx}.itemCodeText` as const)}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">
                    Part Name<span className="req">★</span>
                  </label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.partName` as const, {
                      required: 'Part name is required',
                    })}
                  />
                  {errors.lines?.[idx]?.partName?.message ? (
                    <div className="form-error">{errors.lines[idx]?.partName?.message}</div>
                  ) : null}
                </div>
                <div className="form-grp">
                  <label className="form-label">Material</label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.material` as const)}
                  />
                </div>

                <div className="form-grp">
                  <label className="form-label">Drawing No.</label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.drawingNo` as const)}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">UOM</label>
                  <select className="innovic-select" {...register(`lines.${idx}.uom` as const)}>
                    {UOMS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-grp">
                  <label className="form-label">
                    Qty<span className="req">★</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="innovic-input"
                    {...register(`lines.${idx}.orderQty` as const, {
                      valueAsNumber: true,
                      min: { value: 1, message: 'Min 1' },
                    })}
                  />
                </div>

                <div className="form-grp">
                  <label className="form-label">Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">Due date</label>
                  <input
                    type="date"
                    className="innovic-input"
                    {...register(`lines.${idx}.dueDate` as const)}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">Client PO line</label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.clientPoLineNo` as const)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {props.submitError ? (
          <div
            style={{
              color: 'var(--red)',
              background: 'var(--red3)',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {props.submitError}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? (
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create SO')}
          </button>
        </div>
      </div>
    </form>
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
    lines: detail.lines.map(
      (l): LineFormValue => ({
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
      }),
    ),
  };
}
