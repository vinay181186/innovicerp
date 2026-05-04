import {
  type CreateMachineInput,
  type Machine,
  type UpdateMachineInput,
  createMachineInputSchema,
  updateMachineInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const MACHINE_STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateMachineInput>;
  onSubmit: (values: CreateMachineInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  machine: Machine;
  onSubmit: (values: UpdateMachineInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type MachineFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateMachineInput = {
  code: '',
  name: '',
  machineType: undefined,
  capacityPerShift: undefined,
  shiftsPerDay: 1,
  status: 'Idle',
};

function machineToUpdateDefaults(m: Machine): UpdateMachineInput {
  return {
    name: m.name,
    machineType: m.machineType ?? undefined,
    capacityPerShift: m.capacityPerShift ?? undefined,
    shiftsPerDay: m.shiftsPerDay,
    status: m.status,
  };
}

export function MachineForm(props: MachineFormProps) {
  if (props.mode === 'create') return <CreateMachineForm {...props} />;
  return <EditMachineForm {...props} />;
}

function CreateMachineForm(props: CreateMode) {
  const form = useForm<CreateMachineInput>({
    resolver: zodResolver(createMachineInputSchema),
    defaultValues: { ...CREATE_DEFAULTS, ...props.defaultValues },
  });
  const { register, formState } = form;
  const errors = formState.errors;

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <FieldRow>
        <Field label="Code" htmlFor="code" error={errors.code?.message} required>
          <Input id="code" autoFocus autoComplete="off" {...register('code')} />
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Machine type" htmlFor="machineType" error={errors.machineType?.message}>
          <Input id="machineType" autoComplete="off" {...register('machineType')} />
        </Field>
        <Field
          label="Capacity / shift"
          htmlFor="capacityPerShift"
          error={errors.capacityPerShift?.message}
        >
          <Input
            id="capacityPerShift"
            type="number"
            min={0}
            autoComplete="off"
            {...register('capacityPerShift')}
          />
        </Field>
        <Field label="Shifts / day" htmlFor="shiftsPerDay" error={errors.shiftsPerDay?.message}>
          <Input
            id="shiftsPerDay"
            type="number"
            min={1}
            autoComplete="off"
            {...register('shiftsPerDay')}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Status" htmlFor="status" error={errors.status?.message}>
          <Select id="status" {...register('status')}>
            {MACHINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <div />
        <div />
      </FieldRow>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create machine'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditMachineForm(props: EditMode) {
  const form = useForm<UpdateMachineInput>({
    resolver: zodResolver(updateMachineInputSchema),
    defaultValues: machineToUpdateDefaults(props.machine),
  });
  const { register, formState } = form;
  const errors = formState.errors;

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <FieldRow>
        <Field label="Code" htmlFor="code">
          <Input id="code" value={props.machine.code} disabled readOnly />
          <p className="mt-1 text-xs text-muted-foreground">
            Code cannot be changed after creation.
          </p>
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Machine type" htmlFor="machineType" error={errors.machineType?.message}>
          <Input id="machineType" autoComplete="off" {...register('machineType')} />
        </Field>
        <Field
          label="Capacity / shift"
          htmlFor="capacityPerShift"
          error={errors.capacityPerShift?.message}
        >
          <Input
            id="capacityPerShift"
            type="number"
            min={0}
            autoComplete="off"
            {...register('capacityPerShift')}
          />
        </Field>
        <Field label="Shifts / day" htmlFor="shiftsPerDay" error={errors.shiftsPerDay?.message}>
          <Input
            id="shiftsPerDay"
            type="number"
            min={1}
            autoComplete="off"
            {...register('shiftsPerDay')}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Status" htmlFor="status" error={errors.status?.message}>
          <Select id="status" {...register('status')}>
            {MACHINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <div />
        <div />
      </FieldRow>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Save changes'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
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
