// Cost Center Master shared form (create + edit). Mirrors legacy
// _addCostCenter / _editCostCenter modals L17191 / L17213.

import {
  COST_CENTER_DEPARTMENTS,
  COST_CENTER_TYPES,
  type CostCenter,
  type CreateCostCenterInput,
  type UpdateCostCenterInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

interface FormValues {
  code: string;
  name: string;
  department: string;
  type: string;
  description: string;
  isActive: boolean;
}

const DEFAULTS: FormValues = {
  code: '',
  name: '',
  department: 'Production',
  type: 'Manufacturing',
  description: '',
  isActive: true,
};

type CreateMode = {
  mode: 'create';
  suggestedCode?: string;
  onSubmit: (values: CreateCostCenterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: CostCenter;
  onSubmit: (values: UpdateCostCenterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type CostCenterFormProps = CreateMode | EditMode;

export function CostCenterForm(props: CostCenterFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { ...DEFAULTS, code: props.suggestedCode ?? DEFAULTS.code };
  const { register, handleSubmit, formState } = useForm<FormValues>({ defaultValues: defaults });
  const errors = formState.errors;

  const onValid = async (values: FormValues): Promise<void> => {
    if (isEdit) {
      const payload: UpdateCostCenterInput = {
        name: values.name.trim(),
        department: values.department.trim() || undefined,
        type: values.type.trim() || undefined,
        description: values.description.trim() || undefined,
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    } else {
      const payload: CreateCostCenterInput = {
        code: values.code.trim(),
        name: values.name.trim(),
        ...(values.department.trim() ? { department: values.department.trim() } : {}),
        ...(values.type.trim() ? { type: values.type.trim() } : {}),
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid form-grid-3">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Code<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input fw-700"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            placeholder="CC-001"
            {...register('code', {
              required: !isEdit ? 'Code is required' : false,
              maxLength: { value: 64, message: 'Max 64 chars' },
            })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            placeholder="e.g. Machine Shop Floor"
            {...register('name', {
              required: 'Name is required',
              maxLength: { value: 255, message: 'Max 255 chars' },
            })}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Status
          </label>
          <select
            id="isActive"
            className="innovic-select"
            {...register('isActive', { setValueAs: (v) => v === 'true' || v === true })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="department">
            Department
          </label>
          <select id="department" className="innovic-select" {...register('department')}>
            {COST_CENTER_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="type">
            Type
          </label>
          <select id="type" className="innovic-select" {...register('type')}>
            {COST_CENTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="description">
            Description
          </label>
          <input
            id="description"
            className="innovic-input"
            autoComplete="off"
            placeholder="Brief description of this cost center"
            {...register('description', {
              maxLength: { value: 1000, message: 'Max 1000 chars' },
            })}
          />
          {errors.description?.message ? (
            <div className="form-error">{errors.description.message}</div>
          ) : null}
        </div>
      </div>

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
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Add Cost Center')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: CostCenter): FormValues {
  return {
    code: detail.code,
    name: detail.name,
    department: detail.department ?? 'Production',
    type: detail.type ?? 'Manufacturing',
    description: detail.description ?? '',
    isActive: detail.isActive,
  };
}
