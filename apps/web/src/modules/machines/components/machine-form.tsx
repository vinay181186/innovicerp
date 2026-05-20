// Machine create + edit form (UI-003-03). Field order matches legacy
// machineForm (legacy/InnovicERP_v82_12_3.html L13113): Machine ID,
// Machine Name, Type (full), Capacity/Shift, Shifts/Day, Status.
// Hour Rate + Maintenance fields from legacy are NOT in the current
// shared schema and are deferred to a Phase C extension.

import {
  type CreateMachineInput,
  type Machine,
  type UpdateMachineInput,
  createMachineInputSchema,
  updateMachineInputSchema,
} from '@innovic/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

const MACHINE_STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;

type CreateMode = {
  mode: 'create';
  defaultValues?: Partial<CreateMachineInput>;
  onSubmit: (values: CreateMachineInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  machine: Machine;
  onSubmit: (values: UpdateMachineInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type MachineFormProps = CreateMode | EditMode;

const CREATE_DEFAULTS: CreateMachineInput = {
  code: '',
  name: '',
  machineType: undefined,
  capacityPerShift: undefined,
  shiftsPerDay: 1,
  status: 'Idle',
};

function machineToUpdateDefaults(m: Machine): UpdateMachineInput {
  return {
    name: m.name,
    machineType: m.machineType ?? undefined,
    capacityPerShift: m.capacityPerShift ?? undefined,
    shiftsPerDay: m.shiftsPerDay,
    status: m.status,
  };
}

export function MachineForm(props: MachineFormProps): React.JSX.Element {
  if (props.mode === 'create') return <CreateMachineForm {...props} />;
  return <EditMachineForm {...props} />;
}

function CreateMachineForm(props: CreateMode): React.JSX.Element {
  const form = useForm<CreateMachineInput>({
    resolver: zodResolver(createMachineInputSchema),
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
            Machine ID<span className="req">★</span>
          </label>
          <input id="code" className="innovic-input" autoFocus autoComplete="off" placeholder="CNC-01" {...register('code')} />
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Machine Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" placeholder="CNC Turning Centre" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="machineType">
            Type
          </label>
          <input id="machineType" className="innovic-input" autoComplete="off" placeholder="CNC Lathe, VMC, Grinding…" {...register('machineType')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="capacityPerShift">
            Capacity / Shift (hrs)
          </label>
          <input id="capacityPerShift" className="innovic-input" type="number" min={0} autoComplete="off" {...register('capacityPerShift')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="shiftsPerDay">
            Shifts / Day
          </label>
          <input id="shiftsPerDay" className="innovic-input" type="number" min={1} autoComplete="off" {...register('shiftsPerDay')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Status
          </label>
          <select id="status" className="innovic-select" {...register('status')}>
            {MACHINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FormFooter
        isSubmitting={formState.isSubmitting}
        submitLabel={props.submitLabel ?? 'Add Machine'}
        submitError={props.submitError ?? null}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function EditMachineForm(props: EditMode): React.JSX.Element {
  const form = useForm<UpdateMachineInput>({
    resolver: zodResolver(updateMachineInputSchema),
    defaultValues: machineToUpdateDefaults(props.machine),
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
            Machine ID
          </label>
          <input id="code" className="innovic-input" value={props.machine.code} readOnly />
          <div className="form-help">Machine ID cannot be changed after creation.</div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Machine Name<span className="req">★</span>
          </label>
          <input id="name" className="innovic-input" autoComplete="off" {...register('name')} />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="machineType">
            Type
          </label>
          <input id="machineType" className="innovic-input" autoComplete="off" {...register('machineType')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="capacityPerShift">
            Capacity / Shift (hrs)
          </label>
          <input id="capacityPerShift" className="innovic-input" type="number" min={0} autoComplete="off" {...register('capacityPerShift')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="shiftsPerDay">
            Shifts / Day
          </label>
          <input id="shiftsPerDay" className="innovic-input" type="number" min={1} autoComplete="off" {...register('shiftsPerDay')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Status
          </label>
          <select id="status" className="innovic-select" {...register('status')}>
            {MACHINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
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
