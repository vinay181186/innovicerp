// NC create + light-edit form (UI-003-06).
// Create: full fields. Edit: only date / reason / reportedBy (status='pending').
// Create-page pattern: the form draws its own sticky PageHeader (Back · title ·
// Cancel · blue Save), so Save never scrolls away; Ctrl+S saves; an amber
// "Not saved" pill shows once a field is edited. No Save button at the bottom.

import {
  type CreateNcRegisterInput,
  type JobCardListItem,
  NC_REASON_CATEGORIES,
  NC_REASON_CATEGORY_LABELS,
  type NcReasonCategory,
  type NcRegister,
  type UpdateNcRegisterInput,
  opSrNo,
  QTY_STEP,
  qtyUomProblem,
} from '@innovic/shared';
import { todayIst } from '@/lib/date';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { useJobCard, useJobCardsList } from '@/modules/job-cards/api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { PageHeader, useSaveShortcut } from '@/ui/layout';

interface FormValues {
  code: string;
  ncDate: string;
  jobCardId: string;
  jcOpId?: string;
  opSeq?: number;
  operationText?: string;
  qcOperationText?: string;
  itemId: string;
  itemCodeText?: string;
  itemNameText?: string;
  /** The picked SO's id (0184) — sent with its code so the NC links to the SO. */
  soId?: string;
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
  ncDate: todayIst(),
  jobCardId: '',
  itemId: '',
  rejectedQty: 1,
  reasonCategory: 'other',
};

/** The sticky page header the form draws above its fields. */
type HeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  /** "Back to NC Register" — names where Back returns to. */
  backLabel: string;
  onBack: () => void;
};

