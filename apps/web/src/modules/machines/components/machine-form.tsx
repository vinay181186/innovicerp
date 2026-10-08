// Machine create + edit form (UI-003-03). Field order:
// Machine Group, Machine ID, Machine Name, Product Code, Type (full),
// Capacity/Shift, Shifts/Day, 💰 Hour Rate (₹/hr), Status.
// hourRate feeds SO Costing machine-time (migration 0050 / ADR-041).
//
// Legacy machineForm (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13113) had no Machine Group and no Product Code; both are additions
// (migration 0116). Machine Group is a type-to-search picker off the Machine
// Group master — the second tab of the Machine Master screen — and sits
// ALONGSIDE the free-text Type, which is unchanged and still typed. A machine
// with no group is normal (every row created before this change): the picker
// simply starts empty.
//
// Legacy builds ONE form for both modes — machineForm(m={}) — so create and
// edit are field-identical by construction; only Machine ID flips to readonly
// when m.id is set (L13115). The two components below MUST stay markup-
// identical for that reason; they are separate only because create/edit carry
// different Zod resolvers and input types.
//
// DELTA vs legacy (not portable — no schema support, see report):
//   • MAINTENANCE SCHEDULE box (L13127-13132): Maintenance Cycle (days) +
//     Last Maintenance Date. No maintCycleDays / lastMaintDate on our schema.
//   • Status options: legacy offers Running / Idle / Under Maintenance
//     (L13124); we keep our 4 (Idle/Running/Down/Maintenance) — 'Down' is read
//     by alert AL-013 and rendered by list.tsx + detail.tsx.

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
import { useMachineGroupLookup } from '../api';
import { MachineGroupPicker } from './machine-group-picker';

const MACHINE_STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;
// Legacy <select id="fShifts"> offers exactly 1 / 2 / 3 (L13120).
const SHIFTS_PER_DAY = [1, 2, 3] as const;

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
  machineGroupId: undefined,
  productCode: undefined,
  machineType: undefined,
  capacityPerShift: undefined,
  shiftsPerDay: 1,
  status: 'Idle',
  hourRate: 0,
};

// ADR-225 — an EMPTY number box must stay empty, not become 0.
//
// `register('hourRate')` hands back `''` for a blank input, and
// `z.coerce.number()` turns `''` into 0 (`Number('') === 0`). So a machine with
// no Hour Rate and no Hours per Shift — both nullable on the record — used to
// submit 0 for each, and EVERY save quietly wrote 0 over the null. Nobody
// noticed because the whole payload was sent every time.
//
// It surfaced when the edit screen started sending only CHANGED fields: the
// stored null and the submitted 0 differ, so the save reported a change the
// user never made, and a conflict notice could have named "Hour Rate" as their
// edit when they had not touched the box. A notice that names the wrong field
// is worse than no notice.
//
// `undefined` means "untouched" to both the diff and the server
// (`if (input.x !== undefined)`), so a blank box now writes nothing at all.
//
// KNOWN LIMIT, deliberately left: clearing a rate that HAS a value is now a
// no-op rather than writing 0. Setting it back to empty is not expressible in
// this contract at all — `updateMachineInputSchema` has these as `.optional()`
// and not `.nullable()`, and `z.coerce.number()` would turn an explicit null
// into 0 anyway. Making "no rate" sendable is a contract change and its own
// decision; silently writing 0 was never what the user asked for either.
const blankToUndefined = (v: unknown): number | undefined =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

