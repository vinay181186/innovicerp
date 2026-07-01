// Operator create + edit form (UI-003-03). Field order matches legacy
// operatorForm (legacy/InnovicERP_v82_12_3.html L13726): Operator ID,
// Name, Department, Status, Skills/Machines (full). Plus an optional
// Linked User field from current shared schema.

import {
  type CreateOperatorInput,
  type Operator,
  type UpdateOperatorInput,
  createOperatorInputSchema,
  updateOperatorInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

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
  // Code is auto-generated server-side; never seed an empty string (it would
  // fail the schema's min-length check). Leave it undefined.
  code: undefined,
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

export function OperatorForm(props: OperatorFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateOperatorForm {...props} />;
  return <EditOperatorForm {...props} />;
}

function CreateOperatorForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateOperatorInput>({
    resolver: zodResolver(createOperatorInputSchema),
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
            Operator ID
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
          <div className="form-help">Generated automatically in series (OP-…) when you save.</div>
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoFocus autoComplete="off" placeholder="Full name" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="department">
            Department
          </label>
          <input id="department" className="innovic-input" autoComplete="off" placeholder="CNC Turning, Grinding…" {...register('department')} />
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
          <label className="form-label" htmlFor="skills">
            Skills / Machines
          </label>
          <input id="skills" className="innovic-input" autoComplete="off" placeholder="CNC-01, VMC-01, GR-01…" {...register('skills')} />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="userId">
            Linked User (optional)
          </label>
          <input id="userId" className="innovic-input" autoComplete="off" placeholder="UUID of a user account, if this operator also has a login" {...register('userId')} />
          <div className="form-help">Leave blank for shop-floor-only operators.</div>
        </div>
      </div>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Add Operator'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditOperatorForm(props: EditMode): React.JSX.Element {
  const form = useForm<UpdateOperatorInput>({
    resolver: zodResolver(updateOperatorInputSchema),
    defaultValues: operatorToUpdateDefaults(props.operator),
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
            Operator ID
          </label>
          <input id="code" className="innovic-input" value={props.operator.code} readOnly />
          <div className="form-help">Operator ID cannot be changed after creation.</div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="department">
            Department
          </label>
          <input id="department" className="innovic-input" autoComplete="off" placeholder="CNC Turning, Grinding…" {...register('department')} />
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
          <label className="form-label" htmlFor="skills">
            Skills / Machines
          </label>
          <input id="skills" className="innovic-input" autoComplete="off" placeholder="CNC-01, VMC-01, GR-01…" {...register('skills')} />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="userId">
            Linked User (optional)
          </label>
          <input id="userId" className="innovic-input" autoComplete="off" {...register('userId')} />
          <div className="form-help">Leave blank for shop-floor-only operators.</div>
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
