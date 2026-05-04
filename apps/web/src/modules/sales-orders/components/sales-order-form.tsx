// Sales Order form — header + dynamic line items.
//
// Mirrors the legacy `soHeaderForm` (line 12183) and `_soLineRowHtml`
// (line 11985) layout: header fields at top, lines as a sub-grid with
// "Add line" / "Remove" controls. Per ADR-012 #9/#10, the form collects
// `customerName` as a free-text fallback alongside the client picker, and
// `itemCodeText` per line as a free-text fallback alongside the future
// item picker. The API service resolves itemCodeText → itemId and
// preserves the text when no master item matches.

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
import type { ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useClientsList } from '@/modules/clients/api';

// ─── Form values ───────────────────────────────────────────────────────────
//
// One shape covers both create + edit. `id` on a line is set when the line
// already exists (edit mode); absent for newly-added lines. The header `code`
// is shown disabled in edit mode but kept in the values so we don't need a
// separate type.

interface LineFormValue {
  /** Existing line id (edit mode). Absent on new lines. */
  id?: string;
  /** Preserved through the form when editing a line whose item resolved to a
   *  real items master row. The user-visible field is `itemCodeText`; this
   *  hidden value keeps the FK intact when the user doesn't retype the code. */
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

// ─── Public component ─────────────────────────────────────────────────────

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

export function SalesOrderForm(props: SalesOrderFormProps) {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch } = form;
  const errors = formState.errors;

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // Clients list for header picker. 200 is a safe ceiling at current scale.
  const { data: clientsData } = useClientsList({ limit: 200, offset: 0 });
  const clients = clientsData?.clients ?? [];

  const headerType = watch('header.type');

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      // Trim string fields that may be empty.
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
      // Resolution priority: if the user typed a code, send it as itemCodeText
      // (service re-resolves to itemId or preserves text per ADR-012 #10). If
      // they left the code blank but we have a preserved itemId from the
      // original detail, send the itemId so the FK is kept intact.
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
    <form className="space-y-8" onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Header
        </h3>

        <FieldRow>
          <Field label="SO/WO No." htmlFor="code" error={errors.header?.code?.message} required>
            <Input
              id="code"
              autoFocus={!isEdit}
              autoComplete="off"
              disabled={isEdit}
              readOnly={isEdit}
              {...register('header.code', { required: 'SO/WO No. is required' })}
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Code cannot be changed after creation.
              </p>
            ) : null}
          </Field>
          <Field label="Date" htmlFor="soDate" error={errors.header?.soDate?.message} required>
            <Input
              id="soDate"
              type="date"
              {...register('header.soDate', { required: 'Date is required' })}
            />
          </Field>
          <Field label="Type" htmlFor="type">
            <Select id="type" {...register('header.type')}>
              {SO_TYPES.map((t) => (
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
              {SO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="GST %" htmlFor="gstPercent">
            <Select id="gstPercent" {...register('header.gstPercent', { valueAsNumber: true })}>
              {[0, 5, 12, 18, 28].map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cost center" htmlFor="costCenter">
            <Input id="costCenter" autoComplete="off" {...register('header.costCenter')} />
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

        {headerType === 'equipment' ? (
          <FieldRow>
            <Field label="BOM master id (forward)" htmlFor="bomMasterId">
              <Input id="bomMasterId" autoComplete="off" {...register('header.bomMasterId')} />
            </Field>
            <Field label="BOM status" htmlFor="bomStatus">
              <Input id="bomStatus" autoComplete="off" {...register('header.bomStatus')} />
            </Field>
          </FieldRow>
        ) : null}

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
            No lines yet. Equipment SOs can be saved without lines (BOM expansion lands later);
            otherwise click <b>Add line</b>.
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
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-xs">Material</Label>
                  <Input autoComplete="off" {...register(`lines.${idx}.material` as const)} />
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-xs">Drawing no</Label>
                  <Input autoComplete="off" {...register(`lines.${idx}.drawingNo` as const)} />
                </div>
                <div className="col-span-4 md:col-span-1">
                  <Label className="text-xs">UOM</Label>
                  <Select {...register(`lines.${idx}.uom` as const)}>
                    {UOMS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-1">
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
                <div className="col-span-4 md:col-span-1">
                  <Label className="text-xs">Rate</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                  />
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-xs">Due date</Label>
                  <Input type="date" {...register(`lines.${idx}.dueDate` as const)} />
                </div>
                <div className="col-span-6 md:col-span-2">
                  <Label className="text-xs">Client PO line</Label>
                  <Input autoComplete="off" {...register(`lines.${idx}.clientPoLineNo` as const)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? (isEdit ? 'Save changes' : 'Create SO')}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
    // Preserve `itemId` so the FK survives a header-only edit. Display field
    // (`itemCodeText`) shows the raw text fallback when the FK didn't resolve
    // at migration time; otherwise blank — user can retype to reassign.
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
