// QC Process Master shared form (create + edit).

import type { CreateQcProcessInput, QcProcess, UpdateQcProcessInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

interface FormValues {
  code: string;
  description: string;
  defaultCycleTimeMin: number;
  isActive: boolean;
}

const DEFAULTS: FormValues = {
  code: '',
  description: '',
  defaultCycleTimeMin: 0,
  isActive: true,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateQcProcessInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: QcProcess;
  onSubmit: (values: UpdateQcProcessInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type QcProcessFormProps = CreateMode | EditMode;

export function QcProcessForm(props: QcProcessFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;
  const { register, handleSubmit, formState } = useForm<FormValues>({ defaultValues: defaults });
  const errors = formState.errors;

  const onValid = async (values: FormValues): Promise<void> => {
    if (isEdit) {
      const payload: UpdateQcProcessInput = {
        description: values.description.trim() || undefined,
        defaultCycleTimeMin: Number(values.defaultCycleTimeMin) || 0,
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    } else {
      const payload: CreateQcProcessInput = {
        code: values.code.trim(),
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        defaultCycleTimeMin: Number(values.defaultCycleTimeMin) || 0,
        isActive: values.isActive,
      };
      await props.onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid form-grid-3">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="code">
            QC Process Name<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            placeholder="e.g. Dimensional Check, Hardness Test, Visual Inspection"
            {...register('code', {
              required: !isEdit ? 'Name is required' : false,
              maxLength: { value: 64, message: 'Max 64 chars' },
            })}
          />
          {isEdit ? <div className="form-help">Name cannot be changed after creation.</div> : null}
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="description">
            Description
          </label>
          <input
            id="description"
            className="innovic-input"
            autoComplete="off"
            placeholder="What does this QC process involve?"
            {...register('description', {
              maxLength: { value: 1000, message: 'Max 1000 chars' },
            })}
          />
          {errors.description?.message ? (
            <div className="form-error">{errors.description.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="defaultCycleTimeMin">
            Default cycle time (minutes)
          </label>
          <input
            id="defaultCycleTimeMin"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            placeholder="e.g. 15"
            {...register('defaultCycleTimeMin', {
              valueAsNumber: true,
              min: { value: 0, message: 'Must be ≥ 0' },
            })}
          />
          {errors.defaultCycleTimeMin?.message ? (
            <div className="form-error">{errors.defaultCycleTimeMin.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Status
          </label>
          <select id="isActive" className="innovic-select" {...register('isActive', {
            setValueAs: (v) => v === 'true' || v === true,
          })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
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
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Add QC Process')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: QcProcess): FormValues {
  return {
    code: detail.code,
    description: detail.description ?? '',
    defaultCycleTimeMin: Number(detail.defaultCycleTimeMin),
    isActive: detail.isActive,
  };
}
