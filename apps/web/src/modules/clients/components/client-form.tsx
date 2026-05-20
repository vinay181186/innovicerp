// Client create + edit form (UI-003-03). Field order matches legacy
// clientForm (legacy/InnovicERP_v82_12_3.html L12996): Code, Name (full),
// Address (full), Contact Person, Email. Extends legacy with Phone, GST,
// City/State/Pincode, Status (from current shared schema).

import {
  type Client,
  type CreateClientInput,
  type UpdateClientInput,
  createClientInputSchema,
  updateClientInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

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

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Client Code<span className="req">★</span>
          </label>
          <input id="code" className="innovic-input" autoFocus autoComplete="off" placeholder="e.g. CLI-001" {...register('code')} />
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Client Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" placeholder="Full company name" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea id="addressLine1" className="innovic-textarea" rows={2} placeholder="City / address" {...register('addressLine1')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="contactPerson">
            Contact Person
          </label>
          <input id="contactPerson" className="innovic-input" autoComplete="off" placeholder="Name / phone" {...register('contactPerson')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input id="email" className="innovic-input" type="email" autoComplete="off" placeholder="email@domain.com" {...register('email')} />
          {errors.email?.message ? <div className="form-error">{errors.email.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" className="innovic-input" autoComplete="off" {...register('phone')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstNumber">
            GST Number
          </label>
          <input id="gstNumber" className="innovic-input" autoComplete="off" {...register('gstNumber')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="city">
            City
          </label>
          <input id="city" className="innovic-input" autoComplete="off" {...register('city')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="state">
            State
          </label>
          <input id="state" className="innovic-input" autoComplete="off" {...register('state')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="pincode">
            Pincode
          </label>
          <input id="pincode" className="innovic-input" autoComplete="off" {...register('pincode')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Status
          </label>
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
        </div>
      </div>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create Client'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
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
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Client Code
          </label>
          <input id="code" className="innovic-input" value={props.client.code} readOnly />
          <div className="form-help">Code cannot be changed after creation.</div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Client Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea id="addressLine1" className="innovic-textarea" rows={2} {...register('addressLine1')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="contactPerson">
            Contact Person
          </label>
          <input id="contactPerson" className="innovic-input" autoComplete="off" {...register('contactPerson')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input id="email" className="innovic-input" type="email" autoComplete="off" {...register('email')} />
          {errors.email?.message ? <div className="form-error">{errors.email.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" className="innovic-input" autoComplete="off" {...register('phone')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstNumber">
            GST Number
          </label>
          <input id="gstNumber" className="innovic-input" autoComplete="off" {...register('gstNumber')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="city">
            City
          </label>
          <input id="city" className="innovic-input" autoComplete="off" {...register('city')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="state">
            State
          </label>
          <input id="state" className="innovic-input" autoComplete="off" {...register('state')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="pincode">
            Pincode
          </label>
          <input id="pincode" className="innovic-input" autoComplete="off" {...register('pincode')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Status
          </label>
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
        </div>
      </div>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Save changes'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function FormFooter(props: {
  isSubmitting: boolean;
  submitLabel: string;
  submitError: string | null;
  onCancel?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <div style={{ marginTop: 16 }}>
      {props.submitError ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {props.submitError}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {props.onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={props.isSubmitting}>
          {props.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
}
