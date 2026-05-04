// NC create + light-edit form (T-040a). Mirrors the legacy `_addManualNC`
// modal (legacy line 22565) — JC + item + rejectedQty + reasonCategory + free
// text reason. The disposition workflow (rework / scrap / use as is / return
// to vendor / make fresh) lives in T-040b alongside the cascade service. This
// form NEVER touches disposition fields.
//
// Edit mode is restricted to date / reason / reportedBy fields and the
// service blocks the path once status leaves 'pending', so the edit form
// hides everything else.

import {
  type CreateNcRegisterInput,
  NC_REASON_CATEGORIES,
  type NcReasonCategory,
  type NcRegister,
  type UpdateNcRegisterInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useItemsList } from '@/modules/items/api';
import { useJobCardsList } from '@/modules/job-cards/api';

interface FormValues {
  code: string;
  ncDate: string;
  jobCardId: string;
  jcOpId?: string;
  opSeq?: number;
  operationText?: string;
  qcOperationText?: string;
  itemId: string;
  itemNameText?: string;
  soCodeText?: string;
  machineCodeText?: string;
  rejectedQty: number;
  reasonCategory: NcReasonCategory;
  reason?: string;
  reportedByText?: string;
}

const DEFAULTS: FormValues = {
  code: '',
  ncDate: new Date().toISOString().slice(0, 10),
  jobCardId: '',
  itemId: '',
  rejectedQty: 1,
  reasonCategory: 'other',
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateNcRegisterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: NcRegister;
  onSubmit: (values: UpdateNcRegisterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type NcRegisterFormProps = CreateMode | EditMode;

export function NcRegisterForm(props: NcRegisterFormProps) {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errors = formState.errors;

  // JC picker drives the form's "current" JC — selecting one auto-fills
  // itemId from the JC's snapshot.
  const { data: jcData } = useJobCardsList({ limit: 200, offset: 0 });
  const jcs = jcData?.items ?? [];

  const { data: itemsData } = useItemsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];

  const selectedJcId = watch('jobCardId');

  useEffect(() => {
    if (isEdit) return;
    if (!selectedJcId) return;
    const jc = jcs.find((j) => j.id === selectedJcId);
    if (jc?.itemId) {
      setValue('itemId', jc.itemId, { shouldDirty: true });
      if (jc.itemName) {
        setValue('itemNameText', jc.itemName, { shouldDirty: true });
      }
    }
  }, [selectedJcId, isEdit, jcs, setValue]);

  const onValid = async (values: FormValues): Promise<void> => {
    if (isEdit) {
      const payload: UpdateNcRegisterInput = {
        ncDate: values.ncDate,
        reasonCategory: values.reasonCategory,
        reason: values.reason?.trim() || undefined,
        reportedByText: values.reportedByText?.trim() || undefined,
      };
      await props.onSubmit(payload);
    } else {
      const payload: CreateNcRegisterInput = {
        code: values.code.trim(),
        ncDate: values.ncDate,
        jobCardId: values.jobCardId,
        ...(values.jcOpId ? { jcOpId: values.jcOpId } : {}),
        ...(values.opSeq != null && !Number.isNaN(values.opSeq) ? { opSeq: Number(values.opSeq) } : {}),
        ...(values.operationText?.trim() ? { operationText: values.operationText.trim() } : {}),
        ...(values.qcOperationText?.trim()
          ? { qcOperationText: values.qcOperationText.trim() }
          : {}),
        itemId: values.itemId,
        ...(values.itemNameText?.trim() ? { itemNameText: values.itemNameText.trim() } : {}),
        ...(values.soCodeText?.trim() ? { soCodeText: values.soCodeText.trim() } : {}),
        ...(values.machineCodeText?.trim()
          ? { machineCodeText: values.machineCodeText.trim() }
          : {}),
        rejectedQty: Number(values.rejectedQty),
        reasonCategory: values.reasonCategory,
        ...(values.reason?.trim() ? { reason: values.reason.trim() } : {}),
        ...(values.reportedByText?.trim()
          ? { reportedByText: values.reportedByText.trim() }
          : {}),
      };
      await props.onSubmit(payload);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onValid)}>
      <FieldRow>
        <Field label="NC No." htmlFor="code" error={errors.code?.message} required>
          <Input
            id="code"
            autoFocus={!isEdit}
            autoComplete="off"
            disabled={isEdit}
            readOnly={isEdit}
            placeholder="NC-0010"
            {...register('code', { required: !isEdit ? 'NC No. is required' : false })}
          />
          {isEdit ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Code cannot be changed after creation.
            </p>
          ) : null}
        </Field>
        <Field label="Date" htmlFor="ncDate" error={errors.ncDate?.message} required>
          <Input
            id="ncDate"
            type="date"
            {...register('ncDate', { required: 'Date is required' })}
          />
        </Field>
        <Field label="Reported by" htmlFor="reportedByText">
          <Input
            id="reportedByText"
            autoComplete="off"
            placeholder="Operator name (snapshot)"
            {...register('reportedByText')}
          />
        </Field>
      </FieldRow>

      {!isEdit ? (
        <FieldRow>
          <Field label="Job card" htmlFor="jobCardId" required>
            <Select
              id="jobCardId"
              {...register('jobCardId', { required: 'Job card is required' })}
            >
              <option value="">— Pick a JC —</option>
              {jcs.map((jc) => (
                <option key={jc.id} value={jc.id}>
                  {jc.code} — {jc.itemCode} {jc.itemName}
                </option>
              ))}
            </Select>
            {errors.jobCardId?.message ? (
              <p className="text-sm text-destructive">{errors.jobCardId.message}</p>
            ) : null}
          </Field>
          <Field label="Item" htmlFor="itemId" required>
            <Select
              id="itemId"
              {...register('itemId', { required: 'Item is required' })}
            >
              <option value="">— Auto-fills from JC —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} — {it.name}
                </option>
              ))}
            </Select>
            {errors.itemId?.message ? (
              <p className="text-sm text-destructive">{errors.itemId.message}</p>
            ) : null}
          </Field>
          <Field label="SO No. (snapshot)" htmlFor="soCodeText">
            <Input
              id="soCodeText"
              autoComplete="off"
              placeholder="SO-436"
              {...register('soCodeText')}
            />
          </Field>
        </FieldRow>
      ) : null}

      {!isEdit ? (
        <FieldRow>
          <Field label="Op seq" htmlFor="opSeq">
            <Input
              id="opSeq"
              type="number"
              min={1}
              {...register('opSeq', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Operation" htmlFor="operationText">
            <Input
              id="operationText"
              autoComplete="off"
              placeholder="DIR / TURN / S1"
              {...register('operationText')}
            />
          </Field>
          <Field label="Machine" htmlFor="machineCodeText">
            <Input
              id="machineCodeText"
              autoComplete="off"
              placeholder="QC / M-001"
              {...register('machineCodeText')}
            />
          </Field>
        </FieldRow>
      ) : null}

      <FieldRow>
        {!isEdit ? (
          <Field label="Rejected qty" htmlFor="rejectedQty" required>
            <Input
              id="rejectedQty"
              type="number"
              min={1}
              step="0.01"
              {...register('rejectedQty', {
                valueAsNumber: true,
                min: { value: 0.01, message: 'Must be > 0' },
              })}
            />
            {errors.rejectedQty?.message ? (
              <p className="text-sm text-destructive">{errors.rejectedQty.message}</p>
            ) : null}
          </Field>
        ) : null}
        <Field label="Reason category" htmlFor="reasonCategory">
          <Select id="reasonCategory" {...register('reasonCategory')}>
            {NC_REASON_CATEGORIES.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      <Field label="Defect description" htmlFor="reason">
        <Textarea
          id="reason"
          rows={3}
          placeholder="Describe the defect or problem in detail…"
          {...register('reason')}
        />
      </Field>

      {props.submitError ? (
        <p className="text-sm text-destructive">{props.submitError}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {props.submitLabel ?? (isEdit ? 'Save changes' : 'Report NC')}
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

function detailToFormValues(detail: NcRegister): FormValues {
  return {
    code: detail.code,
    ncDate: detail.ncDate,
    jobCardId: detail.jobCardId,
    ...(detail.jcOpId ? { jcOpId: detail.jcOpId } : {}),
    ...(detail.opSeq != null ? { opSeq: detail.opSeq } : {}),
    ...(detail.operationText ? { operationText: detail.operationText } : {}),
    ...(detail.qcOperationText ? { qcOperationText: detail.qcOperationText } : {}),
    itemId: detail.itemId,
    ...(detail.itemNameText ? { itemNameText: detail.itemNameText } : {}),
    ...(detail.soCodeText ? { soCodeText: detail.soCodeText } : {}),
    ...(detail.machineCodeText ? { machineCodeText: detail.machineCodeText } : {}),
    rejectedQty: Number(detail.rejectedQty),
    reasonCategory: detail.reasonCategory,
    ...(detail.reason ? { reason: detail.reason } : {}),
    ...(detail.reportedByText ? { reportedByText: detail.reportedByText } : {}),
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
