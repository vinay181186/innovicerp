// THE Purchase Order form — one component, two doors.
//
//   • create  →  /purchase-orders/from-pr        (optionally `?prId=`)
//   • edit    →  /purchase-orders/$id/edit
//
// Both render this file with a `mode` prop, so the layout can never drift
// between "the PO I raised" and "the PO I corrected". It replaces BOTH the old
// two-step "step 1 of 2 — pick a PR" screen and the separate legacy edit form.
//
// What changed, and why it matters:
//   • ONE PO may now cover SEVERAL PRs — the PR is a per-line dropdown, not a
//     header field. Picking a PR on a line carries its item / name / qty /
//     rate / required date onto that line, and every one of them stays
//     editable ("carried from PR — editable"). A PR already used on another
//     line is not offered again.
//   • Money is computed from the LINES: subtotal = Σ(qty × rate). The old
//     screen multiplied the single PR's qty by its estimated cost, which was
//     only ever right for a one-PR, one-line PO.
//   • Create still requires a PR on at least one line, because the server
//     enforces exactly that (`createPurchaseOrderInputSchema`), so ADR-138
//     ("a PO is always raised against a Purchase Request") still holds.
//
// Styling is the screen-local `.pof-` palette (see `po-form-css.ts`).

import {
  type CreatePurchaseOrderInput,
  PO_TYPES,
  type PurchaseOrderDetail,
  type PurchaseOrderLineInput,
  type PurchaseRequestDetail,
  type UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { todayLocal } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { useDocNumber } from '@/lib/use-doc-number';
import { useItemsList } from '@/modules/items/api';
import { useCreatePurchaseOrder, useUpdatePurchaseOrder } from '../api';
import { PO_FORM_CSS } from './po-form-css';
import { PoFormLine, type PoItemMasterRow } from './po-form-line';
import {
  NEW_PO_LINE,
  PO_FORM_ITEM_DATALIST_ID,
  type PoFormLineValue,
  type PoFormValues,
} from './po-form-types';

export type PoFormProps =
  | {
      mode: 'create';
      /** Arrived from a PR page — line 1 opens with that PR already picked. */
      initialPrId?: string | undefined;
    }
  | { mode: 'edit'; detail: PurchaseOrderDetail };

export function PoForm(props: PoFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const navigate = useNavigate();
  const createPo = useCreatePurchaseOrder();
  const updatePo = useUpdatePurchaseOrder(props.mode === 'edit' ? props.detail.id : '');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<PoFormValues>({
    defaultValues:
      props.mode === 'edit'
        ? detailToFormValues(props.detail)
        : {
            header: {
              code: '',
              poDate: todayLocal(),
              poType: 'job_work',
              sgstPct: 0,
              cgstPct: 0,
              igstPct: 0,
            },
            lines: [
              props.initialPrId
                ? { ...NEW_PO_LINE, sourcePrId: props.initialPrId }
                : { ...NEW_PO_LINE },
            ],
          },
  });
  const { register, control, handleSubmit, formState, setValue, watch, getValues } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // ── PO number. Built inline rather than via the shared <DocNumberInput>: the
  //    10px label / 36px control / "✕ Already used" wording is local to this
  //    screen, and restyling the shared component would move every other form.
  const code = watch('header.code') ?? '';
  const docNo = useDocNumber('purchase_order', isEdit ? '' : code);
  const prefilled = useRef(isEdit);
  useEffect(() => {
    if (!prefilled.current && docNo.nextCode && getValues('header.code').trim() === '') {
      setValue('header.code', docNo.nextCode);
      prefilled.current = true;
    }
  }, [docNo.nextCode, getValues, setValue]);

  // ── Item Master, for the per-line code suggestions + name courtesy fill.
  const { data: itemsData } = useItemsList({ limit: 1000, offset: 0 });
  const items = useMemo(() => itemsData?.items ?? [], [itemsData]);
  const itemsByCode = useMemo(() => {
    const m = new Map<string, PoItemMasterRow>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  // ── A line reports its loaded PR up here, so the header can seed itself from
  //    the FIRST PR picked. Both seeds are one-shot and overridable: a vendor or
  //    a remark the user has already set is never clobbered. Every PR seen is
  //    also kept, so the footer can name a line whose PR belongs to a different
  //    vendor than the header now holds.
  const [vendorSeedLabel, setVendorSeedLabel] = useState('');
  // The picked vendor's "CODE — Name", kept only so a line can say WHICH vendor
  // has no open PRs. Display copy: the saved value is still the id alone.
  const [vendorPickedLabel, setVendorPickedLabel] = useState('');
  const [prById, setPrById] = useState<Record<string, PurchaseRequestDetail>>({});
  const autoRemark = useRef('');
  const onPrLoaded = useCallback(
    (pr: PurchaseRequestDetail) => {
      setPrById((m) => (m[pr.id] ? m : { ...m, [pr.id]: pr }));
      if (pr.vendorId && !getValues('header.vendorId')) {
        setValue('header.vendorId', pr.vendorId);
        setValue('header.vendorCodeText', undefined);
        setVendorSeedLabel(
          pr.vendorCode ? `${pr.vendorCode} — ${pr.vendorName ?? ''}`.trim() : (pr.vendorName ?? ''),
        );
      }
      const remark = `From PR ${pr.code}${pr.operation ? ` — ${pr.operation}` : ''}`;
      const current = getValues('header.remarks') ?? '';
      if (current.trim() === '' || current === autoRemark.current) {
        setValue('header.remarks', remark);
        autoRemark.current = remark;
      }
    },
    [getValues, setValue],
  );

  // ── Live money. Subtotal is the sum of the LINES, not the source PR.
  const lines = watch('lines') ?? [];
  const taxType = watch('header.taxType') ?? '';
  const isSplit = taxType === 'sgst_cgst';
  const isIgst = taxType === 'igst';
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const taxPct = isSplit
    ? (Number(watch('header.cgstPct')) || 0) + (Number(watch('header.sgstPct')) || 0)
    : isIgst
      ? Number(watch('header.igstPct')) || 0
      : 0;
  const taxAmt = (subtotal * taxPct) / 100;
  const poTotal = subtotal + taxAmt;

  const vendorId = watch('header.vendorId') ?? null;
  const vendorCodeText = watch('header.vendorCodeText') ?? '';
  const poDate = watch('header.poDate') ?? '';

  // Just the NAME half of whichever label we hold — "IN-VEN-004 — Shah Heat
  // Treaters" reads badly inside a sentence. Freshest source wins: what the user
  // just picked, then a PR's seed, then the saved detail.
  const detailVendorName = props.mode === 'edit' ? (props.detail.vendorName ?? '') : '';
  const vendorName = useMemo(() => {
    const raw = vendorPickedLabel || vendorSeedLabel || detailVendorName;
    const dash = raw.indexOf('—');
    return (dash === -1 ? raw : raw.slice(dash + 1)).trim();
  }, [vendorPickedLabel, vendorSeedLabel, detailVendorName]);

  // Lines whose PR belongs to a DIFFERENT vendor than the header now names —
  // i.e. the buyer changed the vendor after picking PRs. Those lines are not
  // wiped (that would throw away typing); they are named in the footer and the
  // save stays blocked until they are fixed or removed. A PR with no vendor of
  // its own (the OSP "(vendor TBD)" case) is never a mismatch.
  const wrongVendorLines = useMemo(
    () =>
      vendorId
        ? lines
            .map((l, i) => ({ i, pr: l.sourcePrId ? prById[l.sourcePrId] : undefined }))
            .filter((x) => x.pr?.vendorId && x.pr.vendorId !== vendorId)
            .map((x) => x.i + 1)
        : [],
    [lines, prById, vendorId],
  );

  // ── The ONE blocking message, shown bottom-left in amber. First problem wins,
  //    so the buyer is told what to do next rather than handed a list.
  const blocking = useMemo((): string | null => {
    if (!isEdit) {
      if (code.trim() === '') return 'PO number is required';
      if (docNo.duplicate) return 'That PO number is already used';
      if (docNo.formatInvalid) return docNo.error ?? 'PO number format is wrong';
    }
    if (poDate.trim() === '') return 'PO date is required';
    if (!vendorId && vendorCodeText.trim() === '') return 'Pick a vendor';
    if (wrongVendorLines.length > 0) {
      const which = wrongVendorLines.join(', ');
      return wrongVendorLines.length === 1
        ? `Line ${which} is a PR for a different vendor — remove it or change the vendor back`
        : `Lines ${which} are PRs for a different vendor — remove them or change the vendor back`;
    }
    if (lines.length === 0) return 'Add at least one line';
    for (const [i, l] of lines.entries()) {
      if (l.itemCodeText.trim() === '') return `Needs item code on line ${i + 1}`;
    }
    for (const [i, l] of lines.entries()) {
      if (l.itemName.trim() === '') return `Needs a name on line ${i + 1}`;
    }
    for (const [i, l] of lines.entries()) {
      if (!(Number(l.qty) > 0)) return `Needs qty on line ${i + 1}`;
    }
    // The server refuses a PO with no PR behind it, so say so here rather than
    // letting the save bounce.
    if (!isEdit && !lines.some((l) => Boolean(l.sourcePrId))) {
      return 'Pick a PR on at least one line';
    }
    return null;
    // `lines` is a watched array — a new identity on every keystroke, which is
    // exactly when this must recompute.
  }, [isEdit, code, docNo, poDate, vendorId, vendorCodeText, wrongVendorLines, lines]);

  const submitting = formState.isSubmitting || createPo.isPending || updatePo.isPending;
  const disabled = submitting || blocking !== null || (!isEdit && docNo.checking);

  const onValid = async (values: PoFormValues): Promise<void> => {
    setSubmitError(null);
    const prCodes = Array.from(
      new Set(
        values.lines
          .filter((l) => l.sourcePrId && l.sourcePrCode)
          .map((l) => l.sourcePrCode as string),
      ),
    ).join(', ');

    const header = {
      poDate: values.header.poDate,
      poType: values.header.poType,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || undefined,
      dueDate: values.header.dueDate || undefined,
      taxType: values.header.taxType?.trim() || undefined,
      sgstPct: Number(values.header.sgstPct) || 0,
      cgstPct: Number(values.header.cgstPct) || 0,
      igstPct: Number(values.header.igstPct) || 0,
      // The contract stores the covered PRs' codes comma-joined here (max 500).
      prCodeText: prCodes ? prCodes.slice(0, 500) : undefined,
      remarks: values.header.remarks?.trim() || undefined,
    };

    const outLines: PurchaseOrderLineInput[] = values.lines.map((l) => {
      const trimmedCode = l.itemCodeText.trim();
      // Text wins when there is any: the API resolves a code back to its master
      // item itself, so sending the text never loses the link.
      const refs = trimmedCode
        ? { itemCodeText: trimmedCode }
        : l.itemId
          ? { itemId: l.itemId }
          : {};
      return {
        ...(l.id ? { id: l.id } : {}),
        ...refs,
        itemName: l.itemName.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate) || 0,
        dueDate: l.dueDate || undefined,
        sourcePrId: l.sourcePrId || undefined,
        ramRemark: l.ramRemark?.trim() || undefined,
        lineRemarks: l.lineRemarks?.trim() || undefined,
      };
    });

    try {
      if (props.mode === 'edit') {
        const payload: UpdatePurchaseOrderInput = { header, lines: outLines };
        await updatePo.mutateAsync(payload);
        await navigate({
          to: '/purchase-orders/$id',
          params: { id: props.detail.id },
          replace: true,
        });
      } else {
        // `status` is deliberately NOT sent. A new PO's status is the server's
        // to stamp, and shipping one silently disables its approval-config
        // branch. The cast is only because the schema gives `status` a default,
        // which makes it required in the INFERRED (output) type even though the
        // request may legitimately omit it.
        const payload = {
          header: {
            ...header,
            // Blank → omitted so the server auto-generates IN-PO-#####; sending
            // '' fails the schema's code.min(1) → "request validation failed".
            ...(values.header.code.trim() ? { code: values.header.code.trim() } : {}),
          },
          lines: outLines,
        } as CreatePurchaseOrderInput;
        const created = await createPo.mutateAsync(payload);
        await navigate({ to: '/purchase-orders/$id', params: { id: created.id }, replace: true });
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : isEdit
            ? 'Failed to save the purchase order'
            : 'Failed to create the purchase order',
      );
    }
  };

  const colCount = isEdit ? 10 : 9;
  /** The one line that carries the shared PR hints — the first without a PR. */
  const hintLineIdx = lines.findIndex((l) => !l.sourcePrId);

  return (
    <div className="pof-page pof-root">
      <style>{PO_FORM_CSS}</style>

      {props.mode === 'edit' ? (
        <Link
          to="/purchase-orders/$id"
          params={{ id: props.detail.id }}
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 10 }}
        >
          <ArrowLeft size={14} /> Back to PO
        </Link>
      ) : (
        <Link to="/purchase-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> Back to Purchase Orders
        </Link>
      )}

      <form className="pof-card" onSubmit={handleSubmit(onValid)}>
        <div className="pof-hdr">
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
            <span className="pof-title">
              {isEdit ? 'Edit Purchase Order' : 'Create Purchase Order'}
            </span>
            {props.mode === 'edit' ? <span className="pof-chip">{props.detail.code}</span> : null}
          </span>
          <span className="pof-hdr-note">
            Fields marked <span className="pof-req">★</span> are required
          </span>
        </div>

        {/* ── Header: five fields, one row (six in edit — plus read-only Status). */}
        <div className="pof-row">
          <div className="pof-f-po">
            <label className="pof-lbl" htmlFor="pof-code">
              PO No.<span className="pof-req">★</span>
            </label>
            <input
              id="pof-code"
              className={`pof-in pof-num ${
                isEdit ? '' : code.trim() === '' || docNo.error ? 'pof-bad' : docNo.valid ? 'pof-ok' : ''
              }`}
              autoComplete="off"
              readOnly={isEdit}
              title={isEdit ? 'The PO number is permanent once the PO exists' : undefined}
              value={code}
              onChange={(e) => setValue('header.code', e.target.value)}
              onBlur={() => {
                if (!isEdit && code.trim()) setValue('header.code', docNo.padded);
              }}
            />
            {isEdit ? null : code.trim() === '' ? (
              <div className="pof-note pof-note-bad">
                <X size={11} style={{ verticalAlign: -1 }} /> PO number is required
              </div>
            ) : docNo.checking ? (
              <div className="pof-note">Checking…</div>
            ) : docNo.duplicate ? (
              <div className="pof-note pof-note-bad">
                <X size={11} style={{ verticalAlign: -1 }} /> Already used
              </div>
            ) : docNo.error ? (
              <div className="pof-note pof-note-bad">
                <X size={11} style={{ verticalAlign: -1 }} /> {docNo.error}
              </div>
            ) : (
              <div className="pof-note pof-note-ok">
                <Check size={11} style={{ verticalAlign: -1 }} /> Available
              </div>
            )}
          </div>

          <div className="pof-f-date">
            <label className="pof-lbl" htmlFor="pof-date">
              PO Date<span className="pof-req">★</span>
            </label>
            <input
              id="pof-date"
              type="date"
              className="pof-in pof-num"
              {...register('header.poDate', { required: true })}
            />
          </div>

          <div className="pof-f-type">
            <label className="pof-lbl" htmlFor="pof-type">
              PO Type
            </label>
            {/* standard (a buy) / job work (material out to a vendor) / service.
                'outsource' is dead — it behaves like standard — so it stays
                hidden to prevent mis-filing. */}
            <select id="pof-type" className="pof-in" {...register('header.poType')}>
              {PO_TYPES.filter((t) => t === 'standard' || t === 'job_work' || t === 'service').map(
                (t) => (
                  <option key={t} value={t}>
                    {t.replaceAll('_', ' ')}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="pof-f-date">
            <label className="pof-lbl" htmlFor="pof-due">
              Due Date
            </label>
            <input id="pof-due" type="date" className="pof-in pof-num" {...register('header.dueDate')} />
          </div>

          <VendorPicker
            key={vendorSeedLabel}
            id="pof-vendor"
            className="pof-f-vendor"
            labelText="Vendor"
            value={vendorId}
            // Changing this is a CASCADE, not just a field edit: every line's PR
            // picker re-queries for the new vendor (the id flows down as
            // `headerVendorId`), and a line still holding the OLD vendor's PR is
            // named in the footer — never wiped, that would throw away typing.
            onChange={(id, label) => {
              setVendorPickedLabel(label);
              setValue('header.vendorId', id ?? undefined);
            }}
            initialLabel={vendorSeedLabel || (props.mode === 'edit' ? (props.detail.vendorName ?? '') : '')}
            carriedText={vendorCodeText}
          />

          {/* Status is read-only: it moves through Approve / Reject / Cancel and
              the GRN cascade, never a plain edit. Absent on create — a new PO's
              status is stamped by the server. */}
          {props.mode === 'edit' ? (
            <div className="pof-f-type">
              <label className="pof-lbl" htmlFor="pof-status">
                Status
              </label>
              <input
                id="pof-status"
                className="pof-in"
                readOnly
                title="Status changes via Approve / Reject / Cancel, not a plain edit"
                value={props.detail.status.replaceAll('_', ' ')}
              />
            </div>
          ) : null}

          <div className="pof-f-full">
            <label className="pof-lbl" htmlFor="pof-remarks">
              PO Remarks
            </label>
            <input
              id="pof-remarks"
              className="pof-in"
              autoComplete="off"
              placeholder="Notes for this purchase order"
              {...register('header.remarks')}
            />
          </div>
        </div>

        {/* ── Lines. */}
        <div className="pof-band">
          <span className="pof-band-t">
            PO Line Items
            <span className="pof-band-sub">carried from PR — editable</span>
          </span>
          <span className="pof-band-r">
            {fields.length} line{fields.length === 1 ? '' : 's'} · Qty {totalQty}
          </span>
        </div>

        <div className="pof-tblwrap">
          <table className="pof-tbl">
            <thead>
              <tr>
                <th className="pof-sr" style={{ width: 52 }}>
                  Sr No.
                </th>
                <th>PR No.</th>
                <th>
                  Item Code<span className="pof-req">★</span>
                </th>
                <th>Name</th>
                <th className="pof-th-r">
                  Qty<span className="pof-req">★</span>
                </th>
                <th className="pof-th-r">Rate ₹</th>
                <th className="pof-th-r">Amount</th>
                <th>Due Date</th>
                {isEdit ? <th className="pof-th-r">Received</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {fields.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>
                    <div className="pof-empty">
                      No lines yet.{' '}
                      <button
                        type="button"
                        className="pof-add"
                        onClick={() => append({ ...NEW_PO_LINE })}
                      >
                        + Add Line
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                fields.map((field, idx) => (
                  // Keyed by the field-array id, not the index: a row keeps its
                  // React identity — and with it the memory of what its PR
                  // auto-filled — when a line above it is removed.
                  <PoFormLine
                    key={field.id}
                    form={form}
                    idx={idx}
                    line={lines[idx]}
                    isEdit={isEdit}
                    colCount={colCount}
                    headerVendorId={vendorId}
                    vendorName={vendorName}
                    // The "no open PRs for this vendor" note belongs on ONE row,
                    // not on every empty one — three copies of the same sentence
                    // is noise, and the first line without a PR is where the
                    // buyer is looking.
                    showPrHints={idx === hintLineIdx}
                    excludePrIds={lines
                      .filter((_, i) => i !== idx)
                      .map((l) => l.sourcePrId)
                      .filter((x): x is string => Boolean(x))}
                    itemsByCode={itemsByCode}
                    onPrLoaded={onPrLoaded}
                    onRemove={() => remove(idx)}
                    onAddLine={() => append({ ...NEW_PO_LINE })}
                    canRemove={fields.length > 1}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Tax + running totals, one strip. */}
        <div className="pof-tax">
          <div className="pof-tax-f pof-tax-type">
            <label className="pof-lbl" htmlFor="pof-taxtype">
              Tax Type
            </label>
            <select id="pof-taxtype" className="pof-in" {...register('header.taxType')}>
              <option value="">— None —</option>
              <option value="sgst_cgst">SGST + CGST</option>
              <option value="igst">IGST</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className={`pof-tax-f ${isSplit ? '' : 'pof-dim'}`}>
            <label className="pof-lbl" htmlFor="pof-cgst">
              CGST %
            </label>
            <input
              id="pof-cgst"
              type="number"
              step="0.01"
              min={0}
              className="pof-in pof-num"
              {...register('header.cgstPct', { valueAsNumber: true })}
            />
          </div>
          <div className={`pof-tax-f ${isSplit ? '' : 'pof-dim'}`}>
            <label className="pof-lbl" htmlFor="pof-sgst">
              SGST %
            </label>
            <input
              id="pof-sgst"
              type="number"
              step="0.01"
              min={0}
              className="pof-in pof-num"
              {...register('header.sgstPct', { valueAsNumber: true })}
            />
          </div>
          <div className={`pof-tax-f ${isIgst ? '' : 'pof-dim'}`}>
            <label className="pof-lbl" htmlFor="pof-igst">
              IGST %
            </label>
            <input
              id="pof-igst"
              type="number"
              step="0.01"
              min={0}
              className="pof-in pof-num"
              {...register('header.igstPct', { valueAsNumber: true })}
            />
          </div>

          {/* Preview of unsaved input: the server recomputes and stores the
              figures itself — nothing here is transmitted as a total. */}
          <div className="pof-tot">
            <div className="pof-tot-l">Subtotal</div>
            <div className="pof-tot-v">₹{inrFormat(subtotal)}</div>
            <div className="pof-tot-l">Tax</div>
            <div className="pof-tot-v">₹{inrFormat(taxAmt)}</div>
            <div className="pof-tot-l pof-tot-big">PO Total</div>
            <div className="pof-tot-v pof-tot-big">₹{inrFormat(poTotal)}</div>
          </div>
        </div>

        {submitError ? (
          <div className="pof-msg pof-msg-err" style={{ marginTop: 12, marginBottom: 0 }}>
            {submitError}
          </div>
        ) : null}

        <div className="pof-foot">
          {blocking ? (
            <span className="pof-foot-msg">{blocking}</span>
          ) : (
            <span className="pof-foot-hint">
              {isEdit ? 'Ready to save' : 'Ready to create this purchase order'}
            </span>
          )}
          <div className="pof-acts">
            <button
              type="button"
              className="pof-btn pof-btn-cancel"
              onClick={() =>
                props.mode === 'edit'
                  ? void navigate({ to: '/purchase-orders/$id', params: { id: props.detail.id } })
                  : void navigate({ to: '/purchase-orders' })
              }
            >
              Cancel
            </button>
            <button type="submit" className="pof-btn pof-btn-go" disabled={disabled}>
              {submitting ? <Loader2 size={13} className="animate-spin" /> : '✓'}{' '}
              {isEdit ? 'Save Changes' : 'Create PO'}
            </button>
          </div>
        </div>
      </form>

      <datalist id={PO_FORM_ITEM_DATALIST_ID}>
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.code} — {it.name}
            {it.material ? ` [${it.material}]` : ''}
          </option>
        ))}
      </datalist>
    </div>
  );
}

function detailToFormValues(detail: PurchaseOrderDetail): PoFormValues {
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
      sgstPct: Number(detail.sgstPct ?? 0),
      cgstPct: Number(detail.cgstPct ?? 0),
      igstPct: Number(detail.igstPct ?? 0),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
    },
    lines: detail.lines.map(
      (l): PoFormLineValue => ({
        id: l.id,
        ...(l.sourcePrId ? { sourcePrId: l.sourcePrId } : {}),
        ...(l.sourcePrCode ? { sourcePrCode: l.sourcePrCode } : {}),
        ...(l.itemId ? { itemId: l.itemId } : {}),
        // Prefer the live master code over the stored free text, so the box
        // shows what the item actually is today.
        itemCodeText: l.itemCode ?? l.itemCodeText ?? '',
        itemName: l.itemName,
        qty: l.qty,
        rate: Number(l.rate ?? 0),
        receivedQty: l.receivedQty,
        ...(l.dueDate ? { dueDate: l.dueDate } : {}),
        ...(l.ramRemark ? { ramRemark: l.ramRemark } : {}),
        ...(l.lineRemarks ? { lineRemarks: l.lineRemarks } : {}),
      }),
    ),
  };
}
