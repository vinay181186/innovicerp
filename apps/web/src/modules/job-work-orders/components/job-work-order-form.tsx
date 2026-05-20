// Job Work Order form (UI-003-04) — header + dynamic line items.
// Mirrors legacy jwHeaderForm L12784 + _jwLineRowHtml L12692.

import {
  type CreateJobWorkOrderInput,
  type JobWorkOrderDetail,
  SO_STATUSES,
  type SoStatus,
  type UpdateJobWorkOrderInput,
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
  dueDate?: string;
  clientMaterial?: string;
  clientMaterialQty?: number;
  materialReceivedDate?: string;
  materialReceivedQty?: number;
  status?: SoStatus;
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
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  jwDate: new Date().toISOString().slice(0, 10),
  status: 'open',
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  partName: '',
  uom: 'NOS',
  orderQty: 1,
};

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
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const { data: clientsData } = useClientsList({ limit: 200, offset: 0 });
  const clients = clientsData?.clients ?? [];

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      customerName: values.header.customerName?.trim() || undefined,
      clientId: values.header.clientId || undefined,
      clientPoNo: values.header.clientPoNo?.trim() || undefined,
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
        dueDate: l.dueDate || undefined,
        clientMaterial: l.clientMaterial?.trim() || undefined,
        clientMaterialQty:
          l.clientMaterialQty !== undefined && !Number.isNaN(Number(l.clientMaterialQty))
            ? Number(l.clientMaterialQty)
            : undefined,
        materialReceivedDate: l.materialReceivedDate || undefined,
        materialReceivedQty:
          l.materialReceivedQty !== undefined && !Number.isNaN(Number(l.materialReceivedQty))
            ? Number(l.materialReceivedQty)
            : undefined,
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
      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            JW No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('header.code', { required: 'JW No. is required' })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.header?.code?.message ? (
            <div className="form-error">{errors.header.code.message}</div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="jwDate"
            type="date"
            className="innovic-input"
            {...register('header.jwDate', { required: 'Date is required' })}
          />
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
            Customer Name (fallback)
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
          No lines yet. Click <strong>Add line</strong> — at least one is required.
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

              <div className="form-grid form-grid-3" style={{ marginBottom: 8 }}>
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
                  <label className="form-label">Due date</label>
                  <input
                    type="date"
                    className="innovic-input"
                    {...register(`lines.${idx}.dueDate` as const)}
                  />
                </div>
              </div>

              {/* Client-material section */}
              <div
                style={{
                  background: 'rgba(22,163,74,0.05)',
                  border: '1px solid rgba(22,163,74,0.25)',
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                <div
                  className="form-label"
                  style={{ color: 'var(--green2)', marginBottom: 6, fontSize: 11 }}
                >
                  ▸ Client material (party-supplied)
                </div>
                <div className="form-grid form-grid-3">
                  <div className="form-grp">
                    <label className="form-label">Material code</label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      placeholder="ITM-001-rm"
                      {...register(`lines.${idx}.clientMaterial` as const)}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Mat. qty</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      className="innovic-input"
                      {...register(`lines.${idx}.clientMaterialQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Received date</label>
                    <input
                      type="date"
                      className="innovic-input"
                      {...register(`lines.${idx}.materialReceivedDate` as const)}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Received qty</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      className="innovic-input"
                      {...register(`lines.${idx}.materialReceivedQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? (isEdit ? 'Save changes' : 'Create JW')}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
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
        ...(l.dueDate ? { dueDate: l.dueDate } : {}),
        ...(l.clientMaterial ? { clientMaterial: l.clientMaterial } : {}),
        ...(l.clientMaterialQty !== null ? { clientMaterialQty: Number(l.clientMaterialQty) } : {}),
        ...(l.materialReceivedDate ? { materialReceivedDate: l.materialReceivedDate } : {}),
        ...(l.materialReceivedQty !== null
          ? { materialReceivedQty: Number(l.materialReceivedQty) }
          : {}),
        status: l.status,
      }),
    ),
  };
}

function FormFooter(props: {
  isSubmitting: boolean;
  submitLabel: string;
  submitError: string | null;
  onCancel?: (() => void) | undefined;
}): React.JSX.Element {
  return (
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
        <button type="submit" className="btn btn-primary" disabled={props.isSubmitting}>
          {props.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
}
