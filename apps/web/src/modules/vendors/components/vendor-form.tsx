// Vendor create + edit form (UI-003-03).

import {
  type CreateVendorInput,
  type UpdateVendorInput,
  type Vendor,
  createVendorInputSchema,
  updateVendorInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateVendorInput>;
  onSubmit: (values: CreateVendorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  vendor: Vendor;
  onSubmit: (values: UpdateVendorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type VendorFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateVendorInput = {
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
  materialsSupplied: undefined,
  rating: undefined,
  isActive: true,
};

function vendorToUpdateDefaults(v: Vendor): UpdateVendorInput {
  return {
    name: v.name,
    contactPerson: v.contactPerson ?? undefined,
    email: v.email ?? undefined,
    phone: v.phone ?? undefined,
    gstNumber: v.gstNumber ?? undefined,
    addressLine1: v.addressLine1 ?? undefined,
    city: v.city ?? undefined,
    state: v.state ?? undefined,
    pincode: v.pincode ?? undefined,
    materialsSupplied: v.materialsSupplied ?? undefined,
    rating: v.rating ?? undefined,
    isActive: v.isActive,
  };
}

export function VendorForm(props: VendorFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateVendorForm {...props} />;
  return <EditVendorForm {...props} />;
}

function CreateVendorForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorInputSchema),
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
            Vendor Code
          </label>
          <input id="code" className="innovic-input" readOnly autoComplete="off" placeholder="Auto-generated on save" {...register('code')} />
          <div className="form-help">Generated automatically in series (VND-…) when you save.</div>
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Vendor Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoFocus autoComplete="off" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
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
          <label className="form-label" htmlFor="rating">
            Rating
          </label>
          <input id="rating" className="innovic-input" autoComplete="off" placeholder="A / B / C" {...register('rating')} />
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

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="materialsSupplied">
            Materials Supplied
          </label>
          <textarea
            id="materialsSupplied"
            className="innovic-textarea"
            rows={2}
            placeholder="EN8, EN24, EN31"
            {...register('materialsSupplied')}
          />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea id="addressLine1" className="innovic-textarea" rows={2} {...register('addressLine1')} />
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
      </div>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Create Vendor'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditVendorForm(props: EditMode): React.JSX.Element {
  const form = useForm<UpdateVendorInput>({
    resolver: zodResolver(updateVendorInputSchema),
    defaultValues: vendorToUpdateDefaults(props.vendor),
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
            Vendor Code
          </label>
          <input id="code" className="innovic-input" value={props.vendor.code} readOnly />
          <div className="form-help">Code cannot be changed after creation.</div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Vendor Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
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
          <label className="form-label" htmlFor="rating">
            Rating
          </label>
          <input id="rating" className="innovic-input" autoComplete="off" placeholder="A / B / C" {...register('rating')} />
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

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="materialsSupplied">
            Materials Supplied
          </label>
          <textarea
            id="materialsSupplied"
            className="innovic-textarea"
            rows={2}
            placeholder="EN8, EN24, EN31"
            {...register('materialsSupplied')}
          />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea id="addressLine1" className="innovic-textarea" rows={2} {...register('addressLine1')} />
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