type CreateMode = HeaderProps & {
  mode: 'create';
  /** Seed values, laid OVER the blank defaults. Used when the form is opened
   *  from a QC operation card, which already knows the job card, the item, the
   *  operation and how many pieces it rejected. */
  initial?: Partial<FormValues>;
  onSubmit: (values: CreateNcRegisterInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = HeaderProps & {
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
  const seed = props.mode === 'create' ? props.initial : undefined;
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : { ...DEFAULTS, ...seed };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errors = formState.errors;

  // JC No. is a searchable picker (server search), not a fixed list of the
  // latest 200 — older JCs were unreachable. The picked row is kept so the
  // item / SO prefill still works after the search term changes.
  const [jcSearch, setJcSearch] = useState('');
  const { data: jcData, isFetching: jcFetching } = useJobCardsList(
    { search: jcSearch || undefined, limit: 50, offset: 0 },
    { enabled: !isEdit },
  );
  const jcs = useMemo(() => jcData?.items ?? [], [jcData]);
  const [pickedJc, setPickedJc] = useState<JobCardListItem | null>(null);
  const jcOptions = jcs.map((jc) => ({
    id: jc.id,
    code: jc.code,
    // CODE/REV so two job cards on the same part at different drawing
    // revisions can be told apart. What the pick WRITES stays bare — the
    // prefill effect sets itemCodeText from jc.itemCode alone.
    name: `${itemCodeWithRev(jc.itemCode, jc.itemRevision, '')} ${jc.itemName}`.trim(),
  }));

  // SO No.: the picker stores the chosen SO's code (the soCodeText snapshot)
  // AND its id (soId, 0184 — the real link the server stores).
  const [soSearch, setSoSearch] = useState('');
  const soQuery = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const soOptions = (soQuery.data?.items ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.customerName ?? '',
  }));

  const selectedJcId = watch('jobCardId');

  // The job card the form OPENED on (seeded from a QC op card). It may not be
  // in the searched list, so it is fetched by id — the JC box shows its code
  // and the item / SO prefill can read it.
  const seededJcId = useRef(defaults.jobCardId);
  const { data: seededJc } = useJobCard(
    !isEdit && seededJcId.current ? seededJcId.current : undefined,
  );
  const resolveJc = (id: string): JobCardListItem | undefined =>
    (pickedJc?.id === id ? pickedJc : undefined) ??
    jcs.find((j) => j.id === id) ??
    (seededJc?.id === id ? seededJc : undefined);

  // Operation dropdown depends on the selected JC's ops (legacy `_ncFillJC`,
  // HTML L22609). Reuses op-entry's enriched-ops hook (cross-module read hook).
  const { data: jcOps } = useJcOpsEnriched(
    { jobCardId: selectedJcId || undefined },
    { enabled: !isEdit && Boolean(selectedJcId) },
  );
  const opsForJc = useMemo(() => (jcOps ?? []).slice().sort((a, b) => a.opSeq - b.opSeq), [jcOps]);

  // NC No. is assigned by the server on save (NC series, like an ERPNext
  // naming series) — the form shows "Auto" and sends no code.

  // Op fields are reset only when the JC actually CHANGES — not when the
  // searched JC list refreshes, and not on mount when the op card seeded a JC
  // and an operation (legacy behaviour, `fRejOp`).
  const prevJcId = useRef(defaults.jobCardId);
  // The SO No. this form last filled from a JC. When the JC changes and SO No.
  // still holds that value (the user did not type over it), it follows the
  // new JC.
  const autoSoCode = useRef<string | null>(null);

  useEffect(() => {
    if (isEdit) return;
    const jcChanged = selectedJcId !== prevJcId.current;
    prevJcId.current = selectedJcId;
    if (jcChanged) {
      // Reset the op selection when the JC changes — legacy clears `fRejOp`.
      setValue('jcOpId', undefined, { shouldDirty: false });
      setValue('opSeq', undefined, { shouldDirty: false });
      setValue('operationText', undefined, { shouldDirty: false });
    }
    if (!selectedJcId) {
      // No JC → no item: Item Code is locked to the JC's part.
      if (jcChanged) {
        setValue('itemId', '', { shouldDirty: true });
        setValue('itemCodeText', undefined, { shouldDirty: true });
        setValue('itemNameText', undefined, { shouldDirty: true });
      }
      return;
    }
    const jc = resolveJc(selectedJcId);
    if (!jc) return;
    if (jc.itemId) {
      setValue('itemId', jc.itemId, { shouldDirty: true });
      if (jc.itemCode) {
        setValue('itemCodeText', jc.itemCode, { shouldDirty: true });
      }
      if (jc.itemName) {
        setValue('itemNameText', jc.itemName, { shouldDirty: true });
      }
    }
    // Fetch-from: the JC already knows its SO — fill SO No. when it is blank
    // or still holds the value filled from the previous JC.
    const currentSo = watch('soCodeText') ?? '';
    if (!currentSo || currentSo === autoSoCode.current) {
      const jcSo = jc.sourceLink?.type === 'so' ? jc.sourceLink.code : '';
      if (jcSo !== currentSo) {
        setValue('soCodeText', jcSo, { shouldDirty: true });
        // 0184 — the JC's own SO id travels with its code.
        setValue('soId', jc.sourceLink?.type === 'so' ? jc.sourceLink.salesOrderId : undefined, {
          shouldDirty: true,
        });
      }
      autoSoCode.current = jcSo || null;
    }
  }, [selectedJcId, isEdit, jcs, pickedJc, seededJc, setValue, watch]);

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
      // No `code`: the server assigns the next NC No.
      const payload: CreateNcRegisterInput = {
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
        ...(values.soId && values.soCodeText?.trim() ? { soId: values.soId } : {}),
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

  const submit = handleSubmit(onValid);
  useSaveShortcut(() => void submit(), !formState.isSubmitting);

  return (
    <form onSubmit={submit}>
      <PageHeader
        sticky
        title={props.title}
        subtitle={props.subtitle}
        backLabel={props.backLabel}
        onBack={props.onBack}
        dirty={formState.isDirty}
        actions={
          <>
            {props.onCancel ? (
              <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
              {formState.isSubmitting
                ? 'Saving…'
                : (props.submitLabel ?? (isEdit ? 'Save Changes' : 'Save NC'))}
            </button>
          </>
        }
      />
      {props.submitError ? (
        <div
          style={{
            color: 'var(--red2)',
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
      <div className="panel">
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" htmlFor="code">
                NC No.
              </label>
              <input
                id="code"
                className="innovic-input"
                autoComplete="off"
                readOnly
                placeholder="Auto"
                {...register('code')}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ncDate">
                NC Date<span className="req">★</span>
              </label>
              <input
                id="ncDate"
                type="date"
                className="innovic-input"
                {...register('ncDate', { required: 'NC Date is required.' })}
              />
            </div>

            {!isEdit ? (
              <>
                <div className="form-grp">
                  <label className="form-label" htmlFor="jobCardId">
                    JC No.<span className="req">★</span>
                  </label>
                  <SearchableSelect
                    id="jobCardId"
                    value={selectedJcId || null}
                    valueLabel={selectedJcId ? resolveJc(selectedJcId)?.code : undefined}
                    onChange={(id) => {
                      setPickedJc(jcs.find((j) => j.id === id) ?? null);
                      setValue('jobCardId', id ?? '', { shouldDirty: true, shouldValidate: true });
                    }}
                    onSearch={setJcSearch}
                    loading={jcFetching}
                    placeholder="Search JC No. or item…"
                    options={jcOptions}
                  />
                  <input
                    type="hidden"
                    {...register('jobCardId', { required: 'JC No. is required.' })}
                  />
                  {errors.jobCardId?.message ? (
                    <div className="form-error">{errors.jobCardId.message}</div>
                  ) : null}
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="itemCodeText">
                    Item Code<span className="req">★</span>
                  </label>
                  {/* Locked to the picked JC's part (CODE/REV — name): an NC
                      saying JC-A with part B mis-books the rejection. The
                      server enforces the same rule. */}
                  <input
                    id="itemCodeText"
                    className="innovic-input"
                    readOnly
                    tabIndex={-1}
                    placeholder="Fills from JC"
                    style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)' }}
                    value={(() => {
                      const jc = selectedJcId ? resolveJc(selectedJcId) : undefined;
                      const code = itemCodeWithRev(
                        jc?.itemCode ?? watch('itemCodeText'),
                        jc?.itemRevision,
                        '',
                      );
                      const name = jc?.itemName ?? watch('itemNameText') ?? '';
                      return code ? (name ? `${code} — ${name}` : code) : '';
                    })()}
                  />
                  {/* itemId is the submitted value; hidden so RHF can validate it. */}
                  <input
                    type="hidden"
                    {...register('itemId', { required: 'Item Code is required.' })}
                  />
                  {errors.itemId?.message ? (
                    <div className="form-error">{errors.itemId.message}</div>
                  ) : null}
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="nc-so">
                    SO No.
                  </label>
                  <SearchableSelect
                    id="nc-so"
                    value={
                      watch('soId') ??
                      soOptions.find((o) => o.code === watch('soCodeText'))?.id ??
                      null
                    }
                    valueLabel={watch('soCodeText') || undefined}
                    onChange={(id) => {
                      const so = soOptions.find((o) => o.id === id);
                      setValue('soCodeText', so?.code ?? '', { shouldDirty: true });
                      setValue('soId', so?.id, { shouldDirty: true });
                    }}
                    onSearch={setSoSearch}
                    loading={soQuery.isFetching}
                    placeholder="Search SO No. or customer…"
                    options={soOptions}
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
                      <option value="">
                        {selectedJcId ? '-- Select Op --' : '-- Select JC first --'}
                      </option>
                      {opsForJc.map((op) => (
                        <option key={op.id} value={op.id}>
                          Op {opSrNo(op.opSeq)}: {op.operation}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="operationText"
                      className="innovic-input"
                      autoComplete="off"
                      placeholder={selectedJcId ? 'No ops on this JC — type one' : 'Operation'}
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
                    placeholder="Machine"
                    {...register('machineCodeText')}
                  />
                </div>

                <div className="form-grp">
                  <label className="form-label" htmlFor="rejectedQty">
                    Rejected<span className="req">★</span>
                  </label>
                  <input
                    id="rejectedQty"
                    type="number"
                    min={QTY_STEP}
                    step={QTY_STEP}
                    placeholder="Qty"
                    className="innovic-input fw-700 red"
                    {...register('rejectedQty', {
                      valueAsNumber: true,
                      // The unit rule (whole pieces for NOS / SET) is the server's.
                      validate: (v) =>
                        !(v > 0)
                          ? 'Rejected must be more than 0.'
                          : (qtyUomProblem(v, null, 'Rejected') ?? true),
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
                Reason Category
              </label>
              <select
                id="reasonCategory"
                className="innovic-select"
                {...register('reasonCategory')}
              >
                {NC_REASON_CATEGORIES.map((r) => (
                  <option key={r} value={r}>
                    {NC_REASON_CATEGORY_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="reportedByText">
                Reported By
              </label>
              <input
                id="reportedByText"
                className="innovic-input"
                autoComplete="off"
                placeholder="Name"
                {...register('reportedByText')}
              />
            </div>

            <div className="form-grp form-full">
              <label className="form-label" htmlFor="reason">
                Defect Description<span className="req">★</span>
              </label>
              <textarea
                id="reason"
                className="innovic-textarea"
                rows={3}
                placeholder="Describe the defect or problem in detail..."
                {...register('reason', {
                  validate: (v) => (v?.trim().length ?? 0) > 0 || 'Defect Description is required.',
                })}
              />
              {errors.reason?.message ? (
                <div className="form-error">{errors.reason.message}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: NcRegister): FormValues {
  return {
    code: detail.code,
    ncDate: detail.ncDate,
    jobCardId: detail.jobCardId ?? '',
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
