// Vendor create + edit form (UI-003-03).
//
// Master rules (plan v3 Step 2): GST Category, a State pick-list (saving the
// 2-digit State Code) and Payment Terms (days) join the form. GSTIN / State /
// GST Category problems show live under the fields — amber in Warn mode, red
// in Enforce mode — and an enforce-mode refusal's field errors land under the
// same fields. A valid GSTIN fills a blank State. See settings/master-rules-ui.

import {
  type CreateVendorInput,
  type UpdateVendorInput,
  type Vendor,
  createVendorInputSchema,
  updateVendorInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { type FieldErrors, type UseFormRegister, useForm } from 'react-hook-form';
import {
  GST_CATEGORY_OPTIONS,
  type PartyGstNotes,
  RuleNoteLine,
  RuleWarning,
  STATE_OPTIONS,
  type ServerFieldErrors,
  blankToNull,
  initialStateCode,
  oldStateHint,
  unmappedOldState,
  usePartyGstNotes,
} from '@/modules/settings/master-rules-ui';
import { useNextVendorCode } from '../api';

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateVendorInput>;
  onSubmit: (values: CreateVendorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  /** Field errors from an enforce-mode 400 (master rules), shown under the fields. */
  serverFieldErrors?: ServerFieldErrors | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  vendor: Vendor;
  onSubmit: (values: UpdateVendorInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  serverFieldErrors?: ServerFieldErrors | null;
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
  gstCategory: null,
  addressLine1: undefined,
  city: undefined,
  stateCode: null,
  pincode: undefined,
  paymentTermsDays: null,
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
    gstCategory: v.gstCategory ?? null,
    addressLine1: v.addressLine1 ?? undefined,
    city: v.city ?? undefined,
    // The State pick-list saves the State Code; the free-text `state` is no
    // longer sent (the server stores the list name for the code).
    stateCode: initialStateCode(v.stateCode, v.state),
    pincode: v.pincode ?? undefined,
    paymentTermsDays: v.paymentTermsDays ?? null,
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
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  // Create and edit carry the same fields with the same types; the shared
  // field components take the update-form types (same cast as client-form).
  const fieldRegister = register as unknown as UseFormRegister<UpdateVendorInput>;
  const fieldErrors = errors as unknown as FieldErrors<UpdateVendorInput>;
  const setStateCode = useCallback(
    (code: string) => setValue('stateCode', code, { shouldDirty: true }),
    [setValue],
  );
  const stateCode = watch('stateCode');
  const notes = usePartyGstNotes({
    gstNumber: watch('gstNumber'),
    gstCategory: watch('gstCategory'),
    stateCode,
    setStateCode,
    // An untouched new form does not open covered in amber.
    show: formState.isDirty || formState.isSubmitted,
    serverFieldErrors: props.serverFieldErrors,
  });
  const oldState = null;

  // Prefill the read-only code with the next server-assigned VND-### so it is
  // visible before save. Only seed while still blank (don't clobber edits).
  const { data: nextCode } = useNextVendorCode();
  useEffect(() => {
    if (nextCode?.code && !form.getValues('code')) {
      form.setValue('code', nextCode.code);
    }
  }, [nextCode, form]);

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        // A blank pick-list is simply not sent on a new vendor.
        const { stateCode: code, gstCategory, ...rest } = values;
        await props.onSubmit({
          ...rest,
          ...(code ? { stateCode: code } : {}),
          ...(gstCategory ? { gstCategory } : {}),
        });
      })}
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Vendor Code
          </label>
          <input
            id="code"
            className="innovic-input"
            readOnly
            autoComplete="off"
            placeholder="Auto-generated on save"
            {...register('code', {
              // Read-only, auto-generated server-side. RHF reads the blank DOM
              // value back as "" on submit, failing the schema's min(1); coerce
              // blank → undefined so `code` is omitted (optional).
              setValueAs: (v: string) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
            })}
          />
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Vendor Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            placeholder="Company name"
            {...register('name')}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="contactPerson">
            Contact Person
          </label>
          <input
            id="contactPerson"
            className="innovic-input"
            autoComplete="off"
            placeholder="Name"
            {...register('contactPerson')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            className="innovic-input"
            autoComplete="off"
            placeholder="9876543210"
            {...register('phone')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="innovic-input"
            type="email"
            autoComplete="off"
            placeholder="email@vendor.com"
            {...register('email')}
          />
          {errors.email?.message ? <div className="form-error">{errors.email.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstNumber">
            GSTIN
          </label>
          <input
            id="gstNumber"
            className="innovic-input"
            autoComplete="off"
            placeholder="24XXXXX1234X1Z5"
            {...register('gstNumber')}
          />
          <RuleNoteLine note={notes.gstNumber} />
        </div>
        <VendorTermsFields register={fieldRegister} errors={fieldErrors} notes={notes} />

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea
            id="addressLine1"
            className="innovic-textarea"
            rows={2}
            placeholder="Full address"
            {...register('addressLine1')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="city">
            City
          </label>
          <input id="city" className="innovic-input" autoComplete="off" {...register('city')} />
        </div>
        <VendorStateField
          register={fieldRegister}
          errors={fieldErrors}
          notes={notes}
          oldState={oldState}
          stateChosen={!!stateCode}
        />

        <div className="form-grp">
          <label className="form-label" htmlFor="pincode">
            Pincode
          </label>
          <input id="pincode" className="innovic-input" autoComplete="off" {...register('pincode')} />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="materialsSupplied">
            Materials Supplied
          </label>
          <textarea
            id="materialsSupplied"
            className="innovic-textarea"
            rows={2}
            placeholder="EN8, SS304, Cutting tools..."
            {...register('materialsSupplied')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="rating">
            Rating
          </label>
          <select id="rating" className="innovic-select" {...register('rating')}>
            <option value="">— None —</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Vendor Status
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
        submitLabel={props.submitLabel ?? 'Save Vendor'}
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
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  const { vendor } = props;
  const fieldRegister = register;
  const fieldErrors = errors;
  const setStateCode = useCallback(
    (code: string) => setValue('stateCode', code, { shouldDirty: true }),
    [setValue],
  );
  const stateCode = watch('stateCode');
  const notes = usePartyGstNotes({
    gstNumber: watch('gstNumber'),
    gstCategory: watch('gstCategory'),
    stateCode,
    setStateCode,
    show: true,
    serverFieldErrors: props.serverFieldErrors,
  });
  const oldState = unmappedOldState(vendor.stateCode, vendor.state);

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        // A State left blank on an old record that never had a State Code is
        // not sent, so its old free-text State is kept rather than cleared.
        const { stateCode: code, ...rest } = values;
        await props.onSubmit(code || vendor.stateCode ? values : rest);
      })}
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Vendor Code
          </label>
          <input id="code" className="innovic-input" value={props.vendor.code} readOnly />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Vendor Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            placeholder="Company name"
            {...register('name')}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="contactPerson">
            Contact Person
          </label>
          <input
            id="contactPerson"
            className="innovic-input"
            autoComplete="off"
            placeholder="Name"
            {...register('contactPerson')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            className="innovic-input"
            autoComplete="off"
            placeholder="9876543210"
            {...register('phone')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="innovic-input"
            type="email"
            autoComplete="off"
            placeholder="email@vendor.com"
            {...register('email')}
          />
          {errors.email?.message ? <div className="form-error">{errors.email.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="gstNumber">
            GSTIN
          </label>
          <input
            id="gstNumber"
            className="innovic-input"
            autoComplete="off"
            placeholder="24XXXXX1234X1Z5"
            {...register('gstNumber')}
          />
          <RuleNoteLine note={notes.gstNumber} />
        </div>
        <VendorTermsFields register={fieldRegister} errors={fieldErrors} notes={notes} />

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="addressLine1">
            Address
          </label>
          <textarea
            id="addressLine1"
            className="innovic-textarea"
            rows={2}
            placeholder="Full address"
            {...register('addressLine1')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="city">
            City
          </label>
          <input id="city" className="innovic-input" autoComplete="off" {...register('city')} />
        </div>
        <VendorStateField
          register={fieldRegister}
          errors={fieldErrors}
          notes={notes}
          oldState={oldState}
          stateChosen={!!stateCode}
        />

        <div className="form-grp">
          <label className="form-label" htmlFor="pincode">
            Pincode
          </label>
          <input id="pincode" className="innovic-input" autoComplete="off" {...register('pincode')} />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="materialsSupplied">
            Materials Supplied
          </label>
          <textarea
            id="materialsSupplied"
            className="innovic-textarea"
            rows={2}
            placeholder="EN8, SS304, Cutting tools..."
            {...register('materialsSupplied')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="rating">
            Rating
          </label>
          <select id="rating" className="innovic-select" {...register('rating')}>
            <option value="">— None —</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Vendor Status
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
        submitLabel={props.submitLabel ?? 'Save Changes'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

/** GST Category + Payment Terms (days) — one row of the two-column grid,
 *  right under GSTIN. Payment Terms (days) copies the customer's Payment Days
 *  box: optional, blank saves as null, the 0–365 range is the shared schema's. */
function VendorTermsFields(props: {
  register: UseFormRegister<UpdateVendorInput>;
  errors: FieldErrors<UpdateVendorInput>;
  notes: PartyGstNotes;
}): React.JSX.Element {
  const { register, errors, notes } = props;
  return (
    <>
      <div className="form-grp">
        <label className="form-label" htmlFor="gstCategory">
          GST Category
        </label>
        <select
          id="gstCategory"
          className="innovic-select"
          {...register('gstCategory', { setValueAs: blankToNull })}
        >
          <option value="">— choose —</option>
          {GST_CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {errors.gstCategory?.message ? (
          <div className="form-error">{errors.gstCategory.message}</div>
        ) : (
          <RuleNoteLine note={notes.gstCategory} />
        )}
      </div>
      <div className="form-grp">
        <label className="form-label" htmlFor="paymentTermsDays">
          Payment Terms (days)
        </label>
        <input
          id="paymentTermsDays"
          className="innovic-input"
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          autoComplete="off"
          placeholder="e.g. 30"
          style={{ textAlign: 'right' }}
          {...register('paymentTermsDays', {
            setValueAs: (v: string | number | null | undefined) =>
              v === '' || v == null ? null : Number(v),
          })}
        />
        {errors.paymentTermsDays?.message ? (
          <div className="form-error">{errors.paymentTermsDays.message}</div>
        ) : (
          <div className="form-help">Days we have to pay this vendor. Blank = not set.</div>
        )}
      </div>
    </>
  );
}

/** State pick-list ("Gujarat (24)"), saving the State Code. An old record's
 *  free-text State that matches no list entry is shown under it. */
function VendorStateField(props: {
  register: UseFormRegister<UpdateVendorInput>;
  errors: FieldErrors<UpdateVendorInput>;
  notes: PartyGstNotes;
  oldState: string | null;
  stateChosen: boolean;
}): React.JSX.Element {
  const { register, errors, notes } = props;
  const oldHint = props.stateChosen ? null : oldStateHint(props.oldState);
  const error = errors.stateCode?.message ?? notes.stateCode.error;
  return (
    <div className="form-grp">
      <label className="form-label" htmlFor="stateCode">
        State
      </label>
      <select
        id="stateCode"
        className="innovic-select"
        {...register('stateCode', { setValueAs: blankToNull })}
      >
        <option value="">— choose —</option>
        {STATE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <div className="form-error">{error}</div> : null}
      {!error && notes.stateCode.warning ? (
        <RuleWarning>{notes.stateCode.warning}</RuleWarning>
      ) : null}
      {oldHint ? <div className="form-help">{oldHint}</div> : null}
    </div>
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
            color: 'var(--red2)',
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
