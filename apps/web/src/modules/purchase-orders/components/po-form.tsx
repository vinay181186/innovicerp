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
// Styling is the app theme: sticky PageHeader (Cancel + Save, Ctrl+S) →
// Panel(FormGrid) → Panel(line table) → Panel(taxes + totals). The old private
// `.pof-` palette (po-form-css.ts) is gone.

import {
  type CreatePurchaseOrderInput,
  poCodePrefix,
  PO_TYPES,
  type PurchaseOrderDetail,
  type PurchaseOrderLineInput,
  type PurchaseRequestDetail,
  type UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { addDaysLocal, daysBetweenLocal, todayIst } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { inrFormat } from '@/lib/print/doc-print';
import { useDocNumber } from '@/lib/use-doc-number';
import { useItemsList } from '@/modules/items/api';
import { useVendorsList } from '@/modules/vendors/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useCreatePurchaseOrder, useUpdatePurchaseOrder } from '../api';
import { PO_TYPE_LABELS } from '../lib/po-labels';
import { PoFormLine, type PoItemMasterRow } from './po-form-line';
import {
  NEW_PO_LINE,
  PO_FORM_ITEM_DATALIST_ID,
  type PoFormLineValue,
  type PoFormValues,
} from './po-form-types';

/** The Delivery Days box as a number, or null when it does not hold one yet —
 *  blank, a lone "-", "1e". Whole days only: half a day is not a delivery term.
 *  Negative IS parsed, so a date before the PO date reads honestly as "-3" and
 *  the blocking banner can refuse the save. */
function parseWholeDays(raw: string): number | null {
  const t = raw.trim();
  if (t === '' || !/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** vendorCodeText values that mean "no vendor chosen yet", not a real vendor
 *  code. Upper-cased, trimmed — compared against the PR's text the same way.
 *  'TBD' is what Planning (Buy items) and the BOM cascade write; '(VENDOR TBD)'
 *  is the OSP sentinel. A PR carrying one of these takes whatever vendor the
 *  buyer picks on the PO. */
const VENDOR_TBD_PLACEHOLDERS: ReadonlySet<string> = new Set(['TBD', '(VENDOR TBD)']);

/** A tax % box the chosen Tax Type does not use: dimmed, still editable. */
const DIM: React.CSSProperties = { opacity: 0.45 };

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
  // Where Cancel goes — and therefore where ESC → Exit goes too. The exit guard
  // asks "Are you sure?" on every other way off this screen (Back link,
  // breadcrumb, browser Back); Save and Cancel pass through `exit.leave`.
  const detailId = props.mode === 'edit' ? props.detail.id : null;
  const goBack = useCallback(
    () =>
      detailId
        ? void navigate({ to: '/purchase-orders/$id', params: { id: detailId } })
        : void navigate({ to: '/purchase-orders' }),
    [navigate, detailId],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const form = useForm<PoFormValues>({
    defaultValues:
      props.mode === 'edit'
        ? detailToFormValues(props.detail)
        : {
            header: {
              code: '',
              poDate: todayIst(),
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
  //    "Already used" / "Number not used" wording and the type-driven refill
  //    below are local to this screen.
  //
  //    The number depends on the PO TYPE (user, 2026-09-11): a material buy is
  //    IN-MPO-, job work IN-JWPO-, a service IN-SPO-, outsourcing IN-OPO-, and
  //    each series counts on its own. So the type goes to the backend with the
  //    request for the next number, and changing the dropdown asks again.
  const code = watch('header.code') ?? '';
  const poType = watch('header.poType');
  const docNo = useDocNumber('purchase_order', isEdit ? '' : code, poType);
  // `suggestedFor` is the type we last filled the box for; `suggested` is what
  // we put in it. Switching the type re-fills the box ONLY while it still holds
  // our suggestion — a number the buyer typed is theirs and is never replaced,
  // and an old series' number is never left sitting under a new type.
  const suggestedFor = useRef<string | null>(null);
  const suggested = useRef('');
  useEffect(() => {
    // Edit never renumbers: the PO number is permanent once the PO exists.
    if (isEdit) return;
    const next = docNo.nextCode;
    if (!next) return;
    const current = getValues('header.code').trim();
    const firstFill = suggestedFor.current === null && current === '';
    const typeChanged =
      suggestedFor.current !== null &&
      suggestedFor.current !== poType &&
      (current === '' || current === suggested.current);
    if (!firstFill && !typeChanged) return;
    suggestedFor.current = poType;
    suggested.current = next;
    if (current !== next) setValue('header.code', next);
  }, [isEdit, docNo.nextCode, poType, getValues, setValue]);

  // ── Item Master, for the per-line code suggestions + name courtesy fill.
  const { data: itemsData, isSuccess: itemsLoaded } = useItemsList({ limit: 1000, offset: 0 });
  const items = useMemo(() => itemsData?.items ?? [], [itemsData]);
  const itemsByCode = useMemo(() => {
    const m = new Map<string, PoItemMasterRow>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  // ── A line reports its loaded PR up here, so the header can seed itself from
  //    the FIRST PR picked. Both seeds are one-shot and overridable: a vendor or
  //    a remark the user has already set is never clobbered. Every PR seen is
  //    also kept, so the banner can name a line whose PR belongs to a different
  //    vendor than the header now holds.
  const [vendorSeedLabel, setVendorSeedLabel] = useState('');
  // The picked vendor's "CODE — Name", kept only so a line can say WHICH vendor
  // has no open PRs. Display copy: the saved value is still the id alone.
  const [vendorPickedLabel, setVendorPickedLabel] = useState('');
  const [prById, setPrById] = useState<Record<string, PurchaseRequestDetail>>({});
  // A PR's vendor CODE, when that is the only way the PR names its vendor. See
  // the resolver below — this is the "Create PO" button on the PR page working
  // again.
  const [seedVendorCode, setSeedVendorCode] = useState('');
  const autoRemark = useRef('');
  const onPrLoaded = useCallback(
    (pr: PurchaseRequestDetail) => {
      setPrById((m) => (m[pr.id] ? m : { ...m, [pr.id]: pr }));
      if (pr.vendorId && !getValues('header.vendorId')) {
        setValue('header.vendorId', pr.vendorId);
        setValue('header.vendorCodeText', undefined);
        setVendorSeedLabel(
          pr.vendorCode
            ? `${pr.vendorCode} — ${pr.vendorName ?? ''}`.trim()
            : (pr.vendorName ?? ''),
        );
      } else if (!pr.vendorId && pr.vendorCodeText?.trim() && !getValues('header.vendorId')) {
        // FK first, TEXT second — the ADR-015 pair. In practice it is always the
        // text: a PR carries `VND-004` and no `vendor_id` at all. Resolving that
        // code is what makes arriving from a PR page work, because the PR box is
        // disabled until the header holds a real vendor ID.
        setSeedVendorCode(pr.vendorCodeText.trim());
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

  // ── Resolve that code to a real vendor. Uses the vendors module's OWN list
  //    hook with the code as the search term — no new fetch layer, and the same
  //    endpoint <VendorPicker> already searches.
  //
  //    A SEED, not a cascade: it fires once, only into an empty Vendor box, and
  //    never again. The buyer must be free to change it afterwards, and a
  //    re-fetch of the same PR must not undo that change.
  //
  //    A code that resolves to nothing leaves Vendor empty on purpose. Writing
  //    the free text instead would satisfy the save rule while leaving the PR box
  //    disabled — a vendor that looks set but unlocks nothing. Better to let the
  //    "Select a Vendor first" state stand and have the buyer pick.
  const vendorSeedQ = useVendorsList(
    { search: seedVendorCode, limit: 10, offset: 0 },
    { enabled: seedVendorCode !== '' },
  );
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || seedVendorCode === '') return;
    const rows = vendorSeedQ.data?.vendors;
    if (!rows) return;
    seeded.current = true;
    // Exact code match only. `?search=` is a fuzzy match over code AND name, so
    // "VND-004" could also drag in "VND-0041"; seeding the wrong vendor is worse
    // than seeding none.
    const want = seedVendorCode.toUpperCase();
    const hit = rows.find((v) => v.code.trim().toUpperCase() === want);
    if (!hit) return;
    if (getValues('header.vendorId')) return;
    setValue('header.vendorId', hit.id);
    setValue('header.vendorCodeText', undefined);
    setVendorSeedLabel(`${hit.code} — ${hit.name}`);
  }, [vendorSeedQ.data, seedVendorCode, getValues, setValue]);

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

  // ── Tax Type is a controller too, and its dependents are the three percentage
  //    boxes. Switching to IGST used to leave a CGST of 9 sitting there, dimmed
  //    and excluded from the maths on screen — but still SENT on save, so the
  //    stored document disagreed with the one the buyer signed off. Whatever the
  //    chosen mode does not govern goes back to zero, and Tax / PO Total follow
  //    because they are computed from the watched values, not held in state.
  //
  //    Not `useFieldCascade`: there is no source record to fill FROM here. The
  //    rule is purely "blank what this mode does not use", and inventing a fake
  //    source to express that would be harder to read, not easier.
  const seenTaxType = useRef<string | null>(null);
  useEffect(() => {
    // First run is a baseline: an edit form arrives with saved percentages that
    // are the document's own history, not ours to clear.
    if (seenTaxType.current === null) {
      seenTaxType.current = taxType;
      return;
    }
    if (seenTaxType.current === taxType) return;
    seenTaxType.current = taxType;
    if (taxType !== 'sgst_cgst') {
      setValue('header.cgstPct', 0, { shouldDirty: true });
      setValue('header.sgstPct', 0, { shouldDirty: true });
    }
    if (taxType !== 'igst') setValue('header.igstPct', 0, { shouldDirty: true });
  }, [taxType, setValue]);

  const vendorId = watch('header.vendorId') ?? null;
  const vendorCodeText = watch('header.vendorCodeText') ?? '';
  const poDate = watch('header.poDate') ?? '';
  const deliveryDate = watch('header.dueDate') ?? '';

  // ── DELIVERY DAYS ⇄ DELIVERY DATE ⇄ PO DATE. Three fields, one fact.
  //
  //  • type Days   → Date  = PO Date + Days
  //  • pick Date   → Days  = whole days from PO Date
  //  • move PO Date→ Date shifts to KEEP the days already showing
  //  • clear either→ the other clears too
  //
  // Days is display-only state: nothing stores it, nothing sends it. Keeping it
  // in the form values would let it drift from the date it describes, and would
  // put a field in the payload the API has never heard of.
  //
  // The loop guard is `sync`: it remembers the pair this effect last saw, so it
  // can tell WHICH of the two moved and write only the other one — and it
  // pre-records what it is about to write, so its own write is recognised on the
  // next pass instead of bouncing back.
  const [deliveryDays, setDeliveryDays] = useState('');
  const daysRef = useRef(deliveryDays);
  daysRef.current = deliveryDays;
  const sync = useRef<{ poDate: string; deliveryDate: string } | null>(null);
  useEffect(() => {
    const prev = sync.current;
    sync.current = { poDate, deliveryDate };
    const days = parseWholeDays(daysRef.current);
    // PO Date moved on its own: the promise "delivery in N days" is what the
    // buyer meant, so the DATE follows and the number stays put.
    if (prev && prev.poDate !== poDate && prev.deliveryDate === deliveryDate && days !== null) {
      const shifted = addDaysLocal(poDate, days);
      if (shifted !== '' && shifted !== deliveryDate) {
        sync.current = { poDate, deliveryDate: shifted };
        setValue('header.dueDate', shifted, { shouldDirty: true });
        return;
      }
    }
    // Otherwise the DATE is the source of truth and the number describes it —
    // including on first paint, which is how an old PO shows a correct figure
    // without anything being stored.
    const between = daysBetweenLocal(poDate, deliveryDate);
    const next = between === null ? '' : String(between);
    setDeliveryDays((cur) => (cur === next ? cur : next));
  }, [poDate, deliveryDate, setValue]);

  // ── Each line's Due Date follows the header's Delivery Date ──────────────
  //
  // A PO is normally wanted on ONE date, so making the buyer retype it on every
  // line is pure friction. A new line is therefore born on the header's date,
  // and moving the header moves the lines with it.
  //
  // It only moves a line that is still ON that default — one whose Due Date is
  // blank, or still equals the header value it was handed. Anything else is
  // real data and is left alone: a date the buyer typed for a single line, and
  // a date seeded from that line's Purchase Request (po-form-line.tsx binds
  // `dueDate` to the PR's `requiredDate`), which is the supplier's own promise
  // and not ours to overwrite.
  //
  // The ref starts at the value the form opened with, so the first pass is a
  // no-op: opening a saved PO must not rewrite its stored line dates, nor mark
  // an untouched form dirty.
  const lineDueRef = useRef(deliveryDate);
  useEffect(() => {
    const prev = lineDueRef.current;
    if (prev === deliveryDate) return;
    lineDueRef.current = deliveryDate;
    const lines = getValues('lines') ?? [];
    lines.forEach((l, i) => {
      const cur = l?.dueDate ?? '';
      if (cur !== '' && cur !== prev) return; // buyer's own date, or the PR's
      setValue(`lines.${i}.dueDate`, deliveryDate || undefined, { shouldDirty: true });
    });
  }, [deliveryDate, getValues, setValue]);

  // Every "+ Add Line" goes through here so a new row cannot miss the default.
  const addLine = useCallback(
    () => append({ ...NEW_PO_LINE, ...(deliveryDate ? { dueDate: deliveryDate } : {}) }),
    [append, deliveryDate],
  );

  const onDeliveryDaysChange = useCallback(
    (raw: string) => {
      setDeliveryDays(raw);
      const days = parseWholeDays(raw);
      // Blank clears its partner. A half-typed "-" or "1e" is not a number yet,
      // so the date is left alone until it becomes one.
      if (raw.trim() === '') {
        if (getValues('header.dueDate')) setValue('header.dueDate', '', { shouldDirty: true });
        return;
      }
      if (days === null || !poDate) return;
      const next = addDaysLocal(poDate, days);
      if (next !== '' && next !== getValues('header.dueDate')) {
        setValue('header.dueDate', next, { shouldDirty: true });
      }
    },
    [poDate, getValues, setValue],
  );

  // Just the NAME half of whichever label we hold — "IN-VEN-004 — Shah Heat
  // Treaters" reads badly inside a sentence. Freshest source wins: what the user
  // just picked, then a PR's seed, then the saved detail.
  // Cleared vendor ⇒ cleared name: every message that quotes the vendor must go
  // blank with it, not fall back to whoever was there before.
  const detailVendorName = props.mode === 'edit' ? (props.detail.vendorName ?? '') : '';
  const vendorLabel = vendorId ? vendorPickedLabel || vendorSeedLabel || detailVendorName : '';
  const vendorName = useMemo(() => {
    const dash = vendorLabel.indexOf('—');
    return (dash === -1 ? vendorLabel : vendorLabel.slice(dash + 1)).trim();
  }, [vendorLabel]);
  // The CODE half of the same label, when we have one. Used only to spot a line
  // still holding another vendor's PR — see `wrongVendorLines`.
  const vendorCode = useMemo(() => {
    const dash = vendorLabel.indexOf('—');
    return dash === -1 ? '' : vendorLabel.slice(0, dash).trim().toUpperCase();
  }, [vendorLabel]);

  // Lines whose PR belongs to a DIFFERENT vendor than the header now names —
  // i.e. the buyer changed the vendor after picking PRs. Those lines are not
  // wiped (that would throw away typing); they are named in the banner and the
  // save stays blocked until they are fixed or removed. A PR with no vendor of
  // its own is never a mismatch — that covers an empty vendorCodeText AND the
  // placeholder text the generators write when Planning does not know the
  // vendor yet: 'TBD' (Planning Buy-item PRs, BOM-cascade PRs) and
  // '(vendor TBD)' (OSP PRs). The buyer picks the vendor on the PO for those.
  //
  // A PR names its vendor EITHER by FK (`vendorId`) or as free text
  // (`vendorCodeText`) — the ADR-015 pattern — and in practice it is almost
  // always the text. Checking only the FK made this test silently dormant, so it
  // checks whichever the PR actually carries. When a PR names its vendor in a way
  // we cannot compare (text, but we do not know the chosen vendor's code), it is
  // left alone: a false block on a good line is worse than a missed warning.
  const wrongVendorLines = useMemo(() => {
    if (!vendorId) return [];
    return lines
      .map((l, i) => ({ i, pr: l.sourcePrId ? prById[l.sourcePrId] : undefined }))
      .filter(({ pr }) => {
        if (!pr) return false;
        if (pr.vendorId) return pr.vendorId !== vendorId;
        const text = pr.vendorCodeText?.trim().toUpperCase() ?? '';
        if (text === '' || VENDOR_TBD_PLACEHOLDERS.has(text) || vendorCode === '') return false;
        return text !== vendorCode;
      })
      .map((x) => x.i + 1);
  }, [lines, prById, vendorId, vendorCode]);

  // ── The ONE blocking message, shown under the header in amber. First problem wins,
  //    so the buyer is told what to do next rather than handed a list.
  const blocking = useMemo((): string | null => {
    if (!isEdit) {
      if (code.trim() === '') return 'PO No. is required';
      if (docNo.duplicate) return 'That PO number is already used';
      if (docNo.formatInvalid) return docNo.error ?? 'PO number format is wrong';
    }
    if (poDate.trim() === '') return 'PO Date is required';
    // 0 days (same-day delivery) is fine; earlier than the PO date is not.
    if (poDate && deliveryDate && deliveryDate < poDate) {
      return 'Due Date is before the PO Date — check the Delivery Days';
    }
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
  }, [
    isEdit,
    code,
    docNo,
    poDate,
    deliveryDate,
    vendorId,
    vendorCodeText,
    wrongVendorLines,
    lines,
  ]);

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
        // The LINE's own due date, from the line's own column. Independent of
        // the header's Delivery Date: a PO promises one delivery overall and may
        // still want a different date against an individual item.
        dueDate: l.dueDate || undefined,
        sourcePrId: l.sourcePrId || undefined,
        ramRemark: l.ramRemark?.trim() || undefined,
        lineRemarks: l.lineRemarks?.trim() || undefined,
      };
    });

    try {
      if (props.mode === 'edit') {
        // None on edit must CLEAR the stored tax type, so send null (not omit).
        const payload: UpdatePurchaseOrderInput = {
          header: { ...header, taxType: header.taxType ?? null },
          lines: outLines,
        };
        await updatePo.mutateAsync(payload);
        const editedId = props.detail.id;
        exit.leave(
          () =>
            void navigate({ to: '/purchase-orders/$id', params: { id: editedId }, replace: true }),
        );
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
        exit.leave(
          () =>
            void navigate({
              to: '/purchase-orders/$id',
              params: { id: created.id },
              replace: true,
            }),
        );
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save PO. Try again.');
    }
  };

  // Eight data columns (Sr No. · PR No. · Item Code · Item Name · Qty · Rate ·
  // Amount · Due Date) + the row-actions cell. Received (edit), RAM Remark and
  // line Remarks live in each row's "▸ More" detail row.
  const colCount = 9;
  // The ONE line that carries the shared PR notes — the first without a PR, or
  // line 1 when they all have one. Saying the same sentence under every row is
  // noise; saying it nowhere leaves a greyed-out control unexplained.
  const firstWithoutPr = lines.findIndex((l) => !l.sourcePrId);
  const hintLineIdx = lines.length === 0 ? -1 : Math.max(firstWithoutPr, 0);

  // Ctrl+S runs the same Save as the header button — and is off whenever that
  // button is disabled, so a held key can neither double-post nor bypass a block.
  useSaveShortcut(() => void handleSubmit(onValid)(), !disabled);

  const codeState = isEdit
    ? undefined
    : code.trim() === '' || docNo.error
      ? 'is-bad'
      : docNo.valid
        ? 'is-ok'
        : undefined;

  return (
    <form onSubmit={handleSubmit(onValid)} style={{ maxWidth: 1280, margin: '0 auto' }}>
      {exit.dialog}

      <PageHeader
        sticky
        title={isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}
        subtitle={
          props.mode === 'edit' ? (
            <span className="mono fw-700">{props.detail.code}</span>
          ) : undefined
        }
        backLabel={isEdit ? 'Back to PO' : 'Back to Purchase Orders'}
        onBack={goBack}
        dirty={formState.isDirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={disabled}
              title={blocking ?? 'Save (Ctrl+S)'}
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Save PO'
              )}
            </button>
          </>
        }
      />

      {/* The ONE blocking message sits under the header, beside Save — first
          problem wins, so the buyer is told what to do next. */}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      {blocking ? <Banner tone="warn">{blocking}</Banner> : null}

      <Panel title="PO Details">
        <FormGrid>
          <VendorPicker
            key={vendorSeedLabel}
            id="pof-vendor"
            className="form-grp f-lg"
            labelText="Vendor"
            value={vendorId}
            // Changing this is a CASCADE, not just a field edit: every line's PR
            // picker re-queries for the new vendor (the id flows down as
            // `headerVendorId`), and a line still holding the OLD vendor's PR is
            // named in the blocking banner — never wiped, that would throw away
            // typing.
            onChange={(id, label) => {
              setVendorPickedLabel(label);
              setValue('header.vendorId', id ?? undefined);
            }}
            initialLabel={
              vendorSeedLabel || (props.mode === 'edit' ? (props.detail.vendorName ?? '') : '')
            }
            carriedText={vendorCodeText}
          />

          {/* standard (a buy) / job work (material out to a vendor) / service.
              'outsource' is dead — it behaves like standard — so it stays
              hidden to prevent mis-filing. */}
          <FormField label="PO Type" size="md" htmlFor="pof-type">
            <select id="pof-type" className="innovic-select" {...register('header.poType')}>
              {PO_TYPES.filter((t) => t === 'standard' || t === 'job_work' || t === 'service').map(
                (t) => (
                  <option key={t} value={t}>
                    {PO_TYPE_LABELS[t]}
                  </option>
                ),
              )}
            </select>
          </FormField>

          {/* ── Delivery Days · Due Date — one controller pair.
              Days is NOT stored anywhere: it is `Due Date − PO Date`, so an old
              PO shows the right figure the moment it opens and the two can never
              drift apart. Only the DATE is saved, in the same `dueDate` field it
              has always used. */}
          <FormField label="Delivery Days" size="xs" htmlFor="pof-delivery-days">
            <input
              id="pof-delivery-days"
              type="number"
              step="1"
              className="innovic-input mono"
              autoComplete="off"
              placeholder="e.g. 10"
              title="Days from the PO date. 0 means same day."
              value={deliveryDays}
              onChange={(e) => onDeliveryDaysChange(e.target.value)}
            />
          </FormField>

          <FormField
            label="PO No."
            required
            size="sm"
            htmlFor="pof-code"
            error={
              isEdit
                ? undefined
                : code.trim() === ''
                  ? 'PO No. is required'
                  : docNo.checking
                    ? undefined
                    : docNo.duplicate
                      ? 'Already used'
                      : (docNo.error ?? undefined)
            }
            help={
              isEdit ? undefined : docNo.checking ? (
                'Checking…'
              ) : (
                <span style={{ color: 'var(--green2)' }}>
                  <Check size={11} style={{ verticalAlign: -1 }} /> Number not used
                </span>
              )
            }
          >
            <input
              id="pof-code"
              className={['innovic-input mono', codeState].filter(Boolean).join(' ')}
              autoComplete="off"
              readOnly={isEdit}
              // The shape the box expects follows the TYPE chosen beside it, so
              // an emptied box says "IN-JWPO-00000" on a job-work PO rather than
              // the retired single IN-PO- series.
              placeholder={isEdit ? undefined : `${poCodePrefix(poType)}00000`}
              title={isEdit ? 'The PO number is permanent once the PO exists' : undefined}
              value={code}
              onChange={(e) => setValue('header.code', e.target.value)}
              onBlur={() => {
                if (!isEdit && code.trim()) setValue('header.code', docNo.padded);
              }}
            />
          </FormField>

          <FormField label="PO Date" required size="sm" htmlFor="pof-date">
            <input
              id="pof-date"
              type="date"
              className="innovic-input mono"
              {...register('header.poDate', { required: true })}
            />
          </FormField>

          <FormField label="Due Date" size="sm" htmlFor="pof-due">
            <input
              id="pof-due"
              type="date"
              className="innovic-input mono"
              {...register('header.dueDate')}
            />
          </FormField>

          <FormField label="PO Remarks" size="full" htmlFor="pof-remarks">
            <input
              id="pof-remarks"
              className="innovic-input"
              autoComplete="off"
              {...register('header.remarks')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {/* ── Lines. */}
      <Panel
        title="Line Items"
        bodyPadding="none"
        actions={
          <>
            <span className="text3 mono">
              {fields.length} line{fields.length === 1 ? '' : 's'} · Qty {totalQty}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
              + Add Line
            </button>
          </>
        }
      >
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid tbl-edit">
            <thead>
              <tr>
                <th className="th-num" style={{ width: 52 }}>
                  Sr No.
                </th>
                <th>PR No.</th>
                <th>
                  Item Code<span className="req">★</span>
                </th>
                <th>Item Name</th>
                <th className="th-num">
                  Qty<span className="req">★</span>
                </th>
                <th className="th-num">Rate (₹)</th>
                <th className="th-num">Amount</th>
                <th>Due Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fields.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>
                    <div className="empty-state">
                      No lines yet.{' '}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
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
                    itemsLoaded={itemsLoaded}
                    onPrLoaded={onPrLoaded}
                    onRemove={() => remove(idx)}
                    canRemove={fields.length > 1}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Tax + running totals. */}
      <Panel title="Taxes and Totals">
        <FormGrid>
          <FormField label="Tax Type" size="md" htmlFor="pof-taxtype">
            <select id="pof-taxtype" className="innovic-select" {...register('header.taxType')}>
              <option value="">None</option>
              <option value="sgst_cgst">SGST + CGST</option>
              <option value="igst">IGST</option>
            </select>
          </FormField>
          {/* The percentages the chosen Tax Type does not use are dimmed, never
              disabled: a disabled registered input drops out of the form values. */}
          <FormField label="CGST %" size="xs" htmlFor="pof-cgst">
            <input
              id="pof-cgst"
              type="number"
              step="0.01"
              min={0}
              className="innovic-input mono"
              style={isSplit ? undefined : DIM}
              {...register('header.cgstPct', { valueAsNumber: true })}
            />
          </FormField>
          <FormField label="SGST %" size="xs" htmlFor="pof-sgst">
            <input
              id="pof-sgst"
              type="number"
              step="0.01"
              min={0}
              className="innovic-input mono"
              style={isSplit ? undefined : DIM}
              {...register('header.sgstPct', { valueAsNumber: true })}
            />
          </FormField>
          <FormField label="IGST %" size="xs" htmlFor="pof-igst">
            <input
              id="pof-igst"
              type="number"
              step="0.01"
              min={0}
              className="innovic-input mono"
              style={isIgst ? undefined : DIM}
              {...register('header.igstPct', { valueAsNumber: true })}
            />
          </FormField>
        </FormGrid>

        {/* Preview of unsaved input: the server recomputes and stores the
            figures itself — nothing here is transmitted as a total. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto',
            justifyContent: 'end',
            alignItems: 'baseline',
            gap: 'var(--sp-1) var(--sp-4)',
            marginTop: 'var(--sp-3)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span className="form-label">Subtotal</span>
          <span className="mono">₹{inrFormat(subtotal)}</span>
          <span className="form-label">Tax</span>
          <span className="mono">₹{inrFormat(taxAmt)}</span>
          <span className="form-label fw-700">PO Total</span>
          <span className="mono fw-700" style={{ fontSize: 'var(--fs-md)' }}>
            ₹{inrFormat(poTotal)}
          </span>
        </div>
      </Panel>

      <datalist id={PO_FORM_ITEM_DATALIST_ID}>
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.code} — {it.name}
            {it.material ? ` [${it.material}]` : ''}
          </option>
        ))}
      </datalist>
    </form>
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
