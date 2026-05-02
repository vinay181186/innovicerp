// Purchase Order form — header + dynamic line items.
//
// Mirrors the legacy `_getPoBaseData()` line 25717 / `addPO()` line 25728
// layout: header fields (vendor + tax) at top, lines as a sub-grid with
// "Add line" / "Remove" controls. Per ADR-012 #10, the form collects
// `vendorCodeText` as a free-text fallback alongside the vendor picker, and
// `itemCodeText` per line as a free-text fallback. The API service resolves
// itemCodeText → itemId and preserves the text when no master item matches.

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
import type { ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useVendorsList } from '@/modules/vendors/api';

interface LineFormValue {
  id?: string;
  /** Hidden — preserved when editing so the FK survives a header-only save
   *  (mirror of SO form pattern). The visible field is `itemCodeText`. */
  itemId?: string;
  itemCodeText: string;
  itemName: string;
  qty: number;
  rate: number;
  /** Display-only on edit; never written via this form. */
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

export function PurchaseOrderForm(props: PurchaseOrderFormProps) {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState } = form;
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

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
        // receivedQty deliberately omitted — service ignores it on update path.
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
    <form className="space-y-8" onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Header
        </h3>
        <FieldRow>
          <Field label="PO No." htmlFor="code" error={errors.header?.code?.message} required>
            <Input
              id="code"
              autoFocus={!isEdit}
              autoComplete="off"
              disabled={isEdit}
              readOnly={isEdit}
              {...register('header.code', { required: !isEdit ? 'PO No. is required' : false })}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Code cannot be changed after creation.
              </p>
            ) : null}
          </Field>
          <Field label="Date" htmlFor="poDate" required>
            <Input
              id="poDate"
              type="date"
              {...register('header.poDate', { required: 'Date is required' })}
            />
          </Field>
          <Field label="Type" htmlFor="poType">
            <Select id="poType" {...register('header.poType')}>
              {PO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Status" htmlFor="status">
            <Select id="status" {...register('header.status')}>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="dueDate">
            <Input id="dueDate" type="date" {...register('header.dueDate')} />
          </Field>
          <Field label="PR ref (audit)" htmlFor="prCodeText">
            <Input
              id="prCodeText"
              autoComplete="off"
              placeholder="PR-NNNNN (when applicable)"
              {...register('header.prCodeText')}
            />
          </Field>
        </FieldRow>

        <FieldRow>
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
            <Input
              id="vendorCodeText"
              autoComplete="off"
              placeholder="Required if no vendor picked"
              {...register('header.vendorCodeText')}
            />
          </Field>
          <Field label="Tax type" htmlFor="taxType">
            <Select id="taxType" {...register('header.taxType')}>
              <option value="">— None —</option>
              <option value="sgst_cgst">SGST + CGST</option>
              <option value="igst">IGST</option>
              <option value="none">None</option>
            </Select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="SGST %" htmlFor="sgstPct">
            <Input
              id="sgstPct"
              type="number"
              step="0.01"
              min={0}
              {...register('header.sgstPct', { valueAsNumber: true })}
            />
          </Field>
          <Field label="CGST %" htmlFor="cgstPct">
            <Input
              id="cgstPct"
              type="number"
              step="0.01"
              min={0}
              {...register('header.cgstPct', { valueAsNumber: true })}
            />
          </Field>
          <Field label="IGST %" htmlFor="igstPct">
            <Input
              id="igstPct"
              type="number"
              step="0.01"
              min={0}
              {...register('header.igstPct', { valueAsNumber: true })}
            />
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
            No lines yet. Click <b>Add line</b> to add one (required).
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, idx) => (
              <div
                key={field.id}
                className="grid grid-cols-12 gap-2 rounded border bg-card p-3 text-card-foreground"
              >
                <div className="col-span-12 flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Line {idx + 1}</span>
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
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Label className="text-xs">Item code</Label>
                  <Input
                    autoComplete="off"
                    placeholder="ITM-001"
                    {...register(`lines.${idx}.itemCodeText` as const)}
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Label className="text-xs">Item name *</Label>
                  <Input
                    autoComplete="off"
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
                  <Label className="text-xs">Qty *</Label>
                  <Input
                    type="number"
                    min={1}
                    {...register(`lines.${idx}.qty` as const, {
                      valueAsNumber: true,
                      min: { value: 1, message: 'Min 1' },
                    })}
                  />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-xs">Rate (₹)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                  />
                </div>
                {isEdit ? (
                  <div className="col-span-4 md:col-span-1">
                    <Label className="text-xs">Received</Label>
                    <Input
                      type="number"
                      readOnly
                      disabled
                      title="Received qty is mutated only by GRN cascade (T-036c)"
                      value={field.receivedQty ?? 0}
                    />
                  </div>
                ) : null}
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-xs">Due date</Label>
                  <Input type="date" {...register(`lines.${idx}.dueDate` as const)} />
                </div>
                <div className="col-span-12">
                  <Label className="text-xs">Line remarks</Label>
                  <Input
                    autoComplete="off"
                    {...register(`lines.${idx}.lineRemarks` as const)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {props.submitError ? (
        <p className="text-sm text-destructive">{props.submitError}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create PO')}
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
    lines: detail.lines.map((l): LineFormValue => ({
      id: l.id,
      ...(l.itemId ? { itemId: l.itemId } : {}),
      itemCodeText: l.itemCodeText ?? '',
      itemName: l.itemName,
      qty: l.qty,
      rate: Number(l.rate),
      receivedQty: l.receivedQty,
      ...(l.dueDate ? { dueDate: l.dueDate } : {}),
      ...(l.lineRemarks ? { lineRemarks: l.lineRemarks } : {}),
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
