// GRN form (UI-003-05) — header + dynamic line items with inline QC fields.
// QC-completed lines lock client-side (server enforces with ConflictError).

import {
  type CreateGoodsReceiptNoteInput,
  GRN_QC_STATUSES,
  type GoodsReceiptNoteDetail,
  type GrnQcStatus,
  type UpdateGoodsReceiptNoteInput,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { LineItemPicker } from '@/components/shared/line-item-picker';
import { todayLocal } from '@/lib/date';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSession } from '@/lib/session';
import { useQcUserOptions } from '@/modules/qc-users/api';
import { NO_SERVER_SEARCH, qcSelectedLabel, toQcSearchOptions } from '@/modules/qc-users/options';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { useVendorsList } from '@/modules/vendors/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { GRN_QC_STATUS_LABELS } from '../lib/grn-labels';

interface LineFormValue {
  id?: string;
  existingQcStatus?: GrnQcStatus;
  purchaseOrderLineId?: string;
  itemId?: string;
  itemCodeText: string;
  itemName: string;
  receivedQty: number;
  dcRefNo?: string;
  qcStatus: GrnQcStatus;
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcDate?: string;
  qcRemarks?: string;
  /** Who inspected this line — the picked Access Control QC user, plus the name
   *  as it read on the day. Both are kept because the name is the record and the
   *  id is only the link: a signed-off inspection must not change wording when
   *  that person is later renamed or removed. */
  qcInspectedByUserId?: string | null;
  qcInspectedByName?: string | null;
  qcReportPath?: string | null;
  qcReportName?: string | null;
  remarks?: string;
}

