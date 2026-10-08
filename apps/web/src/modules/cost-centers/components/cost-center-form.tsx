// Cost Centre Master shared form (create + edit). Mirrors legacy
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
      // ADR-226 — the trimmed Description is sent AS IT IS, blank included. The
      // old `|| undefined` turned a box the user had CLEARED into "untouched",
      // so clearing a description silently did nothing; the server already runs
      // emptyToNull on it, so a blank now stores as no description. Same
      // one-line fix as qc-process-form.tsx, same reason.
      //
      // Department and Cost Centre Type are sent the same way, and for the same
      // reason. Both columns allow NULL and both <select>s now carry a blank
      // option, so "no department" is a value the user can choose — with
      // `|| undefined` choosing it would have read as "untouched" and clearing a
      // department would silently do nothing. The service runs emptyToNull on
      // both (cost-centers/service.ts), so a blank stores as NULL, and
      // `changedFields` treats a NULL column and a blank box as the same value,
      // so a cost centre whose department is already NULL sends nothing.
      const payload: UpdateCostCenterInput = {
        name: values.name.trim(),
        department: values.department.trim(),
        type: values.type.trim(),
        description: values.description.trim(),
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
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Cost Centre Code{!isEdit ? <span className="req">★</span> : null}
          </label>
          <input
            id="code"
            className={isEdit ? 'innovic-input' : 'innovic-input fw-700'}
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('code', {
              required: !isEdit ? 'Code is required.' : false,
              maxLength: { value: 64, message: 'Code cannot be longer than 64 characters' },
            })}
          />
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Cost Centre Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            {...(isEdit ? {} : { placeholder: 'e.g. Machine Shop Floor' })}
            {...register('name', {
              required: 'Name is required.',
              maxLength: { value: 255, message: 'Name cannot be longer than 255 characters' },
            })}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="department">
            Department
          </label>
          <select id="department" className="innovic-select" {...register('department')}>
            {/* ADR-226 — a cost centre with no department stays that way. The
                blank is offered on EDIT only: the box must be able to SHOW "no
                department" for a row whose column is NULL, otherwise the form
                invents one and every save carries it. Create keeps its
                Production default and always sends a department, exactly as
                before. */}
            {isEdit ? <option value="">— None —</option> : null}
            {optionsWith(COST_CENTER_DEPARTMENTS, isEdit ? props.detail.department : null).map(
              (d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="type">
            Cost Centre Type
          </label>
          <select id="type" className="innovic-select" {...register('type')}>
            {/* Same as Department above: blank on EDIT only. */}
            {isEdit ? <option value="">— None —</option> : null}
            {optionsWith(COST_CENTER_TYPES, isEdit ? props.detail.type : null).map((t) => (
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
            {...register('description', {
              maxLength: {
                value: 1000,
                message: 'Description cannot be longer than 1000 characters',
              },
            })}
          />
          {errors.description?.message ? (
            <div className="form-error">{errors.description.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="isActive">
            Active
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
      </div>

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
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {formState.isSubmitting ? 'Saving…' : (props.submitLabel ?? 'Save')}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * The master list, plus the row's OWN stored value when the list does not carry
 * it. `cost_centers.department` and `.type` are plain text columns (migration
 * 0023 — "so adding a department doesn't need a migration"), so a row can hold
 * a value this list has since dropped, or one set straight through the API.
 * Without its own option the browser shows the FIRST option instead, and the
 * save then rewrites a value nobody touched — the same ADR-226 fault, by a
 * different door.
 */
function optionsWith(options: readonly string[], stored: string | null): string[] {
  return stored && !options.includes(stored) ? [...options, stored] : [...options];
}

// ADR-226 — NULL seeds BLANK, never an invented default. `?? 'Production'` /
// `?? 'Manufacturing'` meant that for a cost centre whose column is NULL the
// form held a value nobody had chosen, so EVERY save carried it: a
// Description-only edit overwrote another admin's deliberate Department and the
// clash notice named a field the user never touched. Seeding blank keeps an
// untouched NULL out of the payload, because `changedFields` reads NULL and ''
// as the same value.
function detailToFormValues(detail: CostCenter): FormValues {
  return {
    code: detail.code,
    name: detail.name,
    department: detail.department ?? '',
    type: detail.type ?? '',
    description: detail.description ?? '',
    isActive: detail.isActive,
  };
}
