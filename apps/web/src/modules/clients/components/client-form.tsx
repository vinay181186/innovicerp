import {
  type Client,
  type CreateClientInput,
  type UpdateClientInput,
  createClientInputSchema,
  updateClientInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateClientInput>;
  onSubmit: (values: CreateClientInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  client: Client;
  onSubmit: (values: UpdateClientInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type ClientFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateClientInput = {
  code: '',
  name: '',
  contactPerson: undefined,
  email: undefined,
  phone: undefined,
  gstNumber: undefined,
  addressLine1: undefined,
  city: undefined,
  state: undefined,
  pincode: undefined,
  isActive: true,
};

function clientToUpdateDefaults(c: Client): UpdateClientInput {
  return {
    name: c.name,
    contactPerson: c.contactPerson ?? undefined,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    gstNumber: c.gstNumber ?? undefined,
    addressLine1: c.addressLine1 ?? undefined,
    city: c.city ?? undefined,
    state: c.state ?? undefined,
    pincode: c.pincode ?? undefined,
    isActive: c.isActive,
  };
}

export function ClientForm(props: ClientFormProps) {
  if (props.mode === 'create') return <CreateClientForm {...props} />;
  return <EditClientForm {...props} />;
}

function CreateClientForm(props: CreateMode) {
  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientInputSchema),
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
        <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}>
          <Input id="contactPerson" autoComplete="off" {...register('contactPerson')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="off" {...register('email')} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" autoComplete="off" {...register('phone')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="GST number" htmlFor="gstNumber" error={errors.gstNumber?.message}>
          <Input id="gstNumber" autoComplete="off" {...register('gstNumber')} />
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
        <div />
      </FieldRow>

      <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1?.message}>
        <Textarea id="addressLine1" rows={2} {...register('addressLine1')} />
      </Field>

      <FieldRow>
        <Field label="City" htmlFor="city" error={errors.city?.message}>
          <Input id="city" autoComplete="off" {...register('city')} />
        </Field>
        <Field label="State" htmlFor="state" error={errors.state?.message}>
          <Input id="state" autoComplete="off" {...register('state')} />
        </Field>
        <Field label="Pincode" htmlFor="pincode" error={errors.pincode?.message}>
          <Input id="pincode" autoComplete="off" {...register('pincode')} />
        </Field>
      </FieldRow>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create client'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditClientForm(props: EditMode) {
  const form = useForm<UpdateClientInput>({
    resolver: zodResolver(updateClientInputSchema),
    defaultValues: clientToUpdateDefaults(props.client),
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
          <Input id="code" value={props.client.code} disabled readOnly />
          <p className="mt-1 text-xs text-muted-foreground">Code cannot be changed after creation.</p>
        </Field>
        <Field label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="off" {...register('name')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}>
          <Input id="contactPerson" autoComplete="off" {...register('contactPerson')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="off" {...register('email')} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" autoComplete="off" {...register('phone')} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="GST number" htmlFor="gstNumber" error={errors.gstNumber?.message}>
          <Input id="gstNumber" autoComplete="off" {...register('gstNumber')} />
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
        <div />
      </FieldRow>

      <Field label="Address" htmlFor="addressLine1" error={errors.addressLine1?.message}>
        <Textarea id="addressLine1" rows={2} {...register('addressLine1')} />
      </Field>

      <FieldRow>
        <Field label="City" htmlFor="city" error={errors.city?.message}>
          <Input id="city" autoComplete="off" {...register('city')} />
        </Field>
        <Field label="State" htmlFor="state" error={errors.state?.message}>
          <Input id="state" autoComplete="off" {...register('state')} />
        </Field>
        <Field label="Pincode" htmlFor="pincode" error={errors.pincode?.message}>
          <Input id="pincode" autoComplete="off" {...register('pincode')} />
        </Field>
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
