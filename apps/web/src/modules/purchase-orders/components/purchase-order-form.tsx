// Purchase Order form (UI-003-04) — header + dynamic line items.

import {
  type CreatePurchaseOrderInput,
  PO_STATUSES,
  PO_TYPES,
  type PurchaseOrderDetail,
  type UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { todayLocal } from '@/lib/date';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { inrFormat } from '@/lib/print/doc-print';
import { useItemsList } from '@/modules/items/api';
import {
  PO_ITEM_DATALIST_ID,
  type PoFormValues as FormValues,
  type PoLineFormValue as LineFormValue,
} from './po-form-values';
import { type PoItemMaster, PoLineRow } from './po-line-row';
import { PoVendorField } from './po-vendor-field';

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  // ISSUE-065 mech 1 (reported, not fixed here — a fix is a logic change): this is
  // today in UTC, so between 00:00 and 05:29 IST it defaults the PO to YESTERDAY.
  // Legacy `today()` L1485-87 builds the string from LOCAL date components and is
  // correct; this is a port regression.
  poDate: todayLocal(),
  poType: 'standard',
  status: 'draft',
  sgstPct: 0,
  cgstPct: 0,
  igstPct: 0,
};

const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  itemName: '',
  qty: 1,
  rate: 0,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreatePurchaseOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: PurchaseOrderDetail;
  onSubmit: (values: UpdatePurchaseOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type PurchaseOrderFormProps = CreateMode | EditMode;

export function PurchaseOrderForm(props: PurchaseOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, setValue, watch } = form;
  const isCreate = !isEdit;
  const [docNoValid, setDocNoValid] = useState(true);
  // Line-level errors are rendered by <PoLineRow>, which reads them off the same
  // `form` — the formState proxy subscribes wherever it is read.
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // Vendor is <PoVendorField> — the shared type-to-search picker, which owns its
  // own search state and vendor list. The free-text "Vendor code (fallback)" input
  // it replaced is gone, but `vendorCodeText` is NOT: it stays in form state and
  // `onValid` re-sends it unchanged, because a PO raised before this change may
  // hold free text and no `vendorId`, and both the Zod refine and the DB CHECK
  // (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015) demand one of the
  // two. Dropping it would make those POs unsaveable.
  const carriedVendorText = isEdit ? (props.detail.vendorCodeText?.trim() ?? '') : '';

  // Item master drives the per-line code autosuggest + name auto-fill. PO still
  // accepts off-master free text, so a non-matching code is left untouched.
  const { data: itemsData } = useItemsList({ limit: 1000, offset: 0 });
  const items = itemsData?.items ?? [];
  // Until this has actually arrived, every code looks off-master — so the line
  // cascade stays inert rather than resetting names against a master it can't see.
  const itemsLoaded = itemsData !== undefined;
  const itemsByCode = useMemo(() => {
    const m = new Map<string, PoItemMaster>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  // Live totals — mirror of legacy `_poUpdateTotal()` L25502. Preview only; see the
  // note at the summary panel. Legacy falls back to 9/9/18 when a pct box is blank;
  // our header defaults are 0 (schema `.default(0)`) and are left alone here.
  const watchedLines = watch('lines');
  const watchedTaxType = watch('header.taxType');
  const isIgst = watchedTaxType === 'igst';
  const sgstPctNum = Number(watch('header.sgstPct')) || 0;
  const cgstPctNum = Number(watch('header.cgstPct')) || 0;
  const igstPctNum = Number(watch('header.igstPct')) || 0;
  const subtotal = (watchedLines ?? []).reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0),
    0,
  );
  const totalQty = (watchedLines ?? []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const igst = isIgst ? (subtotal * igstPctNum) / 100 : 0;
  const sgst = isIgst ? 0 : (subtotal * sgstPctNum) / 100;
  const cgst = isIgst ? 0 : (subtotal * cgstPctNum) / 100;
  const grandTotal = subtotal + sgst + cgst + igst;

  // Legacy's 9-column line table (L25489); `Received` is an extra column of ours,
  // appended last so legacy's own column order is preserved.
  const colCount = isEdit ? 10 : 9;
  const remarksSpan = isEdit ? 8 : 7;

  const onValid = async (values: FormValues): Promise<void> => {
    const headerOut = {
      ...values.header,
      // Blank → undefined so the server auto-generates IN-PO-#####; '' fails
      // the schema's code.min(1) → "request validation failed" (T22/T20).
      code: values.header.code?.trim() || undefined,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || undefined,
      taxType: values.header.taxType?.trim() || undefined,
      dueDate: values.header.dueDate || undefined,
      prCodeText: values.header.prCodeText?.trim() || undefined,
      approvalRemarks: values.header.approvalRemarks?.trim() || undefined,
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
        ...refs,
        itemName: l.itemName.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate),
        dueDate: l.dueDate || undefined,
        lineRemarks: l.lineRemarks?.trim() || undefined,
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreatePurchaseOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      {/* Header — packed to the SO-Master 4-up grid (was legacy's 2-col
          `.form-grid`, L25605): 7 short fields fit two 4-across rows above the
          fold; Vendor spans two columns (it replaced the old Vendor `<select>` +
          free-text fallback pair) and Remarks spans the bottom row. */}
      <div className="form-grid-4">
        <DocNumberInput
          type="purchase_order"
          label="PO No."
          readOnly={isEdit}
          value={watch('header.code') ?? ''}
          onChange={(v) => setValue('header.code', v)}
          onValidityChange={setDocNoValid}
        />
        <div className="form-grp">
          <label className="form-label" htmlFor="poDate">
            PO Date<span className="req">★</span>
          </label>
          <input
            id="poDate"
            type="date"
            className="innovic-input"
            {...register('header.poDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="poType">
            PO Type
          </label>
          <select id="poType" className="innovic-select" {...register('header.poType')}>
            {/* Meaningful types on this form: standard (a buy), job work (send
                material out to a vendor), and service (a service purchase).
                'outsource' is dead (behaves like standard), so it stays hidden
                to prevent mis-filing. */}
            {PO_TYPES.filter((t) => t === 'standard' || t === 'job_work' || t === 'service').map(
              (t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Status
          </label>
          {/* Status is READ-ONLY once the PO exists. It moves ONLY through the
              dedicated approve / reject / cancel actions (the state machine),
              never a raw edit — so on EDIT we show the current status but never
              let it be re-picked. On CREATE the initial draft/open choice is
              still fine (it's driven by approval config server-side). */}
          {isEdit ? (
            <input
              id="status"
              className="innovic-input"
              readOnly
              title="Status changes only via Approve / Reject / Cancel, not a plain edit"
              style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
              value={watch('header.status')?.replaceAll('_', ' ') ?? ''}
            />
          ) : (
            <select id="status" className="innovic-select" {...register('header.status')}>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          )}
        </div>

        <PoVendorField
          form={form}
          carriedVendorText={carriedVendorText}
          initialLabel={props.mode === 'edit' ? (props.detail.vendorName ?? '') : ''}
        />
        <div className="form-grp">
          <label className="form-label" htmlFor="dueDate">
            Due date
          </label>
          <input id="dueDate" type="date" className="innovic-input" {...register('header.dueDate')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="prCodeText">
            PR ref (audit)
          </label>
          <input
            id="prCodeText"
            className="innovic-input"
            autoComplete="off"
            placeholder="PR-NNNNN (when applicable)"
            {...register('header.prCodeText')}
          />
        </div>
        {/* Legacy L25661 uses a single-line <input> here. Kept as a textarea: the
            column is max(2000) and may already hold multi-line text, which an
            <input> silently strips on value assignment (ISSUE-104 class). */}
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">
            Remarks
          </label>
          <textarea
            id="remarks"
            className="innovic-textarea"
            rows={2}
            placeholder="Notes"
            {...register('header.remarks')}
          />
        </div>
      </div>

      {/* Line items — legacy `poHeaderForm()` L25664-25674 + `_poLinesHtml()` L25487. */}
      <div>
        <div
          className="mono fw-700 cyan"
          style={{
            fontSize: 11,
            margin: '12px 0 6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>▸ PO LINE ITEMS</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 11, fontWeight: 400 }}>
              {fields.length} line{fields.length !== 1 ? 's' : ''} · Qty:{' '}
              <b className="cyan">{totalQty}</b>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => append({ ...NEW_LINE })}
            >
              + Add Line
            </button>
          </div>
        </div>

        <div
          style={{
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          <div className="tbl-wrap">
            <table className="innovic-table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Item / SO Line ★</th>
                  <th>Name</th>
                  <th>Mat.</th>
                  <th style={{ width: 80 }}>Qty ★</th>
                  <th style={{ width: 90 }}>Rate (₹)</th>
                  <th style={{ width: 85, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 85 }}>Due Date</th>
                  {isEdit ? <th style={{ width: 80 }}>Received</th> : null}
                  <th style={{ width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="empty-state" style={{ padding: 14 }}>
                      No lines — click + Add Line
                    </td>
                  </tr>
                ) : (
                  fields.map((field, idx) => (
                    // Keyed by the field-array id, not the index: a row keeps its
                    // React identity — and with it the cascade's memory of what it
                    // auto-filled — when a line above it is removed.
                    <PoLineRow
                      key={field.id}
                      form={form}
                      idx={idx}
                      line={watchedLines?.[idx]}
                      isEdit={isEdit}
                      receivedQty={field.receivedQty}
                      itemsByCode={itemsByCode}
                      itemsLoaded={itemsLoaded}
                      remarksSpan={remarksSpan}
                      rowBg={idx % 2 === 0 ? 'var(--bg)' : 'var(--bg3)'}
                      onRemove={() => remove(idx)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TAX — legacy L25675-25712. */}
        <div
          style={{
            marginTop: 12,
            padding: 14,
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 14,
            }}
          >
            <div>
              <div
                className="mono fw-700 cyan"
                style={{ fontSize: 11, letterSpacing: '.06em', marginBottom: 8 }}
              >
                ▸ TAX
              </div>
              {/* Legacy uses a 2-state toggle (`_poTaxToggle` L25563) that can only ever
                  write 'sgst_cgst' | 'igst'. Kept as a select: our `taxType` column is a
                  free string and existing rows may hold null / 'none', which the toggle
                  cannot represent and would silently rewrite on edit (ISSUE-104). */}
              <div className="form-grp" style={{ marginBottom: 10, maxWidth: 200 }}>
                <label className="form-label" htmlFor="taxType">
                  Tax type
                </label>
                <select id="taxType" className="innovic-select" {...register('header.taxType')}>
                  <option value="">— None —</option>
                  <option value="sgst_cgst">SGST + CGST</option>
                  <option value="igst">IGST</option>
                  <option value="none">None</option>
                </select>
              </div>
              {isIgst ? (
                <div className="form-grp" style={{ maxWidth: 120 }}>
                  <label className="form-label" htmlFor="igstPct">
                    IGST %
                  </label>
                  <input
                    id="igstPct"
                    type="number"
                    step="0.01"
                    min={0}
                    className="innovic-input"
                    {...register('header.igstPct', { valueAsNumber: true })}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div className="form-grp" style={{ maxWidth: 120 }}>
                    <label className="form-label" htmlFor="sgstPct">
                      SGST %
                    </label>
                    <input
                      id="sgstPct"
                      type="number"
                      step="0.01"
                      min={0}
                      className="innovic-input"
                      {...register('header.sgstPct', { valueAsNumber: true })}
                    />
                  </div>
                  <div className="form-grp" style={{ maxWidth: 120 }}>
                    <label className="form-label" htmlFor="cgstPct">
                      CGST %
                    </label>
                    <input
                      id="cgstPct"
                      type="number"
                      step="0.01"
                      min={0}
                      className="innovic-input"
                      {...register('header.cgstPct', { valueAsNumber: true })}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Preview of unsaved form input only: neither create nor update transmits a
                total (`createPurchaseOrderInputSchema` has no total field) and the service
                stores only taxType + pcts — so no server-owned figure is recomputed here. */}
            <div style={{ minWidth: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ minWidth: 300 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span className="text2">Subtotal</span>
                    <span className="mono fw-700" style={{ fontSize: 14 }}>
                      ₹{inrFormat(subtotal)}
                    </span>
                  </div>
                  {isIgst ? (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 0',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span className="text2">IGST ({igstPctNum}%)</span>
                      <span className="mono amber">₹{inrFormat(igst)}</span>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span className="text2">SGST ({sgstPctNum}%)</span>
                        <span className="mono amber">₹{inrFormat(sgst)}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span className="text2">CGST ({cgstPctNum}%)</span>
                        <span className="mono amber">₹{inrFormat(cgst)}</span>
                      </div>
                    </>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      fontSize: 16,
                    }}
                  >
                    <span className="fw-700">Grand Total</span>
                    <span className="mono fw-700 green" style={{ fontSize: 18 }}>
                      ₹{inrFormat(grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Legacy L25713 prints "📌 Items must exist in Item Master. If SO/JW is
            selected, lines auto-populate." Not copied: neither claim is true here —
            our schema accepts off-master `itemCodeText`, and the SO/JW link has no
            header field to bind to. Shipping it would describe constraints nothing
            enforces (ISSUE-100). */}
      </div>

      <datalist id={PO_ITEM_DATALIST_ID}>
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.code} — {it.name}
            {it.material ? ` [${it.material}]` : ''}
          </option>
        ))}
      </datalist>

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
        {/* Footer per the call sites: both `addPO()` L25733 and `editPO()` L25799 call
            showModalLg(...) with NO saveLabel, so the L28034 fallback derives the label
            from the title — '+ New Purchase Order' and 'Edit PO — …' both match the
            'Purchase Order'/'PO' branch first → '✓ Save PO' on .btn-success, Cancel on
            .btn-ghost. Identical in both modes. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? (
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-success"
            disabled={formState.isSubmitting || (isCreate && !docNoValid)}
          >
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? '✓ Save PO'}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: PurchaseOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      poDate: detail.poDate,
      poType: detail.poType,
      status: detail.status,
      ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
      ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
      ...(detail.dueDate ? { dueDate: detail.dueDate } : {}),
      ...(detail.taxType ? { taxType: detail.taxType } : {}),
      sgstPct: Number(detail.sgstPct),
      cgstPct: Number(detail.cgstPct),
      igstPct: Number(detail.igstPct),
      ...(detail.prCodeText ? { prCodeText: detail.prCodeText } : {}),
      ...(detail.approvalRemarks ? { approvalRemarks: detail.approvalRemarks } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines: detail.lines.map(
      (l): LineFormValue => ({
        id: l.id,
        ...(l.itemId ? { itemId: l.itemId } : {}),
        itemCodeText: l.itemCodeText ?? '',
        itemName: l.itemName,
        qty: l.qty,
        rate: Number(l.rate),
        receivedQty: l.receivedQty,
        ...(l.dueDate ? { dueDate: l.dueDate } : {}),
        ...(l.lineRemarks ? { lineRemarks: l.lineRemarks } : {}),
      }),
    ),
  };
}
