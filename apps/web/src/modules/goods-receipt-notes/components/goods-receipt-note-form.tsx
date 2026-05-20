// GRN form (UI-003-05) — header + dynamic line items with inline QC fields.
// QC-completed lines lock client-side (server enforces with ConflictError).

import {
  type CreateGoodsReceiptNoteInput,
  GRN_QC_STATUSES,
  type GoodsReceiptNoteDetail,
  type GrnQcStatus,
  type UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { useVendorsList } from '@/modules/vendors/api';

interface LineFormValue {
  id?: string;
  existingQcStatus?: GrnQcStatus;
  purchaseOrderLineId?: string;
  itemId?: string;
  itemCodeText: string;
  itemName: string;
  receivedQty: number;
  dcRefNo?: string;
  qcStatus: GrnQcStatus;
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcDate?: string;
  qcRemarks?: string;
  remarks?: string;
}

interface FormValues {
  header: {
    code: string;
    grnDate: string;
    purchaseOrderId?: string;
    poCodeText?: string;
    vendorId?: string;
    vendorCodeText?: string;
    dcNo?: string;
    invoiceNo?: string;
    remarks?: string;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  grnDate: new Date().toISOString().slice(0, 10),
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  itemName: '',
  receivedQty: 1,
  qcStatus: 'pending',
  qcAcceptedQty: 0,
  qcRejectedQty: 0,
};

type CreateMode = {
  mode: 'create';
  initialPurchaseOrderId?: string;
  onSubmit: (values: CreateGoodsReceiptNoteInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: GoodsReceiptNoteDetail;
  onSubmit: (values: UpdateGoodsReceiptNoteInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type GoodsReceiptNoteFormProps = CreateMode | EditMode;

export function GoodsReceiptNoteForm(props: GoodsReceiptNoteFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : {
        header: {
          ...HEADER_DEFAULTS,
          ...(props.initialPurchaseOrderId
            ? { purchaseOrderId: props.initialPurchaseOrderId }
            : {}),
        },
        lines: [{ ...NEW_LINE }],
      };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  const { data: posData } = usePurchaseOrdersList({ limit: 200, offset: 0 });
  const pos = (posData?.items ?? []).filter((p) =>
    ['draft', 'open', 'partial', 'qc_pending'].includes(p.status),
  );

  const selectedPoId = useWatch({ control, name: 'header.purchaseOrderId' });
  const { data: selectedPoDetail } = usePurchaseOrder(
    !isEdit && selectedPoId ? selectedPoId : undefined,
  );

  useEffect(() => {
    if (isEdit) return;
    if (!selectedPoDetail) return;
    const cur = getValues('lines');
    const isPristine = cur.length === 1 && cur[0]!.itemCodeText === '' && cur[0]!.itemName === '';
    if (!isPristine) return;
    if (!getValues('header.vendorId') && selectedPoDetail.vendorId) {
      setValue('header.vendorId', selectedPoDetail.vendorId, { shouldDirty: true });
    }
    const newLines = selectedPoDetail.lines
      .filter((l) => l.qty - l.receivedQty > 0)
      .map(
        (l): LineFormValue => ({
          purchaseOrderLineId: l.id,
          ...(l.itemId ? { itemId: l.itemId } : {}),
          itemCodeText: l.itemCodeText ?? '',
          itemName: l.itemName,
          receivedQty: l.qty - l.receivedQty,
          qcStatus: 'pending',
          qcAcceptedQty: 0,
          qcRejectedQty: 0,
        }),
      );
    if (newLines.length > 0) replace(newLines);
  }, [isEdit, selectedPoDetail, getValues, setValue, replace]);

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      purchaseOrderId: values.header.purchaseOrderId || undefined,
      poCodeText: values.header.poCodeText?.trim() || undefined,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || undefined,
      dcNo: values.header.dcNo?.trim() || undefined,
      invoiceNo: values.header.invoiceNo?.trim() || undefined,
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
        ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
        ...refs,
        itemName: l.itemName.trim(),
        receivedQty: Number(l.receivedQty),
        dcRefNo: l.dcRefNo?.trim() || undefined,
        qcStatus: l.qcStatus,
        qcAcceptedQty: Number(l.qcAcceptedQty),
        qcRejectedQty: Number(l.qcRejectedQty),
        qcDate: l.qcDate || undefined,
        qcRemarks: l.qcRemarks?.trim() || undefined,
        remarks: l.remarks?.trim() || undefined,
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateGoodsReceiptNoteInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            GRN No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('header.code', { required: !isEdit ? 'GRN No. is required' : false })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.header?.code?.message ? (
            <div className="form-error">{errors.header.code.message}</div>
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="grnDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="grnDate"
            type="date"
            className="innovic-input"
            {...register('header.grnDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="purchaseOrderId">
            Purchase Order
          </label>
          <select
            id="purchaseOrderId"
            className="innovic-select"
            disabled={isEdit}
            {...register('header.purchaseOrderId')}
          >
            <option value="">— Free-text PO ref below —</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.vendorName ?? p.vendorCodeText ?? '—'}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="poCodeText">
            PO ref (audit)
          </label>
          <input
            id="poCodeText"
            className="innovic-input"
            autoComplete="off"
            {...register('header.poCodeText')}
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
            Vendor Code (fallback)
          </label>
          <input
            id="vendorCodeText"
            className="innovic-input"
            autoComplete="off"
            {...register('header.vendorCodeText')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="dcNo">
            DC No.
          </label>
          <input
            id="dcNo"
            className="innovic-input"
            autoComplete="off"
            {...register('header.dcNo')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="invoiceNo">
            Invoice No.
          </label>
          <input
            id="invoiceNo"
            className="innovic-input"
            autoComplete="off"
            {...register('header.invoiceNo')}
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
          No lines yet. Pick a PO above to auto-populate, or click <strong>Add line</strong>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field, idx) => {
            const locked = field.existingQcStatus === 'completed';
            return (
              <div
                key={field.id}
                style={{
                  border: `1px solid ${locked ? 'rgba(22,163,74,0.5)' : 'var(--border)'}`,
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
                  <span>
                    Line {idx + 1}
                    {locked ? (
                      <span className="badge b-green" style={{ marginLeft: 8 }}>
                        QC locked
                      </span>
                    ) : null}
                  </span>
                  {!locked ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm btn-icon"
                      onClick={() => remove(idx)}
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>

                <div className="form-grid form-grid-3" style={{ marginBottom: 8 }}>
                  <div className="form-grp">
                    <label className="form-label">Item Code</label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      readOnly={locked}
                      {...register(`lines.${idx}.itemCodeText` as const)}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">
                      Item Name<span className="req">★</span>
                    </label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      readOnly={locked}
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
                      Received<span className="req">★</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      className="innovic-input"
                      readOnly={locked}
                      {...register(`lines.${idx}.receivedQty` as const, {
                        valueAsNumber: true,
                        min: { value: 0, message: 'Min 0' },
                      })}
                    />
                  </div>

                  <div className="form-grp">
                    <label className="form-label">DC Ref</label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      readOnly={locked}
                      {...register(`lines.${idx}.dcRefNo` as const)}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">QC Status</label>
                    <select
                      className="innovic-select"
                      disabled={locked}
                      {...register(`lines.${idx}.qcStatus` as const)}
                    >
                      {GRN_QC_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-grp">
                    <label className="form-label">QC Accepted</label>
                    <input
                      type="number"
                      min={0}
                      className="innovic-input"
                      readOnly={locked}
                      {...register(`lines.${idx}.qcAcceptedQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>

                  <div className="form-grp">
                    <label className="form-label">QC Rejected</label>
                    <input
                      type="number"
                      min={0}
                      className="innovic-input"
                      readOnly={locked}
                      {...register(`lines.${idx}.qcRejectedQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">QC Date</label>
                    <input
                      type="date"
                      className="innovic-input"
                      readOnly={locked}
                      {...register(`lines.${idx}.qcDate` as const)}
                    />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">QC Remarks</label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      readOnly={locked}
                      {...register(`lines.${idx}.qcRemarks` as const)}
                    />
                  </div>

                  <div className="form-grp form-full">
                    <label className="form-label">Line Remarks</label>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      readOnly={locked}
                      {...register(`lines.${idx}.remarks` as const)}
                    />
                  </div>
                </div>

                {locked ? (
                  <div className="form-help" style={{ marginTop: 4 }}>
                    QC fields are locked once QC is marked complete. To correct a wrong accept,
                    create a reversing GRN line on the same PO.
                  </div>
                ) : null}
              </div>
            );
          })}
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
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create GRN')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: GoodsReceiptNoteDetail): FormValues {
  return {
    header: {
      code: detail.code,
      grnDate: detail.grnDate,
      ...(detail.purchaseOrderId ? { purchaseOrderId: detail.purchaseOrderId } : {}),
      ...(detail.poCodeText ? { poCodeText: detail.poCodeText } : {}),
      ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
      ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
      ...(detail.dcNo ? { dcNo: detail.dcNo } : {}),
      ...(detail.invoiceNo ? { invoiceNo: detail.invoiceNo } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines: detail.lines.map(
      (l): LineFormValue => ({
        id: l.id,
        existingQcStatus: l.qcStatus,
        ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
        ...(l.itemId ? { itemId: l.itemId } : {}),
        itemCodeText: l.itemCodeText ?? '',
        itemName: l.itemName,
        receivedQty: l.receivedQty,
        ...(l.dcRefNo ? { dcRefNo: l.dcRefNo } : {}),
        qcStatus: l.qcStatus,
        qcAcceptedQty: l.qcAcceptedQty,
        qcRejectedQty: l.qcRejectedQty,
        ...(l.qcDate ? { qcDate: l.qcDate } : {}),
        ...(l.qcRemarks ? { qcRemarks: l.qcRemarks } : {}),
        ...(l.remarks ? { remarks: l.remarks } : {}),
      }),
    ),
  };
}
