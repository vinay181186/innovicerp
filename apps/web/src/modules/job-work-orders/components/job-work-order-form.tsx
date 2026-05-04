// Job Work Order form — header + dynamic line items.
//
// Mirrors the legacy `jwHeaderForm` (line 12784) and `_jwLineRowHtml`
// (line 12692). Differences from SO form:
//   - Header: no GST / type / cost-center / BOM. Status only.
//   - Lines: no rate / clientPoLineNo. Add 4 client-material fields:
//     clientMaterial, clientMaterialQty, materialReceivedDate,
//     materialReceivedQty (legacy form puts these at header level since
//     all current JWs are single-line; our DB stores them per-line for
//     forward-compat with multi-line JWs).
//
// Same content patterns as SO form — see sales-order-form.tsx for the
// shared considerations (hidden itemId preservation, conditional spreads
// for exactOptionalPropertyTypes, etc.).

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
import type { ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useClientsList } from '@/modules/clients/api';

interface LineFormValue {
  id?: string;
  /** Preserved through the form when editing a line whose item resolved to a
   *  real items master row. Hidden value keeps the FK intact when the user
   *  doesn't retype the code. */
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

export function JobWorkOrderForm(props: JobWorkOrderFormProps) {
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
    <form className="space-y-8" onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Header
        </h3>

        <FieldRow>
          <Field label="JW No." htmlFor="code" error={errors.header?.code?.message} required>
            <Input
              id="code"
              autoFocus={!isEdit}
              autoComplete="off"
              disabled={isEdit}
              readOnly={isEdit}
              {...register('header.code', { required: 'JW No. is required' })}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Code cannot be changed after creation.
              </p>
            ) : null}
          </Field>
          <Field label="Date" htmlFor="jwDate" error={errors.header?.jwDate?.message} required>
            <Input
              id="jwDate"
              type="date"
              {...register('header.jwDate', { required: 'Date is required' })}
            />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" {...register('header.status')}>
              {SO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Client" htmlFor="clientId">
            <Select id="clientId" {...register('header.clientId')}>
              <option value="">— Free-text customer below —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Customer name (fallback)" htmlFor="customerName">
            <Input
              id="customerName"
              autoComplete="off"
              placeholder="Required if no client picked"
              {...register('header.customerName')}
            />
          </Field>
          <Field label="Client PO No." htmlFor="clientPoNo">
            <Input id="clientPoNo" autoComplete="off" {...register('header.clientPoNo')} />
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
          <Button type="button" size="sm" variant="outline" onClick={() => append({ ...NEW_LINE })}>
            <Plus />
            Add line
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
            No lines yet. Click <b>Add line</b> — at least one is required.
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

                {/* Row 1: item + part + material + drawing */}
                <div className="col-span-12 md:col-span-3">
                  <Label className="text-xs">Item code</Label>
                  <Input
                    autoComplete="off"
                    placeholder="ITM-001"
                    {...register(`lines.${idx}.itemCodeText` as const)}
                  />
                </div>
                <div className="col-span-12 md:col-span-3">
                  <Label className="text-xs">Part name *</Label>
                  <Input
                    autoComplete="off"
                    {...register(`lines.${idx}.partName` as const, {
                      required: 'Part name is required',
                    })}
                  />
                  {errors.lines?.[idx]?.partName?.message ? (
                    <p className="text-xs text-destructive">
                      {errors.lines[idx]?.partName?.message}
                    </p>
                  ) : null}
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Label className="text-xs">Material</Label>
                  <Input autoComplete="off" {...register(`lines.${idx}.material` as const)} />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Label className="text-xs">Drawing no</Label>
                  <Input autoComplete="off" {...register(`lines.${idx}.drawingNo` as const)} />
                </div>

                {/* Row 2: uom + qty + due date */}
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-xs">UOM</Label>
                  <Select {...register(`lines.${idx}.uom` as const)}>
                    {UOMS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-xs">Qty *</Label>
                  <Input
                    type="number"
                    min={1}
                    {...register(`lines.${idx}.orderQty` as const, {
                      valueAsNumber: true,
                      min: { value: 1, message: 'Min 1' },
                    })}
                  />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <Label className="text-xs">Due date</Label>
                  <Input type="date" {...register(`lines.${idx}.dueDate` as const)} />
                </div>

                {/* Row 3: client-material section (legacy line 12839-12860) */}
                <div className="col-span-12 mt-1 rounded border border-green-700/30 bg-green-700/5 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                    ▸ Client material (party-supplied)
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 md:col-span-4">
                      <Label className="text-xs">Material code</Label>
                      <Input
                        autoComplete="off"
                        placeholder="ITM-001-rm"
                        {...register(`lines.${idx}.clientMaterial` as const)}
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      <Label className="text-xs">Mat. qty</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        {...register(`lines.${idx}.clientMaterialQty` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    <div className="col-span-6 md:col-span-3">
                      <Label className="text-xs">Received date</Label>
                      <Input
                        type="date"
                        {...register(`lines.${idx}.materialReceivedDate` as const)}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <Label className="text-xs">Received qty</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
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
      </section>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? (isEdit ? 'Save changes' : 'Create JW')}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function FormFooter(props: {
  isSubmitting: boolean;
  submitLabel: string;
  submitError: string | null;
  onCancel?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-3">
      {props.submitError ? <p className="text-sm text-destructive">{props.submitError}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={props.isSubmitting}>
          {props.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