interface FormValues {
  header: {
    code: string;
    grnDate: string;
    purchaseOrderId?: string;
    poCodeText?: string;
    vendorId?: string;
    vendorCodeText?: string;
    dcNo?: string;
    invoiceNo?: string;
    remarks?: string;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  // ISSUE-065 mech.1 (inlined expression, NOT fixed here — reported): this is
  // UTC-derived, so between 00:00 and 05:30 IST it defaults Date to YESTERDAY.
  // Legacy today() L1485-87 is correct because it reads LOCAL getFullYear/
  // getMonth/getDate. Also module-level, so it is frozen at first import.
  grnDate: todayLocal(),
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  itemName: '',
  receivedQty: 1,
  qcStatus: 'pending',
  qcAcceptedQty: 0,
  qcRejectedQty: 0,
  qcInspectedByUserId: null,
  qcInspectedByName: null,
};

type CreateMode = {
  mode: 'create';
  initialPurchaseOrderId?: string;
  onSubmit: (values: CreateGoodsReceiptNoteInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
} & HeaderSaveProps;

type EditMode = {
  mode: 'edit';
  detail: GoodsReceiptNoteDetail;
  onSubmit: (values: UpdateGoodsReceiptNoteInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
} & HeaderSaveProps;

/** When the page puts Save in its sticky PageHeader: the header's
 *  `<button type="submit" form={formId}>` submits this form, the bottom
 *  Cancel/Save bar is not rendered, and the form reports its state so the
 *  header button and "Not saved" pill stay truthful. */
interface HeaderSaveProps {
  formId?: string;
  onStatusChange?: (s: { submitting: boolean; canSubmit: boolean; dirty: boolean }) => void;
}

export type GoodsReceiptNoteFormProps = CreateMode | EditMode;

export function GoodsReceiptNoteForm(props: GoodsReceiptNoteFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : {
        header: {
          ...HEADER_DEFAULTS,
          ...(props.initialPurchaseOrderId
            ? { purchaseOrderId: props.initialPurchaseOrderId }
            : {}),
        },
        lines: [{ ...NEW_LINE }],
      };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const {
    register,
    control,
    handleSubmit,
    formState,
    setValue,
    setError,
    clearErrors,
    getValues,
    watch,
  } = form;
  const isCreate = !isEdit;
  const [docNoValid, setDocNoValid] = useState(true);
  const errors = formState.errors;
  const companyId = useSession().data?.companyId ?? null;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  const { onStatusChange } = props;
  const canSubmit = !formState.isSubmitting && !(isCreate && !docNoValid);
  useEffect(() => {
    onStatusChange?.({
      submitting: formState.isSubmitting,
      canSubmit,
      dirty: formState.isDirty,
    });
  }, [onStatusChange, formState.isSubmitting, formState.isDirty, canSubmit]);

  // One fetch for the whole form — every line's QC By box reads the same list,
  // and the query key is shared with the other QC By fields in the app.
  const qcUsers = useQcUserOptions();
  const qcOptions = useMemo(
    () => toQcSearchOptions(qcUsers.data?.options ?? []),
    [qcUsers.data?.options],
  );

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  const { data: posData } = usePurchaseOrdersList({ limit: 200, offset: 0 });
  const pos = (posData?.items ?? []).filter((p) =>
    ['draft', 'open', 'partial', 'qc_pending'].includes(p.status),
  );

  const selectedPoId = useWatch({ control, name: 'header.purchaseOrderId' });
  const { data: selectedPoDetail } = usePurchaseOrder(
    !isEdit && selectedPoId ? selectedPoId : undefined,
  );

  useEffect(() => {
    if (isEdit) return;
    if (!selectedPoDetail) return;
    const cur = getValues('lines');
    const isPristine = cur.length === 1 && cur[0]!.itemCodeText === '' && cur[0]!.itemName === '';
    if (!isPristine) return;
    if (!getValues('header.vendorId') && selectedPoDetail.vendorId) {
      setValue('header.vendorId', selectedPoDetail.vendorId, { shouldDirty: true });
    }
    const newLines = selectedPoDetail.lines
      .filter((l) => l.qty - l.receivedQty > 0)
      .map(
        (l): LineFormValue => ({
          purchaseOrderLineId: l.id,
          ...(l.itemId ? { itemId: l.itemId } : {}),
          itemCodeText: l.itemCodeText ?? '',
          itemName: l.itemName,
          receivedQty: l.qty - l.receivedQty,
          qcStatus: 'pending',
          qcAcceptedQty: 0,
          qcRejectedQty: 0,
          qcInspectedByUserId: null,
          qcInspectedByName: null,
        }),
      );
    if (newLines.length > 0) replace(newLines);
  }, [isEdit, selectedPoDetail, getValues, setValue, replace]);

  const onValid = async (values: FormValues): Promise<void> => {
    // A vendor is required on create (server enforces via the create schema
    // refine + migration 0080 CHECK). Either the vendor dropdown or the
    // free-text fallback satisfies it. Guard here so the user gets a friendly
    // message before submit instead of a 400 from the API.
    if (isCreate) {
      const hasVendor =
        Boolean(values.header.vendorId) || Boolean(values.header.vendorCodeText?.trim());
      if (!hasVendor) {
        setError('header.vendorId', {
          type: 'required',
          message: 'Select a vendor or enter a vendor code.',
        });
        return;
      }
      clearErrors('header.vendorId');
    }

    const headerOut = {
      ...values.header,
      purchaseOrderId: values.header.purchaseOrderId || undefined,
      poCodeText: values.header.poCodeText?.trim() || undefined,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || undefined,
      dcNo: values.header.dcNo?.trim() || undefined,
      invoiceNo: values.header.invoiceNo?.trim() || undefined,
      remarks: values.header.remarks?.trim() || undefined,
    };

    const linesOut = values.lines.map((l) => {
      const trimmedCode = l.itemCodeText.trim();
      const refs: { itemId?: string; itemCodeText?: string } = trimmedCode
        ? { itemCodeText: trimmedCode }
        : l.itemId
          ? { itemId: l.itemId }
          : {};
      return {
        ...(l.id ? { id: l.id } : {}),
        ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
        ...refs,
        itemName: l.itemName.trim(),
        receivedQty: Number(l.receivedQty),
        dcRefNo: l.dcRefNo?.trim() || undefined,
        qcStatus: l.qcStatus,
        qcAcceptedQty: Number(l.qcAcceptedQty),
        qcRejectedQty: Number(l.qcRejectedQty),
        qcDate: l.qcDate || undefined,
        qcRemarks: l.qcRemarks?.trim() || undefined,
        // Omitted entirely when nobody was picked, so a GRN saved without
        // touching QC sends exactly what it sent before this field existed.
        ...(l.qcInspectedByUserId ? { qcInspectedByUserId: l.qcInspectedByUserId } : {}),
        ...(l.qcInspectedByName?.trim() ? { qcInspectedByName: l.qcInspectedByName.trim() } : {}),
        qcReportPath: l.qcReportPath ?? undefined,
        qcReportName: l.qcReportName ?? undefined,
        remarks: l.remarks?.trim() || undefined,
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateGoodsReceiptNoteInput);
    }
  };

  return (
    <form id={props.formId} onSubmit={handleSubmit(onValid)}>
      {/* Save error summary right under the page header, where Save is. */}
      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}

      {/* Header — labels and placeholders from legacy addGRN() L26537-26550.
          No ★ on GRN No.: legacy renders it readonly/auto (L26538) and our
          schema has code .optional() — "blank = auto". Legacy resolves the
          vendor from the PO and shows it read-only (_grnRefreshPOLines
          L26672-26673); our vendor fields stay because they are the only vendor
          entry point without legacy's Manual mode. On the 12-column grid:
          party first, then the PO, then the vendor's paper numbers. */}
      <Panel title="GRN Details">
        <FormGrid>
          {/* Row 1 — Vendor · Vendor Code · GRN No. (6 + 3 + 3). */}
          <FormField
            label="Vendor"
            required
            size="lg"
            htmlFor="vendorId"
            error={errors.header?.vendorId?.message}
          >
            <select id="vendorId" className="innovic-select" {...register('header.vendorId')}>
              <option value="">— Type the Vendor Code below —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Vendor Code" size="sm" htmlFor="vendorCodeText">
            <input
              id="vendorCodeText"
              className="innovic-input"
              autoComplete="off"
              {...register('header.vendorCodeText')}
            />
          </FormField>
          <div className="f-sm">
            <DocNumberInput
              type="grn"
              label="GRN No."
              readOnly={isEdit}
              value={watch('header.code') ?? ''}
              onChange={(v) => setValue('header.code', v)}
              onValidityChange={setDocNoValid}
            />
          </div>

          {/* Row 2 — Purchase Order · PO No. (typed) · GRN Date (6 + 3 + 3). */}
          <FormField label="Purchase Order" size="lg" htmlFor="purchaseOrderId">
            <select
              id="purchaseOrderId"
              className="innovic-select"
              disabled={isEdit}
              {...register('header.purchaseOrderId')}
            >
              <option value="">— Type the PO No. below —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.vendorName ?? p.vendorCodeText ?? '—'}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="PO No. (typed)" size="sm" htmlFor="poCodeText">
            <input
              id="poCodeText"
              className="innovic-input"
              autoComplete="off"
              {...register('header.poCodeText')}
            />
          </FormField>
          <FormField label="GRN Date" required size="sm" htmlFor="grnDate">
            <input
              id="grnDate"
              type="date"
              className="innovic-input"
              {...register('header.grnDate', { required: 'GRN Date is required' })}
            />
          </FormField>

          {/* Row 3 — Vendor Invoice No. · Vendor Challan No. (6 + 6). */}
          <FormField label="Vendor Invoice No." size="lg" htmlFor="invoiceNo">
            <input
              id="invoiceNo"
              className="innovic-input"
              autoComplete="off"
              placeholder="Vendor invoice"
              {...register('header.invoiceNo')}
            />
          </FormField>
          <FormField label="Vendor Challan No." size="lg" htmlFor="dcNo">
            <input
              id="dcNo"
              className="innovic-input"
              autoComplete="off"
              placeholder="Delivery challan"
              {...register('header.dcNo')}
            />
          </FormField>

          {/* Row 4 — Remarks (full). Legacy uses <input> (L26542); kept as
              <textarea> — remarks is z.string().max(2000) so CR/LF survives. */}
          <FormField label="Remarks" size="full" htmlFor="remarks">
            <textarea
              id="remarks"
              className="innovic-textarea"
              rows={2}
              placeholder="Notes"
              {...register('header.remarks')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel
        title="Line Items"
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => append({ ...NEW_LINE })}
          >
            <Plus size={13} /> Add line
          </button>
        }
      >
        {fields.length === 0 ? (
          <div className="empty-state">
            No lines yet. Pick a PO above to auto-populate, or click <strong>Add line</strong>.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fields.map((field, idx) => {
              const locked = field.existingQcStatus === 'completed';
              return (
                <div
                  key={field.id}
                  style={{
                    border: `1px solid ${locked ? 'rgba(22,163,74,0.5)' : 'var(--border)'}`,
                    borderRadius: 8,
                    padding: 10,
                    background: 'var(--bg2)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--text3)',
                      fontFamily: 'var(--mono)',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    }}
                  >
                    <span>
                      Line {idx + 1}
                      {locked ? (
                        <span
                          className="badge b-green"
                          style={{ marginLeft: 8 }}
                          title="QC done — fix via a reversing GRN line."
                        >
                          QC locked
                        </span>
                      ) : null}
                    </span>
                    {!locked ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm btn-icon"
                        onClick={() => remove(idx)}
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </div>

                  <div className="form-grid-12">
                    {/* Shared item cell — enforces the system item-code rule (master
                      match ⇒ read-only auto-filled name; off-master ⇒ editable, itemId
                      null). Controller keeps the existing required-name validation and
                      onSubmit error display; code + itemId are mirrored via setValue so
                      the submit shape (onValid) is unchanged. */}
                    <Controller
                      control={control}
                      name={`lines.${idx}.itemName` as const}
                      rules={{ required: 'Item name is required' }}
                      render={({ field, fieldState }) => (
                        <LineItemPicker
                          code={watch(`lines.${idx}.itemCodeText`) ?? ''}
                          itemId={watch(`lines.${idx}.itemId`) ?? null}
                          itemName={field.value}
                          readOnly={locked}
                          nameError={fieldState.error?.message}
                          onChange={(next) => {
                            setValue(`lines.${idx}.itemCodeText`, next.code, { shouldDirty: true });
                            setValue(`lines.${idx}.itemId`, next.itemId ?? undefined, {
                              shouldDirty: true,
                            });
                            field.onChange(next.name);
                          }}
                        />
                      )}
                    />
                    <div className="form-grp">
                      <label className="form-label">
                        Received<span className="req">★</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        className="innovic-input"
                        readOnly={locked}
                        {...register(`lines.${idx}.receivedQty` as const, {
                          valueAsNumber: true,
                          min: { value: 0, message: 'Min 0' },
                        })}
                      />
                    </div>

                    <div className="form-grp">
                      <label className="form-label">Vendor Challan No.</label>
                      <input
                        className="innovic-input"
                        autoComplete="off"
                        readOnly={locked}
                        {...register(`lines.${idx}.dcRefNo` as const)}
                      />
                    </div>
                    <div className="form-grp">
                      <label className="form-label">QC Status</label>
                      <select
                        className="innovic-select"
                        disabled={locked}
                        {...register(`lines.${idx}.qcStatus` as const)}
                      >
                        {GRN_QC_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {GRN_QC_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-grp">
                      <label className="form-label">Accepted</label>
                      <input
                        type="number"
                        min={0}
                        className="innovic-input"
                        readOnly={locked}
                        {...register(`lines.${idx}.qcAcceptedQty` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </div>

                    <div className="form-grp">
                      <label className="form-label">Rejected</label>
                      <input
                        type="number"
                        min={0}
                        className="innovic-input"
                        readOnly={locked}
                        {...register(`lines.${idx}.qcRejectedQty` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                    <div className="form-grp">
                      <label className="form-label">QC Date</label>
                      <input
                        type="date"
                        className="innovic-input"
                        readOnly={locked}
                        {...register(`lines.${idx}.qcDate` as const)}
                      />
                    </div>
                    <div className="form-grp">
                      <label className="form-label">👤 Inspected By</label>
                      {/* Until now the server stamped whoever SAVED the GRN, which
                        is usually the storekeeper and not the inspector. Locked
                        the same way as QC Status above: disabled, but still
                        showing the recorded name. */}
                      <SearchableSelect
                        value={watch(`lines.${idx}.qcInspectedByUserId`) ?? null}
                        onChange={(id) => {
                          setValue(`lines.${idx}.qcInspectedByUserId`, id, { shouldDirty: true });
                          // Read the SHORTENED list, not the raw one, so the box and
                          // the dropdown agree -- and so the name stamped on the GRN
                          // line is the one the person actually saw. Null, not '',
                          // because this field is nullable.
                          const picked = qcOptions.find((u) => u.id === id);
                          setValue(
                            `lines.${idx}.qcInspectedByName`,
                            picked ? qcSelectedLabel(picked) : null,
                            { shouldDirty: true },
                          );
                        }}
                        options={qcOptions}
                        onSearch={NO_SERVER_SEARCH}
                        loading={qcUsers.isFetching}
                        valueLabel={watch(`lines.${idx}.qcInspectedByName`) ?? ''}
                        selectedLabel={qcSelectedLabel}
                        disabled={locked}
                        placeholder="🔍 Select QC person…"
                        emptyText="No QC users — set them up in Access Control"
                      />
                    </div>
                    <div className="form-grp f-lg">
                      <label className="form-label">QC Remarks</label>
                      <input
                        className="innovic-input"
                        autoComplete="off"
                        readOnly={locked}
                        {...register(`lines.${idx}.qcRemarks` as const)}
                      />
                    </div>

                    <div className="form-grp f-lg">
                      <label className="form-label">Line Remarks</label>
                      <input
                        className="innovic-input"
                        autoComplete="off"
                        readOnly={locked}
                        {...register(`lines.${idx}.remarks` as const)}
                      />
                    </div>

                    <div className="form-grp f-full">
                      <label className="form-label">QC Report</label>
                      {locked ? (
                        <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                          {watch(`lines.${idx}.qcReportName`) ?? '— none —'}
                        </div>
                      ) : (
                        <QcReportAttach
                          companyId={companyId}
                          fileName={watch(`lines.${idx}.qcReportName`) ?? null}
                          onUploaded={(path, name) => {
                            setValue(`lines.${idx}.qcReportPath`, path, { shouldDirty: true });
                            setValue(`lines.${idx}.qcReportName`, name, { shouldDirty: true });
                          }}
                          onClear={() => {
                            setValue(`lines.${idx}.qcReportPath`, null, { shouldDirty: true });
                            setValue(`lines.${idx}.qcReportName`, null, { shouldDirty: true });
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Bottom bar only when the page has not put Save in its sticky header. */}
      {props.formId ? null : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          {props.onCancel ? (
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save Changes' : 'Save GRN')}
          </button>
        </div>
      )}
    </form>
  );
}

function detailToFormValues(detail: GoodsReceiptNoteDetail): FormValues {
  return {
    header: {
      code: detail.code,
      grnDate: detail.grnDate,
      ...(detail.purchaseOrderId ? { purchaseOrderId: detail.purchaseOrderId } : {}),
      ...(detail.poCodeText ? { poCodeText: detail.poCodeText } : {}),
      ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
      ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
      ...(detail.dcNo ? { dcNo: detail.dcNo } : {}),
      ...(detail.invoiceNo ? { invoiceNo: detail.invoiceNo } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines: detail.lines.map(
      (l): LineFormValue => ({
        id: l.id,
        existingQcStatus: l.qcStatus,
        ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
        ...(l.itemId ? { itemId: l.itemId } : {}),
        itemCodeText: l.itemCodeText ?? '',
        itemName: l.itemName,
        receivedQty: l.receivedQty,
        ...(l.dcRefNo ? { dcRefNo: l.dcRefNo } : {}),
        qcStatus: l.qcStatus,
        qcAcceptedQty: l.qcAcceptedQty,
        qcRejectedQty: l.qcRejectedQty,
        ...(l.qcDate ? { qcDate: l.qcDate } : {}),
        ...(l.qcRemarks ? { qcRemarks: l.qcRemarks } : {}),
        ...(l.qcInspectedBy ? { qcInspectedByUserId: l.qcInspectedBy } : {}),
        ...(l.qcInspectedByText ? { qcInspectedByName: l.qcInspectedByText } : {}),
        ...(l.qcReportPath ? { qcReportPath: l.qcReportPath } : {}),
        ...(l.qcReportName ? { qcReportName: l.qcReportName } : {}),
        ...(l.remarks ? { remarks: l.remarks } : {}),
      }),
    ),
  };
}
