// TPI Master shared form (create + edit).
//
// Mirrors qc-process-form.tsx field for field, because TPI Master is the
// deliberate sibling of QC Process Master — same `.form-grid`, same
// Cancel / Save footer, same create/edit discriminated union.
//
// `★` is create-only on the name: updateTpiMasterInputSchema omits `code`, so
// on edit the field is read-only and is not submitted at all. Starring it there
// would describe a constraint the edit path does not enforce. The name is
// permanent because every TPI log snapshots it as text — retire an inspector
// with Status = Inactive, never by renaming them.
//
// Email format is validated by the shared schema (and therefore by the server),
// so there is no second regex here: a bad address comes back as the server's own
// message in `submitError`. Two copies of one rule drift.

import type { CreateTpiMasterInput, TpiMaster, UpdateTpiMasterInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

interface FormValues {
  code: string;
  organization: string;
  contactNo: string;
  email: string;
  remarks: string;
  isActive: boolean;
}

const DEFAULTS: FormValues = {
  code: '',
  organization: '',
  contactNo: '',
  email: '',
  remarks: '',
  isActive: true,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateTpiMasterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: TpiMaster;
  onSubmit: (values: UpdateTpiMasterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type TpiMasterFormProps = CreateMode | EditMode;

export function TpiMasterForm(props: TpiMasterFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;
  const { register, handleSubmit, formState } = useForm<FormValues>({ defaultValues: defaults });
  const errors = formState.errors;

  const onValid = async (values: FormValues): Promise<void> => {
    if (isEdit) {
      // Empty strings are sent as-is on edit (the shared schema accepts them) so
      // that clearing a contact number or an email actually clears it. Dropping
      // the key instead would silently keep the old value.
      const payload: UpdateTpiMasterInput = {
        organization: values.organization.trim(),
        contactNo: values.contactNo.trim(),
        email: values.email.trim(),
        remarks: values.remarks.trim(),
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    } else {
      const payload: CreateTpiMasterInput = {
        code: values.code.trim(),
        ...(values.organization.trim() ? { organization: values.organization.trim() } : {}),
        ...(values.contactNo.trim() ? { contactNo: values.contactNo.trim() } : {}),
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        ...(values.remarks.trim() ? { remarks: values.remarks.trim() } : {}),
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="code">
            Inspector Name{!isEdit ? <span className="req">★</span> : null}
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...(isEdit ? {} : { placeholder: 'e.g. Mr. Sharma' })}
            {...register('code', {
              required: !isEdit ? 'Inspector name is required' : false,
              maxLength: { value: 120, message: 'Max 120 chars' },
            })}
          />
          {isEdit ? (
            <div className="form-help">
              Inspector name cannot be changed after creation — every TPI record already carries it.
              Set Status to Inactive to retire an inspector.
            </div>
          ) : null}
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="organization">
            Organization
          </label>
          <input
            id="organization"
            className="innovic-input"
            autoComplete="off"
            {...(isEdit ? {} : { placeholder: 'e.g. L&T QA Department' })}
            {...register('organization', {
              maxLength: { value: 255, message: 'Max 255 chars' },
            })}
          />
          {errors.organization?.message ? (
            <div className="form-error">{errors.organization.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="contactNo">
            Contact No.
          </label>
          <input
            id="contactNo"
            className="innovic-input"
            autoComplete="off"
            {...(isEdit ? {} : { placeholder: 'e.g. 98200 12345' })}
            {...register('contactNo', {
              maxLength: { value: 32, message: 'Max 32 chars' },
            })}
          />
          {errors.contactNo?.message ? (
            <div className="form-error">{errors.contactNo.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="innovic-input"
            autoComplete="off"
            {...(isEdit ? {} : { placeholder: 'e.g. sharma@lnt-qa.com' })}
            {...register('email', {
              maxLength: { value: 255, message: 'Max 255 chars' },
            })}
          />
          {errors.email?.message ? <div className="form-error">{errors.email.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Status
          </label>
          <select
            id="isActive"
            className="innovic-select"
            {...register('isActive', {
              setValueAs: (v) => v === 'true' || v === true,
            })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">
            Remarks
          </label>
          <input
            id="remarks"
            className="innovic-input"
            autoComplete="off"
            {...(isEdit ? {} : { placeholder: 'Scope of approval, agency notes…' })}
            {...register('remarks', {
              maxLength: { value: 1000, message: 'Max 1000 chars' },
            })}
          />
          {errors.remarks?.message ? (
            <div className="form-error">{errors.remarks.message}</div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {props.submitError ? (
          <div
            style={{
              color: 'var(--red)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
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
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: TpiMaster): FormValues {
  return {
    code: detail.code,
    organization: detail.organization ?? '',
    contactNo: detail.contactNo ?? '',
    email: detail.email ?? '',
    remarks: detail.remarks ?? '',
    isActive: detail.isActive,
  };
}
