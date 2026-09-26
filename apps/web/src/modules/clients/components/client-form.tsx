// Client create + edit form (UI-003-03). Field order matches legacy
// clientForm (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L12996),
// which addClient (L13006) and editClient (L13018) both render: Code,
// Name (full), Address (full), Contact Person, Email. Extends legacy with
// Phone, GST, City/State/Pincode, Status (from current shared schema).
// Legacy marks Client Code required (user-typed, uniqueness-checked); here
// code is auto-generated server-side and is optional in the shared schema,
// so it carries no req marker.
//
// Create-page pattern (2026-09-26): the form owns a sticky PageHeader with
// Cancel + the blue Save top-right (Ctrl+S runs the same Save), and the
// fields sit in four sections on the 12-column grid — Identity · Address ·
// Contact · Terms. Same fields, same schema, same submit as before.

import {
  type Client,
  type CreateClientInput,
  type UpdateClientInput,
  createClientInputSchema,
  updateClientInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { type FieldErrors, type UseFormRegister, useForm } from 'react-hook-form';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useNextClientCode } from '../api';

/** The page band the form draws: title, quiet line under it, where Back goes. */
export interface ClientFormHeader {
  title: string;
  subtitle?: ReactNode | undefined;
  backLabel: string;
}

type CreateMode = {
  mode: 'create';
  header: ClientFormHeader;
  defaultValues?: Partial<CreateClientInput>;
  onSubmit: (values: CreateClientInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel: () => void;
};

type EditMode = {
  mode: 'edit';
  header: ClientFormHeader;
  client: Client;
  onSubmit: (values: UpdateClientInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel: () => void;
};

type ClientFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateClientInput = {
  // Code is auto-generated server-side; never seed an empty string (it would
  // fail the schema's min-length check). Leave it undefined.
  code: undefined,
  name: '',
  contactPerson: undefined,
  email: undefined,
  phone: undefined,
  gstNumber: undefined,
  addressLine1: undefined,
  city: undefined,
  state: undefined,
  pincode: undefined,
  paymentDays: null,
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
    paymentDays: c.paymentDays ?? null,
    isActive: c.isActive,
  };
}

export function ClientForm(props: ClientFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateClientForm {...props} />;
  return <EditClientForm {...props} />;
}

function CreateClientForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientInputSchema),
    defaultValues: { ...CREATE_DEFAULTS, ...props.defaultValues },
  });
  const { register, formState } = form;
  const errors = formState.errors;

  // Prefill the read-only code with the next server-assigned CLI-### so it is
  // visible before save. Only seed while still blank (don't clobber edits).
  const { data: nextCode } = useNextClientCode();
  useEffect(() => {
    if (nextCode?.code && !form.getValues('code')) {
      form.setValue('code', nextCode.code);
    }
  }, [nextCode, form]);

  return (
    <ClientFormShell
      header={props.header}
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
      isSubmitting={formState.isSubmitting}
      dirty={formState.isDirty}
      submitLabel={props.submitLabel ?? 'Save Customer'}
      submitError={props.submitError ?? null}
      onCancel={props.onCancel}
    >
      <ClientFields
        // Both forms carry the same fields with the same types; the union of
        // the two register functions is not callable as-is, so narrow to one.
        register={register as unknown as UseFormRegister<UpdateClientInput>}
        errors={errors as unknown as FieldErrors<UpdateClientInput>}
        autoFocusName
        codeField={
          <FormField label="Code" size="sm" htmlFor="code" error={errors.code?.message}>
            <input
              id="code"
              className="innovic-input"
              readOnly
              autoComplete="off"
              placeholder="Auto-generated on save"
              {...register('code', {
                // The field is read-only and auto-generated server-side. RHF reads
                // the empty DOM value back as "" on submit, which fails the schema's
                // min(1); coerce blank → undefined so `code` is omitted (optional).
                setValueAs: (v: string) =>
                  typeof v === 'string' && v.trim() ? v.trim() : undefined,
              })}
            />
          </FormField>
        }
      />
    </ClientFormShell>
  );
}

function EditClientForm(props: EditMode): React.JSX.Element {
  const form = useForm<UpdateClientInput>({
    resolver: zodResolver(updateClientInputSchema),
    defaultValues: clientToUpdateDefaults(props.client),
  });
  const { register, formState } = form;
  const errors = formState.errors;

  return (
    <ClientFormShell
      header={props.header}
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
      isSubmitting={formState.isSubmitting}
      dirty={formState.isDirty}
      submitLabel={props.submitLabel ?? 'Save Changes'}
      submitError={props.submitError ?? null}
      onCancel={props.onCancel}
    >
      <ClientFields
        register={register}
        errors={errors}
        codeField={
          <FormField
            label="Code"
            size="sm"
            htmlFor="code"
            help="Code cannot be changed after creation."
          >
            <input id="code" className="innovic-input" value={props.client.code} readOnly />
          </FormField>
        }
      />
    </ClientFormShell>
  );
}

