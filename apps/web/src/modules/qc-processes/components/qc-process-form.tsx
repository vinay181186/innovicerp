// QC Process Master shared form (create + edit).
//
// Legacy has NO shared body builder: addQCProcess (L23475) and editQCProcess
// (L23492) each inline their own literal into showModal(). The two literals are
// field-identical — same 4 fields, same order, same `.form-grid` — differing
// only where a mode must differ (placeholder= on create vs value=/selected on
// edit). So one component is a faithful port; per-mode drift is not.
//
// Footer: both call sites use showModal (NOT showModalLg), whose footer is
// hard-coded Cancel / Save at L28026-27 — so "Save" in BOTH modes, no ✓ prefix.
//
// Grid: legacy uses plain `.form-grid` (2 columns, theme L613) — NOT
// `.form-grid-3`. Cycle Time + Status fill one 2-col row.
//
// `★` is create-only on the name: updateQcProcessInputSchema omits `code` and
// service.ts updateQcProcess never writes it, so on edit the field is readonly
// and not submitted at all — starring it there would describe a constraint the
// edit path does not enforce. Mirrors the cost-centers master, same asymmetry.
//
// UNITS: legacy labels this "(hrs)" and stores hours; our column is
// `default_cycle_time_min` numeric(8,2) — MINUTES. Label tracks OUR column, as
// the already-ported list header ("Std Time (min)") does. See report.

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
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="code">
            QC Process Name{!isEdit ? <span className="req">★</span> : null}
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...(isEdit
              ? {}
              : { placeholder: 'e.g. Dimensional Check, Hardness Test, Visual Inspection' })}
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
            {...(isEdit ? {} : { placeholder: 'What does this QC process involve?' })}
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
            Default Cycle Time (min)
          </label>
          <input
            id="defaultCycleTimeMin"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            {...(isEdit ? {} : { placeholder: '15' })}
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
            {props.submitLabel ?? 'Save'}
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
