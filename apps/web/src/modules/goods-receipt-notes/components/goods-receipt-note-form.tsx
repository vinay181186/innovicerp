// GRN form — header + dynamic line items with inline QC fields.
//
// Mirrors the legacy `addGRN()` line 26515 + `_grnLineRowHtml` layout.
// Per ADR-015 #8, QC fields are inline on each line. Per the T-036c product
// call, once a line is qc_status='completed' on the existing detail, its QC
// inputs lock client-side too (the service rejects edits with ConflictError;
// we just match here so the user knows). Reversal flow: create a new GRN
// line with the same PO line and a "rejecting" qty.
//
// PO selection drives the line auto-populate: when a PO is chosen, the form
// pre-fills lines from PO lines that have remaining qty (qty - received_qty
// > 0), with `receivedQty` defaulting to the remaining and qcStatus=pending.
// User can edit any field before save.

import {
  type CreateGoodsReceiptNoteInput,
  GRN_QC_STATUSES,
  type GoodsReceiptNoteDetail,
  type GrnQcStatus,
  type UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { useVendorsList } from '@/modules/vendors/api';

interface LineFormValue {
  id?: string;
  /** Existing qcStatus on a saved line — drives the lock behavior (read-only
   *  inputs when 'completed'). Absent on new lines. */
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
  /** Optional initial PO id — when present, the form auto-selects this PO and
   *  pre-fills lines from its remaining qty. Used by the "Receive (new GRN)"
   *  link from a PO detail page. */
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

export function GoodsReceiptNoteForm(props: GoodsReceiptNoteFormProps) {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : {
        header: {
          ...HEADER_DEFAULTS,
          ...(props.initialPurchaseOrderId ? { purchaseOrderId: props.initialPurchaseOrderId } : {}),
        },
        lines: [{ ...NEW_LINE }],
      };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  // Open + partial + qc_pending POs are the receivable states; closed +
  // cancelled POs hide from the picker.
  const { data: posData } = usePurchaseOrdersList({ limit: 200, offset: 0 });
  const pos = (posData?.items ?? []).filter((p) =>
    ['draft', 'open', 'partial', 'qc_pending'].includes(p.status),
  );

  // Watch the selected PO id — when it changes (and we're in create mode +
  // there are no user-edited lines yet), pre-populate from PO lines.
  const selectedPoId = useWatch({ control, name: 'header.purchaseOrderId' });
  const { data: selectedPoDetail } = usePurchaseOrder(
    !isEdit && selectedPoId ? selectedPoId : undefined,
  );

  useEffect(() => {
    if (isEdit) return;
    if (!selectedPoDetail) return;
    // Only auto-populate when the lines look pristine (one blank line).
    const cur = getValues('lines');
    const isPristine =
      cur.length === 1 && cur[0]!.itemCodeText === '' && cur[0]!.itemName === '';
    if (!isPristine) return;
    // Inherit vendor from PO if not already set.
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
    <form className="space-y-8" onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Header
        </h3>
        <FieldRow>
          <Field label="GRN No." htmlFor="code" error={errors.header?.code?.message} required>
            <Input
              id="code"
              autoFocus={!isEdit}
              autoComplete="off"
              disabled={isEdit}
              readOnly={isEdit}
              {...register('header.code', { required: !isEdit ? 'GRN No. is required' : false })}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Code cannot be changed after creation.
              </p>
            ) : null}
          </Field>
          <Field label="Date" htmlFor="grnDate" required>
            <Input
              id="grnDate"
              type="date"
              {...register('header.grnDate', { required: 'Date is required' })}
            />
          </Field>
          <Field label="Purchase order" htmlFor="purchaseOrderId">
            <Select
              id="purchaseOrderId"
              {...register('header.purchaseOrderId')}
              disabled={isEdit}
            >
              <option value="">— Free-text PO ref below —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.vendorName ?? p.vendorCodeText ?? '—'}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="PO ref (audit)" htmlFor="poCodeText">
            <Input id="poCodeText" autoComplete="off" {...register('header.poCodeText')} />
          </Field>
          <Field label="Vendor" htmlFor="vendorId">
            <Select id="vendorId" {...register('header.vendorId')}>
              <option value="">— Free-text vendor below —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vendor code (fallback)" htmlFor="vendorCodeText">
            <Input id="vendorCodeText" autoComplete="off" {...register('header.vendorCodeText')} />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="DC No." htmlFor="dcNo">
            <Input id="dcNo" autoComplete="off" {...register('header.dcNo')} />
          </Field>
          <Field label="Invoice No." htmlFor="invoiceNo">
            <Input id="invoiceNo" autoComplete="off" {...register('header.invoiceNo')} />
          </Field>
        </FieldRow>

        <Field label="Remarks" htmlFor="remarks">
          <Textarea id="remarks" rows={2} {...register('header.remarks')} />
        </Field>
      </section>

      {/* Lines */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Line items
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => append({ ...NEW_LINE })}
          >
            <Plus />
            Add line
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
            No lines yet. Pick a PO above to auto-populate, or click <b>Add line</b>.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, idx) => {
              const locked = field.existingQcStatus === 'completed';
              return (
                <div
                  key={field.id}
                  className={`grid grid-cols-12 gap-2 rounded border bg-card p-3 text-card-foreground ${locked ? 'border-green-500/40' : ''}`}
                >
                  <div className="col-span-12 flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>
                      Line {idx + 1}
                      {locked ? (
                        <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green-700 dark:bg-green-900/40 dark:text-green-300">
                          QC locked
                        </span>
                      ) : null}
                    </span>
                    {!locked ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(idx)}
                        aria-label={`Remove line ${idx + 1}`}
                        className="h-7 px-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="col-span-6 md:col-span-3">
                    <Label className="text-xs">Item code</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      {...register(`lines.${idx}.itemCodeText` as const)}
                    />
                  </div>
                  <div className="col-span-6 md:col-span-3">
                    <Label className="text-xs">Item name *</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      {...register(`lines.${idx}.itemName` as const, {
                        required: 'Item name is required',
                      })}
                    />
                    {errors.lines?.[idx]?.itemName?.message ? (
                      <p className="text-xs text-destructive">
                        {errors.lines[idx]?.itemName?.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <Label className="text-xs">Received *</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={locked}
                      {...register(`lines.${idx}.receivedQty` as const, {
                        valueAsNumber: true,
                        min: { value: 0, message: 'Min 0' },
                      })}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <Label className="text-xs">DC ref</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      {...register(`lines.${idx}.dcRefNo` as const)}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-3">
                    <Label className="text-xs">QC status</Label>
                    <Select disabled={locked} {...register(`lines.${idx}.qcStatus` as const)}>
                      {GRN_QC_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <Label className="text-xs">QC accepted</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={locked}
                      {...register(`lines.${idx}.qcAcceptedQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <Label className="text-xs">QC rejected</Label>
                    <Input
                      type="number"
                      min={0}
                      disabled={locked}
                      {...register(`lines.${idx}.qcRejectedQty` as const, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <Label className="text-xs">QC date</Label>
                    <Input
                      type="date"
                      disabled={locked}
                      {...register(`lines.${idx}.qcDate` as const)}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-6">
                    <Label className="text-xs">QC remarks</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      {...register(`lines.${idx}.qcRemarks` as const)}
                    />
                  </div>
                  <div className="col-span-12">
                    <Label className="text-xs">Line remarks</Label>
                    <Input
                      autoComplete="off"
                      disabled={locked}
                      {...register(`lines.${idx}.remarks` as const)}
                    />
                  </div>
                  {locked ? (
                    <p className="col-span-12 text-xs text-muted-foreground">
                      QC fields are locked once QC is marked complete. To correct a wrong accept,
                      create a reversing GRN line on the same PO.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {props.submitError ? (
        <p className="text-sm text-destructive">{props.submitError}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create GRN')}
        </Button>
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
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
    lines: detail.lines.map((l): LineFormValue => ({
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
    })),
  };
}

function FieldRow(props: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{props.children}</div>;
}

function Field(props: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.htmlFor}>
        {props.label}
        {props.required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {props.children}
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
    </div>
  );
}