/** The page: sticky header (Cancel + blue Save, Ctrl+S), the save error right
 *  under it, then the sections. The header's Save is a real submit button of
 *  this form, so Enter, the button and Ctrl+S all run the one handleSubmit. */
function ClientFormShell(props: {
  header: ClientFormHeader;
  onSubmit: (e?: React.BaseSyntheticEvent) => Promise<void>;
  isSubmitting: boolean;
  dirty: boolean;
  submitLabel: string;
  submitError: string | null;
  onCancel: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const runSave = useCallback(() => formRef.current?.requestSubmit(), []);
  useSaveShortcut(runSave, !props.isSubmitting);

  return (
    <form ref={formRef} onSubmit={(e) => void props.onSubmit(e)}>
      <PageHeader
        sticky
        icon="🏢"
        title={props.header.title}
        subtitle={props.header.subtitle}
        backLabel={props.header.backLabel}
        onBack={props.onCancel}
        dirty={props.dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={props.isSubmitting}>
              {props.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
              {props.submitLabel}
            </button>
          </>
        }
      />
      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}
      {props.children}
    </form>
  );
}

/** The four sections. Every row sums to 12 on the grid:
 *    Identity  Code 3 · Customer 6 · GSTIN 3
 *    Address   Address 12 · City 4 · State 4 · Pincode 4
 *    Contact   Contact Person 4 · Phone 4 · Email 4
 *    Terms     Payment Days 6 · Status 6 */
function ClientFields(props: {
  register: UseFormRegister<UpdateClientInput>;
  errors: FieldErrors<UpdateClientInput>;
  codeField: ReactNode;
  autoFocusName?: boolean;
}): React.JSX.Element {
  const { register, errors } = props;
  return (
    <>
      <Panel title="Identity">
        <FormGrid>
          {props.codeField}
          <FormField
            label="Customer"
            required
            size="lg"
            htmlFor="name"
            error={errors.name?.message}
          >
            <input
              id="name"
              className="innovic-input"
              autoFocus={props.autoFocusName}
              autoComplete="off"
              placeholder="Full company name"
              {...register('name')}
            />
          </FormField>
          <FormField label="GSTIN" size="sm" htmlFor="gstNumber">
            <input
              id="gstNumber"
              className="innovic-input"
              autoComplete="off"
              {...register('gstNumber')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Address">
        <FormGrid>
          <FormField label="Address" size="full" htmlFor="addressLine1">
            <input
              id="addressLine1"
              className="innovic-input"
              autoComplete="off"
              placeholder="Street address"
              {...register('addressLine1')}
            />
          </FormField>
          <FormField label="City" size="md" htmlFor="city">
            <input id="city" className="innovic-input" autoComplete="off" {...register('city')} />
          </FormField>
          <FormField label="State" size="md" htmlFor="state">
            <input id="state" className="innovic-input" autoComplete="off" {...register('state')} />
          </FormField>
          <FormField label="Pincode" size="md" htmlFor="pincode">
            <input
              id="pincode"
              className="innovic-input"
              autoComplete="off"
              {...register('pincode')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Contact">
        <FormGrid>
          <FormField label="Contact Person" size="md" htmlFor="contactPerson">
            <input
              id="contactPerson"
              className="innovic-input"
              autoComplete="off"
              placeholder="Contact name"
              {...register('contactPerson')}
            />
          </FormField>
          <FormField label="Phone" size="md" htmlFor="phone">
            <input id="phone" className="innovic-input" autoComplete="off" {...register('phone')} />
          </FormField>
          <FormField label="Email" size="md" htmlFor="email" error={errors.email?.message}>
            <input
              id="email"
              className="innovic-input"
              type="email"
              autoComplete="off"
              placeholder="email@domain.com"
              {...register('email')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Terms">
        <FormGrid>
          <PaymentDaysField register={register} error={errors.paymentDays?.message} />
          <FormField label="Status" size="lg" htmlFor="isActive">
            <select
              id="isActive"
              className="innovic-select"
              {...register('isActive', {
                setValueAs: (v: string | boolean) => (typeof v === 'string' ? v === 'true' : v),
              })}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </FormField>
        </FormGrid>
      </Panel>
    </>
  );
}

/** Payment Days (ADR-188) — how many days this customer is allowed to pay an
 *  invoice in; a new invoice's Payment Terms starts from it. Optional:
 *  a blank box saves as null (clears it on edit). The 0–365 range is the
 *  shared schema's; the browser min/max only guide the spinner. */
function PaymentDaysField(props: {
  register: UseFormRegister<UpdateClientInput>;
  error: string | undefined;
}): React.JSX.Element {
  const { register } = props;
  return (
    <FormField
      label="Payment Days"
      size="lg"
      htmlFor="paymentDays"
      error={props.error}
      help="Days the customer has to pay an invoice. Blank = not set."
    >
      <input
        id="paymentDays"
        className="innovic-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={365}
        step={1}
        autoComplete="off"
        placeholder="e.g. 45"
        style={{ textAlign: 'right' }}
        {...register('paymentDays', {
          setValueAs: (v: string | number | null | undefined) =>
            v === '' || v == null ? null : Number(v),
        })}
      />
    </FormField>
  );
}
