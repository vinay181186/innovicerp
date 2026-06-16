// Purchase Order form (UI-003-04) — header + dynamic line items.

import {
  type CreatePurchaseOrderInput,
  PO_STATUSES,
  PO_TYPES,
  type PoStatus,
  type PoType,
  type PurchaseOrderDetail,
  type UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useItemsList } from '@/modules/items/api';
import { useVendorsList } from '@/modules/vendors/api';

interface LineFormValue {
  id?: string;
  itemId?: string;
  itemCodeText: string;
  itemName: string;
  qty: number;
  rate: number;
  receivedQty?: number;
  dueDate?: string;
  lineRemarks?: string;
}

interface FormValues {
  header: {
    code: string;
    poDate: string;
    poType: PoType;
    status: PoStatus;
    vendorId?: string;
    vendorCodeText?: string;
    dueDate?: string;
    taxType?: string;
    sgstPct: number;
    cgstPct: number;
    igstPct: number;
    prCodeText?: string;
    approvalRemarks?: string;
    remarks?: string;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  poDate: new Date().toISOString().slice(0, 10),
  poType: 'standard',
  status: 'draft',
  sgstPct: 0,
  cgstPct: 0,
  igstPct: 0,
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  itemName: '',
  qty: 1,
  rate: 0,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreatePurchaseOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: PurchaseOrderDetail;
  onSubmit: (values: UpdatePurchaseOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type PurchaseOrderFormProps = CreateMode | EditMode;

export function PurchaseOrderForm(props: PurchaseOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, setValue } = form;
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  // Item master drives the per-line code autosuggest + name auto-fill. PO still
  // accepts off-master free text, so a non-matching code is left untouched.
  const { data: itemsData } = useItemsList({ limit: 1000, offset: 0 });
  const items = itemsData?.items ?? [];
  const itemsByCode = useMemo(() => {
    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || undefined,
      taxType: values.header.taxType?.trim() || undefined,
      dueDate: values.header.dueDate || undefined,
      prCodeText: values.header.prCodeText?.trim() || undefined,
      approvalRemarks: values.header.approvalRemarks?.trim() || undefined,
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
        itemName: l.itemName.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate),
        dueDate: l.dueDate || undefined,
        lineRemarks: l.lineRemarks?.trim() || undefined,
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreatePurchaseOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            PO No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('header.code', { required: !isEdit ? 'PO No. is required' : false })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.header?.code?.message ? (
            <div className="form-error">{errors.header.code.message}</div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="poDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="poDate"
            type="date"
            className="innovic-input"
            {...register('header.poDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="poType">
            Type
          </label>
          <select id="poType" className="innovic-select" {...register('header.poType')}>
            {PO_TYPES.map((t) => (
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
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="dueDate">
            Due date
          </label>
          <input
            id="dueDate"
            type="date"
            className="innovic-input"
            {...register('header.dueDate')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="prCodeText">
            PR ref (audit)
          </label>
          <input
            id="prCodeText"
            className="innovic-input"
            autoComplete="off"
            placeholder="PR-NNNNN (when applicable)"
            {...register('header.prCodeText')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="vendorId">
            Vendor
          </label>
          <select id="vendorId" className="innovic-select" {...register('header.vendorId')}>
            <option value="">— Free-text vendor below —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} — {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="vendorCodeText">
            Vendor code (fallback)
          </label>
          <input
            id="vendorCodeText"
            className="innovic-input"
            autoComplete="off"
            placeholder="Required if no vendor picked"
            {...register('header.vendorCodeText')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="taxType">
            Tax type
          </label>
          <select id="taxType" className="innovic-select" {...register('header.taxType')}>
            <option value="">— None —</option>
            <option value="sgst_cgst">SGST + CGST</option>
            <option value="igst">IGST</option>
            <option value="none">None</option>
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="sgstPct">
            SGST %
          </label>
          <input
            id="sgstPct"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            {...register('header.sgstPct', { valueAsNumber: true })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="cgstPct">
            CGST %
          </label>
          <input
            id="cgstPct"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            {...register('header.cgstPct', { valueAsNumber: true })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="igstPct">
            IGST %
          </label>
          <input
            id="igstPct"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            {...register('header.igstPct', { valueAsNumber: true })}
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
              <div className="form-grid form-grid-3">
                <div className="form-grp">
                  <label className="form-label">Item Code</label>
                  {(() => {
                    const lineCodeReg = register(`lines.${idx}.itemCodeText` as const);
                    return (
                      <input
                        className="innovic-input"
                        list="dlPoItems"
                        autoComplete="off"
                        placeholder="🔍 ITM-001"
                        {...lineCodeReg}
                        onChange={(e) => {
                          void lineCodeReg.onChange(e);
                          const match = itemsByCode.get(e.target.value.trim().toUpperCase());
                          if (match) {
                            setValue(`lines.${idx}.itemId` as const, match.id, {
                              shouldDirty: true,
                            });
                            setValue(`lines.${idx}.itemName` as const, match.name, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          } else {
                            setValue(`lines.${idx}.itemId` as const, undefined, {
                              shouldDirty: true,
                            });
                          }
                        }}
                      />
                    );
                  })()}
                </div>
                <div className="form-grp">
                  <label className="form-label">
                    Item Name<span className="req">★</span>
                  </label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.itemName` as const, {
                      required: 'Item name is required',
                    })}
                  />
                  {errors.lines?.[idx]?.itemName?.message ? (
                    <div className="form-error">{errors.lines[idx]?.itemName?.message}</div>
                  ) : null}
                </div>
                <div className="form-grp">
                  <label className="form-label">
                    Qty<span className="req">★</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="innovic-input"
                    {...register(`lines.${idx}.qty` as const, {
                      valueAsNumber: true,
                      min: { value: 1, message: 'Min 1' },
                    })}
                  />
                </div>

                <div className="form-grp">
                  <label className="form-label">Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                  />
                </div>
                {isEdit ? (
                  <div className="form-grp">
                    <label className="form-label">Received</label>
                    <input
                      type="number"
                      className="innovic-input"
                      readOnly
                      title="Received qty is mutated only by GRN cascade (T-036c)"
                      value={field.receivedQty ?? 0}
                    />
                  </div>
                ) : null}
                <div className="form-grp">
                  <label className="form-label">Due date</label>
                  <input
                    type="date"
                    className="innovic-input"
                    {...register(`lines.${idx}.dueDate` as const)}
                  />
                </div>

                <div className="form-grp form-full">
                  <label className="form-label">Line Remarks</label>
                  <input
                    className="innovic-input"
                    autoComplete="off"
                    {...register(`lines.${idx}.lineRemarks` as const)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <datalist id="dlPoItems">
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.name}
          </option>
        ))}
      </datalist>

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
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create PO')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: PurchaseOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      poDate: detail.poDate,
      poType: detail.poType,
      status: detail.status,
      ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
      ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
      ...(detail.dueDate ? { dueDate: detail.dueDate } : {}),
      ...(detail.taxType ? { taxType: detail.taxType } : {}),
      sgstPct: Number(detail.sgstPct),
      cgstPct: Number(detail.cgstPct),
      igstPct: Number(detail.igstPct),
      ...(detail.prCodeText ? { prCodeText: detail.prCodeText } : {}),
      ...(detail.approvalRemarks ? { approvalRemarks: detail.approvalRemarks } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines: detail.lines.map(
      (l): LineFormValue => ({
        id: l.id,
        ...(l.itemId ? { itemId: l.itemId } : {}),
        itemCodeText: l.itemCodeText ?? '',
        itemName: l.itemName,
        qty: l.qty,
        rate: Number(l.rate),
        receivedQty: l.receivedQty,
        ...(l.dueDate ? { dueDate: l.dueDate } : {}),
        ...(l.lineRemarks ? { lineRemarks: l.lineRemarks } : {}),
      }),
    ),
  };
}
