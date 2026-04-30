import {
  type CreateOperatorInput,
  type Operator,
  type UpdateOperatorInput,
  createOperatorInputSchema,
  updateOperatorInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateOperatorInput>;
  onSubmit: (values: CreateOperatorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  operator: Operator;
  onSubmit: (values: UpdateOperatorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type OperatorFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateOperatorInput = {
  code: '',
  name: '',
  department: undefined,
  skills: undefined,
  isActive: true,
  userId: undefined,
};

function operatorToUpdateDefaults(o: Operator): UpdateOperatorInput {
  return {
    name: o.name,
    department: o.department ?? undefined,
    skills: o.skills ?? undefined,
    isActive: o.isActive,
    userId: o.userId ?? undefined,
  };
}

export function OperatorForm(props: OperatorFormProps) {
  if (props.mode === 'create') return <CreateOperatorForm {...props} />;
  return <EditOperatorForm {...props} />;
}

function CreateOperatorForm(props: CreateMode) {
  const form = useForm<CreateOperatorInput>({
    resolver: zodResolver(createOperatorInputSchema),
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
        <Field label="Operator ID" htmlFor="code" error={errors.code?.message} required>
          <Input id="code" autoFocus autoComplete="off" placeholder="OP-001" {...register('code')} />
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" placeholder="Full name" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Department" htmlFor="department" error={errors.department?.message}>
          <Input
            id="department"
            autoComplete="off"
            placeholder="CNC Turning, Grinding…"
            {...register('department')}
          />
        </Field>
        <Field label="Status" htmlFor="isActive" error={errors.isActive?.message}>
          <Select
            id="isActive"
            {...register('isActive', {
              setValueAs: (v: string | boolean) => (typeof v === 'string' ? v === 'true' : v),
            })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
      </FieldRow>

      <Field label="Skills / Machines" htmlFor="skills" error={errors.skills?.message}>
        <Input
          id="skills"
          autoComplete="off"
          placeholder="CNC-01, VMC-01, GR-01…"
          {...register('skills')}
        />
      </Field>

      <Field label="Linked user (optional)" htmlFor="userId" error={errors.userId?.message}>
        <Input
          id="userId"
          autoComplete="off"
          placeholder="UUID of a user account, if this operator also has a login"
          {...register('userId')}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Leave blank for shop-floor-only operators.
        </p>
      </Field>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create operator'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditOperatorForm(props: EditMode) {
  const form = useForm<UpdateOperatorInput>({
    resolver: zodResolver(updateOperatorInputSchema),
    defaultValues: operatorToUpdateDefaults(props.operator),
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
        <Field label="Operator ID" htmlFor="code">
          <Input id="code" value={props.operator.code} disabled readOnly />
          <p className="mt-1 text-xs text-muted-foreground">
            Operator ID cannot be changed after creation.
          </p>
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Department" htmlFor="department" error={errors.department?.message}>
          <Input
            id="department"
            autoComplete="off"
            placeholder="CNC Turning, Grinding…"
            {...register('department')}
          />
        </Field>
        <Field label="Status" htmlFor="isActive" error={errors.isActive?.message}>
          <Select
            id="isActive"
            {...register('isActive', {
              setValueAs: (v: string | boolean) => (typeof v === 'string' ? v === 'true' : v),
            })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
      </FieldRow>

      <Field label="Skills / Machines" htmlFor="skills" error={errors.skills?.message}>
        <Input
          id="skills"
          autoComplete="off"
          placeholder="CNC-01, VMC-01, GR-01…"
          {...register('skills')}
        />
      </Field>

      <Field label="Linked user (optional)" htmlFor="userId" error={errors.userId?.message}>
        <Input
          id="userId"
          autoComplete="off"
          placeholder="UUID of a user account, if this operator also has a login"
          {...register('userId')}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Leave blank for shop-floor-only operators.
        </p>
      </Field>

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
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{props.children}</div>;
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
