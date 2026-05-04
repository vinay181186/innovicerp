// Purchase Request form — single-row entity (ADR-015 #2). Mirrors the legacy
// `addPR()` / "Plan → PR" outsource flow but greatly simplified for T-036a:
// no JC-op or SO-line picker yet — those source links carry through from
// migration data and stay read-only on edit until the cascade UX (T-036b/c)
// makes them useful to set by hand. Source link display is on the detail
// page; the form keeps `sourceJcOpId` and `sourceSoLineId` as hidden values
// when editing so they survive a header-only save.

import {
  type CreatePurchaseRequestInput,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequest,
  type UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useVendorsList } from '@/modules/vendors/api';

interface FormValues {
  code: string;
  prDate: string;
  status: PrStatus;
  vendorId?: string;
  vendorCodeText?: string;
  itemId?: string;
  itemCodeText?: string;
  itemName?: string;
  qty: number;
  estCost: number;
  requiredDate?: string;
  operation?: string;
  remarks?: string;
}

const DEFAULTS: FormValues = {
  code: '',
  prDate: new Date().toISOString().slice(0, 10),
  status: 'open',
  qty: 1,
  estCost: 0,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: PurchaseRequest;
  onSubmit: (values: UpdatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type PurchaseRequestFormProps = CreateMode | EditMode;

export function PurchaseRequestForm(props: PurchaseRequestFormProps) {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  const onValid = async (values: FormValues): Promise<void> => {
    // Resolution priority: if user typed an itemCode, send it as itemCodeText
    // (server resolves to itemId or preserves text per ADR-012 #10). If left
    // blank but we have a preserved itemId from the original detail, send the
    // itemId so the FK is kept intact. Same pattern for vendor.
    const trimmedItemCode = values.itemCodeText?.trim();
    const itemRefs: { itemId?: string; itemCodeText?: string } = trimmedItemCode
      ? { itemCodeText: trimmedItemCode }
      : values.itemId
        ? { itemId: values.itemId }
        : {};

    const payload = {
      prDate: values.prDate,
      status: values.status,
      ...(values.vendorId
        ? { vendorId: values.vendorId }
        : values.vendorCodeText?.trim()
          ? { vendorCodeText: values.vendorCodeText.trim() }
          : {}),
      ...itemRefs,
      itemName: values.itemName?.trim() || undefined,
      qty: Number(values.qty),
      estCost: Number(values.estCost),
      requiredDate: values.requiredDate || undefined,
      operation: values.operation?.trim() || undefined,
      remarks: values.remarks?.trim() || undefined,
    };

    if (isEdit) {
      await props.onSubmit(payload);
    } else {
      await props.onSubmit({ code: values.code.trim(), ...payload } as CreatePurchaseRequestInput);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onValid)}>
      <FieldRow>
        <Field label="PR No." htmlFor="code" error={errors.code?.message} required>
          <Input
            id="code"
            autoFocus={!isEdit}
            autoComplete="off"
            disabled={isEdit}
            readOnly={isEdit}
            {...register('code', { required: !isEdit ? 'PR No. is required' : false })}
          />
          {isEdit ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Code cannot be changed after creation.
            </p>
          ) : null}
        </Field>
        <Field label="Date" htmlFor="prDate" error={errors.prDate?.message} required>
          <Input
            id="prDate"
            type="date"
            {...register('prDate', { required: 'Date is required' })}
          />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" {...register('status')}>
            {PR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Vendor" htmlFor="vendorId">
          <Select id="vendorId" {...register('vendorId')}>
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
            {...register('vendorCodeText')}
          />
        </Field>
        <Field label="Required date" htmlFor="requiredDate">
          <Input id="requiredDate" type="date" {...register('requiredDate')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Item code" htmlFor="itemCodeText">
          <Input
            id="itemCodeText"
            autoComplete="off"
            placeholder="ITM-001"
            {...register('itemCodeText')}
          />
        </Field>
        <Field label="Item name (snapshot)" htmlFor="itemName">
          <Input id="itemName" autoComplete="off" {...register('itemName')} />
        </Field>
        <Field label="Operation" htmlFor="operation">
          <Input
            id="operation"
            autoComplete="off"
            placeholder="COATING / TURN / …"
            {...register('operation')}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Qty" htmlFor="qty" required>
          <Input
            id="qty"
            type="number"
            min={1}
            {...register('qty', {
              valueAsNumber: true,
              min: { value: 1, message: 'Min 1' },
            })}
          />
          {errors.qty?.message ? (
            <p className="text-sm text-destructive">{errors.qty.message}</p>
          ) : null}
        </Field>
        <Field label="Estimated cost (₹)" htmlFor="estCost">
          <Input
            id="estCost"
            type="number"
            step="0.01"
            min={0}
            {...register('estCost', { valueAsNumber: true })}
          />
        </Field>
      </FieldRow>

      <Field label="Remarks" htmlFor="remarks">
        <Textarea id="remarks" rows={3} {...register('remarks')} />
      </Field>

      {props.submitError ? <p className="text-sm text-destructive">{props.submitError}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create PR')}
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

function detailToFormValues(detail: PurchaseRequest): FormValues {
  return {
    code: detail.code,
    prDate: detail.prDate,
    status: detail.status,
    ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
    ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
    ...(detail.itemId ? { itemId: detail.itemId } : {}),
    ...(detail.itemCodeText ? { itemCodeText: detail.itemCodeText } : {}),
    ...(detail.itemName ? { itemName: detail.itemName } : {}),
    qty: detail.qty,
    estCost: Number(detail.estCost),
    ...(detail.requiredDate ? { requiredDate: detail.requiredDate } : {}),
    ...(detail.operation ? { operation: detail.operation } : {}),
    ...(detail.remarks ? { remarks: detail.remarks } : {}),
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
