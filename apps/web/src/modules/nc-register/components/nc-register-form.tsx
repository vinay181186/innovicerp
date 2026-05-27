// NC create + light-edit form (UI-003-06).
// Create: full fields. Edit: only date / reason / reportedBy (status='pending').

import {
  type CreateNcRegisterInput,
  NC_REASON_CATEGORIES,
  NC_REASON_CATEGORY_LABELS,
  type NcReasonCategory,
  type NcRegister,
  type UpdateNcRegisterInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useItemsList } from '@/modules/items/api';
import { useJobCardsList } from '@/modules/job-cards/api';
import { useNcRegisterList } from '../api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';

interface FormValues {
  code: string;
  ncDate: string;
  jobCardId: string;
  jcOpId?: string;
  opSeq?: number;
  operationText?: string;
  qcOperationText?: string;
  itemId: string;
  itemNameText?: string;
  soCodeText?: string;
  machineCodeText?: string;
  operatorText?: string;
  rejectedQty: number;
  reasonCategory: NcReasonCategory;
  reason?: string;
  reportedByText?: string;
}

const DEFAULTS: FormValues = {
  code: '',
  ncDate: new Date().toISOString().slice(0, 10),
  jobCardId: '',
  itemId: '',
  rejectedQty: 1,
  reasonCategory: 'other',
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateNcRegisterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: NcRegister;
  onSubmit: (values: UpdateNcRegisterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type NcRegisterFormProps = CreateMode | EditMode;

export function NcRegisterForm(props: NcRegisterFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errors = formState.errors;

  const { data: jcData } = useJobCardsList({ limit: 200, offset: 0 });
  const jcs = jcData?.items ?? [];

  const { data: itemsData } = useItemsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];

  // Pull recent NCs to auto-suggest the next code (legacy `_nextNCNo` assigns
  // NC-NNNN from the running max). Only fetched in create mode.
  const { data: recentNcs } = useNcRegisterList(
    { limit: 200, offset: 0 },
    { enabled: !isEdit },
  );

  const selectedJcId = watch('jobCardId');

  // Operation dropdown depends on the selected JC's ops (legacy `_ncFillJC`,
  // HTML L22609). Reuses op-entry's enriched-ops hook (cross-module read hook).
  const { data: jcOps } = useJcOpsEnriched(
    { jobCardId: selectedJcId || undefined },
    { enabled: !isEdit && Boolean(selectedJcId) },
  );
  const opsForJc = useMemo(
    () => (jcOps ?? []).slice().sort((a, b) => a.opSeq - b.opSeq),
    [jcOps],
  );

  // Pre-fill a suggested NC code once on mount (create mode only). Manual edit
  // still allowed — server enforces uniqueness.
  useEffect(() => {
    if (isEdit) return;
    if (!recentNcs?.items) return;
    const current = watch('code');
    if (current && current.trim().length > 0) return;
    let max = 0;
    for (const r of recentNcs.items) {
      const num = Number.parseInt(String(r.code).replace(/\D/g, ''), 10);
      if (!Number.isNaN(num) && num > max) max = num;
    }
    setValue('code', `NC-${String(max + 1).padStart(4, '0')}`, { shouldDirty: false });
  }, [recentNcs, isEdit, setValue, watch]);

  useEffect(() => {
    if (isEdit) return;
    if (!selectedJcId) return;
    const jc = jcs.find((j) => j.id === selectedJcId);
    if (jc?.itemId) {
      setValue('itemId', jc.itemId, { shouldDirty: true });
      if (jc.itemName) {
        setValue('itemNameText', jc.itemName, { shouldDirty: true });
      }
    }
    // Reset the op selection when the JC changes — legacy clears `fRejOp`.
    setValue('jcOpId', undefined, { shouldDirty: false });
    setValue('opSeq', undefined, { shouldDirty: false });
    setValue('operationText', undefined, { shouldDirty: false });
  }, [selectedJcId, isEdit, jcs, setValue]);

  const onValid = async (values: FormValues): Promise<void> => {
    if (isEdit) {
      const payload: UpdateNcRegisterInput = {
        ncDate: values.ncDate,
        reasonCategory: values.reasonCategory,
        reason: values.reason?.trim() || undefined,
        reportedByText: values.reportedByText?.trim() || undefined,
        operatorText: values.operatorText?.trim() || undefined,
      };
      await props.onSubmit(payload);
    } else {
      const payload: CreateNcRegisterInput = {
        code: values.code.trim(),
        ncDate: values.ncDate,
        jobCardId: values.jobCardId,
        ...(values.jcOpId ? { jcOpId: values.jcOpId } : {}),
        ...(values.opSeq != null && !Number.isNaN(values.opSeq)
          ? { opSeq: Number(values.opSeq) }
          : {}),
        ...(values.operationText?.trim() ? { operationText: values.operationText.trim() } : {}),
        ...(values.qcOperationText?.trim()
          ? { qcOperationText: values.qcOperationText.trim() }
          : {}),
        itemId: values.itemId,
        ...(values.itemNameText?.trim() ? { itemNameText: values.itemNameText.trim() } : {}),
        ...(values.soCodeText?.trim() ? { soCodeText: values.soCodeText.trim() } : {}),
        ...(values.machineCodeText?.trim()
          ? { machineCodeText: values.machineCodeText.trim() }
          : {}),
        ...(values.operatorText?.trim() ? { operatorText: values.operatorText.trim() } : {}),
        rejectedQty: Number(values.rejectedQty),
        reasonCategory: values.reasonCategory,
        // Defect description is required (legacy L22591) — validated by RHF below.
        reason: values.reason?.trim() ?? '',
        ...(values.reportedByText?.trim() ? { reportedByText: values.reportedByText.trim() } : {}),
      };
      await props.onSubmit(payload);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid form-grid-3">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            NC No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            placeholder="NC-0010"
            {...register('code', { required: !isEdit ? 'NC No. is required' : false })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="ncDate"
            type="date"
            className="innovic-input"
            {...register('ncDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="reportedByText">
            Reported by
          </label>
          <input
            id="reportedByText"
            className="innovic-input"
            autoComplete="off"
            placeholder="Operator name (snapshot)"
            {...register('reportedByText')}
          />
        </div>

        {!isEdit ? (
          <>
            <div className="form-grp">
              <label className="form-label" htmlFor="jobCardId">
                Job card<span className="req">★</span>
              </label>
              <select
                id="jobCardId"
                className="innovic-select"
                {...register('jobCardId', { required: 'Job card is required' })}
              >
                <option value="">— Pick a JC —</option>
                {jcs.map((jc) => (
                  <option key={jc.id} value={jc.id}>
                    {jc.code} — {jc.itemCode} {jc.itemName}
                  </option>
                ))}
              </select>
              {errors.jobCardId?.message ? (
                <div className="form-error">{errors.jobCardId.message}</div>
              ) : null}
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="itemId">
                Item<span className="req">★</span>
              </label>
              <select
                id="itemId"
                className="innovic-select"
                {...register('itemId', { required: 'Item is required' })}
              >
                <option value="">— Auto-fills from JC —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.name}
                  </option>
                ))}
              </select>
              {errors.itemId?.message ? (
                <div className="form-error">{errors.itemId.message}</div>
              ) : null}
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="soCodeText">
                SO No. (snapshot)
              </label>
              <input
                id="soCodeText"
                className="innovic-input"
                autoComplete="off"
                placeholder="SO-436"
                {...register('soCodeText')}
              />
            </div>

            <div className="form-grp">
              <label className="form-label" htmlFor="jcOpId">
                Operation
              </label>
              {opsForJc.length > 0 ? (
                <select
                  id="jcOpId"
                  className="innovic-select"
                  value={watch('jcOpId') ?? ''}
                  onChange={(e) => {
                    const opId = e.target.value;
                    const op = opsForJc.find((o) => o.id === opId);
                    setValue('jcOpId', opId || undefined, { shouldDirty: true });
                    setValue('opSeq', op ? op.opSeq : undefined, { shouldDirty: true });
                    setValue('operationText', op ? op.operation : undefined, {
                      shouldDirty: true,
                    });
                  }}
                >
                  <option value="">{selectedJcId ? '— Select op —' : '— Pick a JC first —'}</option>
                  {opsForJc.map((op) => (
                    <option key={op.id} value={op.id}>
                      Op{op.opSeq}: {op.operation}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="operationText"
                  className="innovic-input"
                  autoComplete="off"
                  placeholder={selectedJcId ? 'No ops on this JC — type one' : 'DIR / TURN / S1'}
                  {...register('operationText')}
                />
              )}
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="operatorText">
                Operator
              </label>
              <input
                id="operatorText"
                className="innovic-input"
                autoComplete="off"
                placeholder="Operator who ran the op"
                {...register('operatorText')}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="machineCodeText">
                Machine
              </label>
              <input
                id="machineCodeText"
                className="innovic-input"
                autoComplete="off"
                placeholder="QC / M-001"
                {...register('machineCodeText')}
              />
            </div>

            <div className="form-grp">
              <label className="form-label" htmlFor="rejectedQty">
                Rejected qty<span className="req">★</span>
              </label>
              <input
                id="rejectedQty"
                type="number"
                min={1}
                step="0.01"
                className="innovic-input"
                {...register('rejectedQty', {
                  valueAsNumber: true,
                  min: { value: 0.01, message: 'Must be > 0' },
                })}
              />
              {errors.rejectedQty?.message ? (
                <div className="form-error">{errors.rejectedQty.message}</div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="form-grp">
          <label className="form-label" htmlFor="reasonCategory">
            Reason category
          </label>
          <select id="reasonCategory" className="innovic-select" {...register('reasonCategory')}>
            {NC_REASON_CATEGORIES.map((r) => (
              <option key={r} value={r}>
                {NC_REASON_CATEGORY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="reason">
            Problem / Defect description<span className="req">★</span>
          </label>
          <textarea
            id="reason"
            className="innovic-textarea"
            rows={3}
            placeholder="Describe the defect or problem in detail…"
            {...register('reason', {
              validate: (v) =>
                (v?.trim().length ?? 0) > 0 || 'Describe the problem/defect',
            })}
          />
          {errors.reason?.message ? (
            <div className="form-error">{errors.reason.message}</div>
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
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Report NC')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: NcRegister): FormValues {
  return {
    code: detail.code,
    ncDate: detail.ncDate,
    jobCardId: detail.jobCardId,
    ...(detail.jcOpId ? { jcOpId: detail.jcOpId } : {}),
    ...(detail.opSeq != null ? { opSeq: detail.opSeq } : {}),
    ...(detail.operationText ? { operationText: detail.operationText } : {}),
    ...(detail.qcOperationText ? { qcOperationText: detail.qcOperationText } : {}),
    itemId: detail.itemId,
    ...(detail.itemNameText ? { itemNameText: detail.itemNameText } : {}),
    ...(detail.soCodeText ? { soCodeText: detail.soCodeText } : {}),
    ...(detail.machineCodeText ? { machineCodeText: detail.machineCodeText } : {}),
    ...(detail.operatorText ? { operatorText: detail.operatorText } : {}),
    rejectedQty: Number(detail.rejectedQty),
    reasonCategory: detail.reasonCategory,
    ...(detail.reason ? { reason: detail.reason } : {}),
    ...(detail.reportedByText ? { reportedByText: detail.reportedByText } : {}),
  };
}