function machineToUpdateDefaults(m: Machine): UpdateMachineInput {
  return {
    name: m.name,
    // Straight through, null included — a machine with no group starts the
    // form as null, so leaving the picker alone re-sends null rather than
    // "unchanged".
    machineGroupId: m.machineGroupId,
    productCode: m.productCode ?? undefined,
    machineType: m.machineType ?? undefined,
    capacityPerShift: m.capacityPerShift ?? undefined,
    shiftsPerDay: m.shiftsPerDay,
    status: m.status,
    hourRate: m.hourRate ?? undefined,
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

  // The group's own word ('VMC') for the picker to show. The lookup is the whole
  // group master in one cached fetch, shared with the list and detail pages, so
  // an edit form shows the machine's current group before the picker's own
  // search page has loaded — and still shows it for a group since retired.
  const groupLookup = useMachineGroupLookup();
  const machineGroupId = form.watch('machineGroupId') ?? null;
  const machineGroupLabel = machineGroupId ? (groupLookup.get(machineGroupId)?.code ?? null) : null;

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="form-grid">
        {/* Picked from the Machine Group master (Machine Master → Machine
            Groups tab), never typed — the shared type-to-search dropdown, per
            the `searchable-field` skill. Optional: existing machines have no
            group and must stay editable. */}
        <div className="form-grp">
          <label className="form-label" htmlFor="machineGroupId">
            Machine Group
          </label>
          <MachineGroupPicker
            id="machineGroupId"
            valueId={machineGroupId}
            valueText={machineGroupLabel}
            // null, never undefined: on the edit form undefined means "leave
            // this field alone", so clearing the group would silently do
            // nothing. null is the explicit "no group".
            onChange={(picked) => form.setValue('machineGroupId', picked, { shouldValidate: true })}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Code<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus
            autoComplete="off"
            placeholder="CNC-01"
            {...register('code')}
          />
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Machine Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            placeholder="CNC Turning Centre"
            {...register('name')}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="productCode">
            Product Code
          </label>
          <input
            id="productCode"
            className="innovic-input"
            autoComplete="off"
            {...register('productCode')}
          />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="machineType">
            Machine Type
          </label>
          <input
            id="machineType"
            className="innovic-input"
            autoComplete="off"
            placeholder="CNC Lathe, VMC, Grinding…"
            {...register('machineType')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="capacityPerShift">
            Hours per Shift
          </label>
          <input
            id="capacityPerShift"
            className="innovic-input"
            type="number"
            min={0}
            autoComplete="off"
            {...register('capacityPerShift', { setValueAs: blankToUndefined })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="shiftsPerDay">
            Shifts / Day
          </label>
          <select id="shiftsPerDay" className="innovic-select" {...register('shiftsPerDay')}>
            {SHIFTS_PER_DAY.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label green" htmlFor="hourRate">
            Hour Rate (₹/hr)
          </label>
          <input
            id="hourRate"
            className="innovic-input"
            type="number"
            min={0}
            step="0.01"
            autoComplete="off"
            {...register('hourRate', { setValueAs: blankToUndefined })}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Machine Status
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
        submitLabel={props.submitLabel ?? 'Save Machine'}
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

  // The group's own word ('VMC') for the picker to show. The lookup is the whole
  // group master in one cached fetch, shared with the list and detail pages, so
  // an edit form shows the machine's current group before the picker's own
  // search page has loaded — and still shows it for a group since retired.
  const groupLookup = useMachineGroupLookup();
  const machineGroupId = form.watch('machineGroupId') ?? null;
  const machineGroupLabel = machineGroupId ? (groupLookup.get(machineGroupId)?.code ?? null) : null;

  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        await props.onSubmit(values);
      })}
    >
      <div className="form-grid">
        {/* Picked from the Machine Group master (Machine Master → Machine
            Groups tab), never typed — the shared type-to-search dropdown, per
            the `searchable-field` skill. Optional: existing machines have no
            group and must stay editable. */}
        <div className="form-grp">
          <label className="form-label" htmlFor="machineGroupId">
            Machine Group
          </label>
          <MachineGroupPicker
            id="machineGroupId"
            valueId={machineGroupId}
            valueText={machineGroupLabel}
            // null, never undefined: on the edit form undefined means "leave
            // this field alone", so clearing the group would silently do
            // nothing. null is the explicit "no group".
            onChange={(picked) => form.setValue('machineGroupId', picked, { shouldValidate: true })}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            Code<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            placeholder="CNC-01"
            value={props.machine.code}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="name">
            Machine Name<span className="req">★</span>
          </label>
          <input
            id="name"
            className="innovic-input"
            autoComplete="off"
            placeholder="CNC Turning Centre"
            {...register('name')}
          />
          {errors.name?.message ? <div className="form-error">{errors.name.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="productCode">
            Product Code
          </label>
          <input
            id="productCode"
            className="innovic-input"
            autoComplete="off"
            {...register('productCode')}
          />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="machineType">
            Machine Type
          </label>
          <input
            id="machineType"
            className="innovic-input"
            autoComplete="off"
            placeholder="CNC Lathe, VMC, Grinding…"
            {...register('machineType')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="capacityPerShift">
            Hours per Shift
          </label>
          <input
            id="capacityPerShift"
            className="innovic-input"
            type="number"
            min={0}
            autoComplete="off"
            {...register('capacityPerShift', { setValueAs: blankToUndefined })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="shiftsPerDay">
            Shifts / Day
          </label>
          <select id="shiftsPerDay" className="innovic-select" {...register('shiftsPerDay')}>
            {SHIFTS_PER_DAY.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label green" htmlFor="hourRate">
            Hour Rate (₹/hr)
          </label>
          <input
            id="hourRate"
            className="innovic-input"
            type="number"
            min={0}
            step="0.01"
            autoComplete="off"
            {...register('hourRate', { setValueAs: blankToUndefined })}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Machine Status
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
        submitLabel={props.submitLabel ?? 'Save Changes'}
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
            color: 'var(--red2)',
            background: 'var(--red3)',
            border: '1px solid var(--sig-critical-bd)',
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
          {props.isSubmitting ? 'Saving…' : props.submitLabel}
        </button>
      </div>
    </div>
  );
}
