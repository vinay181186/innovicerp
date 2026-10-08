// GRN form — the EDIT screen for a saved GRN (/goods-receipt-notes/$id/edit).
// Create is <UnifiedGrnForm> + one of the three type forms; this file's create
// mode is kept for contract compatibility and is not reached from any route.
//
// It is the SAME grid and the SAME sequence as the create screen (owner's
// layout method, rule 8): Against → Vendor → Vendor paper → This receipt, four
// cells per row, every row full, cluster names in the left gutter. A clerk who
// has learned Create has already learned Edit. Only the controls differ:
//   - an identity line on top says WHICH GRN this is (rule 7);
//   - GRN Type and the source document are one-line read-only FACTS, not
//     disabled boxes (rule 4) — neither can ever be changed on a saved GRN;
//   - the lines are the ONE shared <GrnLinesTable>, not a bordered card each.
//
// What went: 12 fields in a bordered card per line (rule 9's own bad example),
// of which 9 were permanently greyed out, a half-empty header row, the
// disabled QC Status select, the disabled Inspected By picker and the
// read-only Accepted / Deviated / QC Date / QC Remarks boxes. The six quality
// facts are now one-line facts behind the line's `▸ More`, where they read as
// what they are: what Incoming QC recorded (ADR-189).
//
// QC is still never SET here. A line Incoming QC has inspected keeps today's
// lock exactly: `Received` read-only and no ✕ (the server enforces it with a
// ConflictError).

import {
  type CreateGoodsReceiptNoteInput,
  type GoodsReceiptNoteDetail,
  type GrnQcStatus,
  type UpdateGoodsReceiptNoteInput,
  isWholeNumberUom,
  roundQty,
} from '@innovic/shared';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { todayIst } from '@/lib/date';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentCode,
  IdentSep,
} from '@/ui/forms';
import { grnTypeLabel } from './grn-list-columns';
import { GrnLinesTable, GrnReceiptAccount } from './grn-lines-table';
import { type GrnLineRow, grnReceivedError, grnReceiptTotals } from './grn-receipt-figures';
import { GrnVendorCluster } from './grn-vendor-cluster';

interface LineFormValue {
  id?: string;
  existingQcStatus?: GrnQcStatus;
  /** Accepted + rejected as saved — any inspected qty freezes the line (ADR-189). */
  existingInspectedQty?: number;
  purchaseOrderLineId?: string;
  itemId?: string;
  itemCodeText: string;
  /** Live master code when the line is linked, else the saved snapshot — what
   *  the row shows. `itemCodeText` stays the value that is SENT. */
  itemCodeDisplay: string;
  itemRevision: string | null;
  /** POL — the customer's own PO line number off the SO line behind this row. */
  clientPoLineNo: string | null;
  itemName: string;
  uom: string | null;
  /** `PO Qty` on the PO line behind this row (read-only join). Null when the
   *  row traces to no PO line — every line of a DC / NC-return GRN. */
  poLineQty: number | null;
  /** `Received Earlier` — received against that same PO line by OTHER GRNs.
   *  Null on the same rows as `poLineQty`. */
  poLineReceivedQty: number | null;
  /** `Received` on THIS GRN. Text, so a half-typed value never snaps to 0. */
  receivedQty: string;
  dcRefNo?: string;
  qcStatus: GrnQcStatus;
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcDate?: string;
  qcRemarks?: string;
  /** Who inspected this line — the picked Access Control QC user, plus the name
   *  as it read on the day. Both are kept because the name is the record and the
   *  id is only the link: a signed-off inspection must not change wording when
   *  that person is later renamed or removed. Read-only here. */
  qcInspectedByUserId?: string | null;
  qcInspectedByName?: string | null;
  qcReportPath?: string | null;
  qcReportName?: string | null;
  remarks?: string;
}

interface FormValues {
  header: {
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

// ISSUE-065 — computed PER MOUNT and in IST. It used to be a module-level
// constant, so the value was frozen at first import for the whole session, and
// `todayIst()` (Intl, Asia/Kolkata) is the one helper the app already uses for
// "today in IST" — the browser's own day is wrong on a laptop that is not set
// to IST, and a UTC-derived day reads as YESTERDAY between 00:00 and 05:30 IST.
function headerDefaults(): FormValues['header'] {
  return { grnDate: todayIst() };
}

/** A hand-added line. `+ Add Line` is how a storekeeper books a delivery the PO
 *  did not have a line for — the item is typed into the row's own picker and
 *  the server resolves (or refuses) the code. It carries no PO line, so it has
 *  no PO Qty, no Received Earlier and no To Receive of its own. */
function newLine(): LineFormValue {
  return {
    itemCodeText: '',
    itemCodeDisplay: '',
    itemRevision: null,
    clientPoLineNo: null,
    itemName: '',
    uom: null,
    poLineQty: null,
    poLineReceivedQty: null,
    receivedQty: '',
    qcStatus: 'pending',
    qcAcceptedQty: 0,
    qcRejectedQty: 0,
    qcInspectedByUserId: null,
    qcInspectedByName: null,
  };
}

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
  const isCreate = !isEdit;
  const [defaults] = useState<FormValues>(() =>
    props.mode === 'edit'
      ? detailToFormValues(props.detail)
      : {
          header: {
            ...headerDefaults(),
            ...(props.initialPurchaseOrderId
              ? { purchaseOrderId: props.initialPurchaseOrderId }
              : {}),
          },
          lines: [],
        },
  );

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, setValue, setError, clearErrors, watch } =
    form;
  const errors = formState.errors;
  // Why the form refused to save — shown with the API error, above Save.
  const [formError, setFormError] = useState<string | null>(null);
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  const { onStatusChange } = props;
  const canSubmit = !formState.isSubmitting;
  useEffect(() => {
    onStatusChange?.({
      submitting: formState.isSubmitting,
      canSubmit,
      dirty: formState.isDirty,
    });
  }, [onStatusChange, formState.isSubmitting, formState.isDirty, canSubmit]);

  // ── create mode only (not reached from any route): the PO is the source ──
  const { data: posData } = usePurchaseOrdersList({ limit: 200, offset: 0 });
  // ADR-189 — a draft PO is not approved yet, so goods cannot be received on it.
  const pos = isCreate
    ? (posData?.items ?? []).filter((p) => ['open', 'partial', 'qc_pending'].includes(p.status))
    : [];
  const selectedPoId = watch('header.purchaseOrderId');
  const { data: selectedPoDetail } = usePurchaseOrder(
    isCreate && selectedPoId ? selectedPoId : undefined,
  );
  useEffect(() => {
    if (isEdit || !selectedPoDetail) return;
    if (selectedPoDetail.vendorId) {
      setValue('header.vendorId', selectedPoDetail.vendorId, { shouldDirty: true });
    }
    replace(
      selectedPoDetail.lines
        .filter((l) => l.qty - l.receivedQty > 0)
        .map(
          (l): LineFormValue => ({
            purchaseOrderLineId: l.id,
            ...(l.itemId ? { itemId: l.itemId } : {}),
            itemCodeText: l.itemCodeText ?? '',
            itemCodeDisplay: l.itemCode ?? l.itemCodeText ?? '',
            itemRevision: l.itemRevision,
            clientPoLineNo: l.clientPoLineNo,
            itemName: l.itemName,
            uom: l.uom,
            poLineQty: l.qty,
            poLineReceivedQty: l.receivedQty,
            receivedQty: String(roundQty(l.qty - l.receivedQty)),
            qcStatus: 'pending',
            qcAcceptedQty: 0,
            qcRejectedQty: 0,
            qcInspectedByUserId: null,
            qcInspectedByName: null,
          }),
        ),
    );
  }, [isEdit, selectedPoDetail, setValue, replace]);

  // ── the header's read-only facts ────────────────────────────────────────
  const detail = props.mode === 'edit' ? props.detail : undefined;
  const linkedPoId = watch('header.purchaseOrderId');
  const linkedVendorId = watch('header.vendorId');
  const vendorText = watch('header.vendorCodeText') ?? '';
  const vendorLabel = detail?.vendorName ?? selectedPoDetail?.vendorName ?? vendorText;
  // ONE test of which inward type a saved GRN is, shared with the list and the
  // detail page (grn-list-columns) so the three surfaces cannot drift. It
  // answers null for a legacy row with no PO, DC or NC linked at all — that
  // row's source box is `PO No. (not linked)`, so Against PO is its type.
  const typeLabel = (detail ? grnTypeLabel(detail) : null) ?? 'Against PO';
  const isNc = Boolean(detail?.ncId);
  const isDc = !isNc && Boolean(detail?.deliveryChallanId);
  // The receipt account and the three account columns are AGAINST PO only.
  // A DC / NC GRN line does carry a purchase_order_line_id, so poLineQty and
  // poLineReceivedQty come back populated — but the figure the clerk typed
  // against on those types is the CHALLAN line's `Sent Qty`, which this
  // response does not carry, so the PO line qty is a different fact and
  // showing it under either label would contradict the lines. On a
  // replacement (NC) GRN it is also wrong arithmetic: the API leaves this
  // GRN's own receipt out of the PO line's received column until QC clears
  // it, so To Receive would understate by exactly that line's Received.
  const isPo = !isNc && !isDc;
  // EDIT is where a mis-keyed receipt gets corrected, so the item cells and
  // `+ Add Line` come back here — but only on an Against PO GRN. A DC / NC
  // line mirrors a challan or an NC line: the item is not the storekeeper's to
  // retype, and CREATE builds its lines from the picked source document.
  const itemEditable = isEdit && isPo;

  // ── the lines, as the one shared table reads them ───────────────────────
  const lineVals = watch('lines') ?? [];
  const capFor = (poQty: number | null, earlier: number | null): number | undefined =>
    isPo && poQty !== null ? roundQty(poQty - (earlier ?? 0)) : undefined;
  // Driven by the live VALUES (watch), keyed by the field array's own ids. Not
  // the other way round: `fields` carries RHF's generated key as `id`, which is
  // not this line's database id, so reading a row out of it would put the wrong
  // id in front of every other field.
  const rows: GrnLineRow[] = lineVals.map((l, idx) => {
    const qcCleared = l.existingQcStatus === 'completed';
    const locked = qcCleared || (l.existingInspectedQty ?? 0) > 0;
    // Only where the row actually offers the picker, so the "is required" note
    // never appears under a cell that has no control.
    const itemTyped = itemEditable && !locked;
    const poQty = l.poLineQty ?? null;
    const earlier = l.poLineReceivedQty ?? null;
    const cap = capFor(poQty, earlier);
    return {
      key: fields[idx]?.id ?? `line-${idx}`,
      clientPoLineNo: l.clientPoLineNo ?? null,
      itemCode: l.itemCodeDisplay || l.itemCodeText,
      itemRevision: l.itemRevision ?? null,
      itemName: l.itemName,
      itemId: l.itemId ?? null,
      itemError: itemTyped && !l.itemName.trim() ? 'Item Name is required.' : null,
      uom: l.uom,
      qty: poQty,
      receivedEarlier: earlier,
      ...(cap === undefined ? {} : { pendingQty: cap }),
      receiveNow: l.receivedQty ?? '',
      dcRefNo: l.dcRefNo ?? '',
      remarks: l.remarks ?? '',
      // `blankIsZero: false` — this line already exists, so an empty box is a
      // missing answer, not "not receiving this line". `cap` only where it is the
      // figure this receipt was typed against (see `capFor`).
      error: grnReceivedError(l.receivedQty ?? '', {
        uom: l.uom,
        cap,
        blankIsZero: false,
      }),
      qcStatus: l.existingQcStatus ?? 'pending',
      locked,
      ...(isEdit
        ? {
            qc: {
              acceptedQty: Number(l.qcAcceptedQty ?? 0),
              rejectedQty: Number(l.qcRejectedQty ?? 0),
              qcDate: l.qcDate ?? null,
              inspectedBy: l.qcInspectedByName ?? null,
              qcRemarks: l.qcRemarks ?? null,
              qcReportName: l.qcReportName ?? null,
            },
          }
        : {}),
    };
  });
  // Decimals follow the unit (0172 / S9): whole pieces for NOS / SET, 3 places
  // for KGS / MTR — and for a line with no unit at all, which is what this form
  // allowed before the column existed.
  const decimal = rows.some((r) => !isWholeNumberUom(r.uom));
  // The account, from the same `accountOf` the table foots and the VIEW page
  // reads, so one GRN can no longer show an account on Edit and none on Detail.
  // It comes back null the moment any row has no PO line behind it — a legacy
  // GRN booked without a PO, or a line just added by hand — because there is
  // then no total to state: see `accountOf`.
  const { account } = grnReceiptTotals(rows);
  const showAccount = isPo && account !== null;
  // Why the account is missing, said once where the cause is. Only when this
  // screen WOULD have shown one.
  const accountWithheld = isPo && account === null && rows.length > 0;

  // The picker reports the resolved refs; the line keeps the typed code in BOTH
  // `itemCodeText` (what is SENT) and `itemCodeDisplay` (what the row shows), so
  // the cell can never show one code while saving another.
  const onItemChange = (
    idx: number,
    next: { code: string; itemId: string | null; name: string },
  ): void => {
    setValue(`lines.${idx}.itemCodeText` as const, next.code, { shouldDirty: true });
    setValue(`lines.${idx}.itemCodeDisplay` as const, next.code, { shouldDirty: true });
    setValue(`lines.${idx}.itemId` as const, next.itemId ?? undefined, { shouldDirty: true });
    setValue(`lines.${idx}.itemName` as const, next.name, { shouldDirty: true });
  };

  const onValid = async (values: FormValues): Promise<void> => {
    setFormError(null);
    // Every line re-checked against the same rule the boxes show inline, so a
    // bad qty is refused here rather than coming back as a 400 from the API.
    if (rows.some((r) => r.error !== null)) {
      setFormError('Fix the highlighted quantities.');
      return;
    }
    // The server requires a name on every line (`itemName: min(1)`) and an item
    // REF — `itemId` or `itemCodeText` (the shared refine, ADR-012 #10, and
    // service.ts's own `Item Code is required.`). Say both in plain words here
    // rather than letting a hand-added line come back as a 400, or worse as the
    // refine's developer wording.
    if (values.lines.some((l) => !l.itemName.trim())) {
      setFormError('Item Name is required on every line.');
      return;
    }
    if (values.lines.some((l) => !l.itemCodeText.trim() && !l.itemId)) {
      setFormError('Item Code is required on every line.');
      return;
    }
    // A vendor is required on create (server enforces via the create schema
    // refine + migration 0080 CHECK). Either the vendor dropdown or the
    // free-text fallback satisfies it. Guard here so the user gets a friendly
    // message before submit instead of a 400 from the API.
    if (isCreate) {
      const hasVendor =
        Boolean(values.header.vendorId) || Boolean(values.header.vendorCodeText?.trim());
      if (!hasVendor) {
        setError('header.vendorId', { type: 'required', message: 'Vendor is required.' });
        return;
      }
      clearErrors('header.vendorId');
    }

    // ADR-226 — an EMPTIED optional box sends `null`, never `undefined`.
    //
    // Now that an edit sends only what changed, the two mean different things:
    // an absent key is "leave it alone", and null is "the user emptied it".
    // Mapping an empty box to `undefined` meant deleting a wrongly-typed Vendor
    // Invoice No. (or GRN Remarks, Vendor Challan No., the unlinked PO No., the
    // unlinked Vendor Code) was indistinguishable from never touching it: the
    // screen said "Nothing changed on this GRN" and the old value stayed. The
    // five are `.nullable()` in packages/shared and the service has always
    // written `?? null`, so nothing on the server changes. Delivery Challan and
    // Customer Dispatch already did this.
    //
    // `purchaseOrderId` and `vendorId` stay `undefined`-only: they are id links,
    // and clearing one would mean UNLINK, which this screen cannot do.
    const headerOut = {
      ...values.header,
      purchaseOrderId: values.header.purchaseOrderId || undefined,
      poCodeText: values.header.poCodeText?.trim() || null,
      vendorId: values.header.vendorId || undefined,
      vendorCodeText: values.header.vendorCodeText?.trim() || null,
      dcNo: values.header.dcNo?.trim() || null,
      invoiceNo: values.header.invoiceNo?.trim() || null,
      remarks: values.header.remarks?.trim() || null,
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
        receivedQty: Number(String(l.receivedQty).trim() || '0'),
        dcRefNo: l.dcRefNo?.trim() || undefined,
        // ADR-226 / §20.4 — QC Date, QC Remarks, the inspector and the QC report
        // are NO LONGER SENT. They are rendered read-only here (ADR-189: a GRN
        // receives, Incoming QC inspects) and `mergeLines` never writes them, so
        // sending them was a photograph of someone else's work travelling back to
        // the server for no reason.
        //
        // qcStatus / qcAcceptedQty / qcRejectedQty DO still travel, and that is
        // not an oversight: the shared line schema gives all three a `.default()`
        // ('pending' / 0 / 0), so OMITTING them is indistinguishable from
        // SETTING them to pending-and-nothing-inspected. The server then reads
        // `u.data.qcStatus !== u.prev.qcStatus` and refuses the whole save with
        // "QC is Completed, so this line cannot be edited" on any GRN that has an
        // inspected line. Dropping them needs the three to be made optional in
        // packages/shared (frozen here) first.
        qcStatus: l.qcStatus,
        qcAcceptedQty: Number(l.qcAcceptedQty),
        qcRejectedQty: Number(l.qcRejectedQty),
        remarks: l.remarks?.trim() || undefined,
      };
    });

    if (props.mode === 'edit') {
      await props.onSubmit({ header: headerOut, lines: linesOut });
    } else {
      // No `code`: a blank GRN No. means "auto", and the server numbers it
      // (nextGrnCode). There is no GRN No. box on a create screen by design.
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateGoodsReceiptNoteInput);
    }
  };

  return (
    <form id={props.formId} onSubmit={handleSubmit(onValid)}>
      {/* Save error summary right under the page header, where Save is. */}
      {(formError ?? props.submitError) ? (
        <Banner tone="error" role="alert">
          {formError ?? props.submitError}
        </Banner>
      ) : null}

      <Panel title="Receipt">
        {/* Rule 7 — an identity line on top says WHICH document this is. Those
            are not facts ABOUT the GRN, so they sit above the grid. */}
        {detail ? (
          <DocIdent>
            <IdentCode>{detail.code}</IdentCode>
            <IdentSep />
            <span>{typeLabel}</span>
            {(detail.ncCode ?? detail.poCode ?? detail.poCodeText) ? (
              <>
                <IdentSep />
                <IdentCode>{detail.ncCode ?? detail.poCode ?? detail.poCodeText}</IdentCode>
              </>
            ) : null}
            {vendorLabel ? (
              <>
                <IdentSep />
                <span>{vendorLabel}</span>
              </>
            ) : null}
          </DocIdent>
        ) : null}

        <ClusterGrid>
          {/* Row 1 — which paper am I receiving against. Neither GRN Type nor
              the source document can change on a saved GRN, so on edit they are
              FACTS, not disabled controls. */}
          <Cluster name="Against">
            <ClusterFact label="GRN Type" value={typeLabel} />
            {isNc ? (
              <ClusterFact
                label="NC No."
                span={2}
                num
                value={detail?.ncCode ?? detail?.poCodeText ?? '—'}
                empty={!(detail?.ncCode ?? detail?.poCodeText)}
              />
            ) : isDc ? (
              <>
                <ClusterFact
                  label="JW PO"
                  num
                  value={detail?.poCode ?? detail?.poCodeText ?? '—'}
                  empty={!(detail?.poCode ?? detail?.poCodeText)}
                />
                <ClusterFact
                  label="DC No."
                  num
                  value={detail?.dcCode ?? '—'}
                  empty={!detail?.dcCode}
                />
              </>
            ) : isEdit && linkedPoId ? (
              <ClusterFact
                label="PO No."
                span={2}
                num
                value={detail?.poCode ?? detail?.poCodeText ?? '—'}
                empty={!(detail?.poCode ?? detail?.poCodeText)}
              />
            ) : isEdit ? (
              /* Legacy row with no PO linked: the free-text box this form has
                 always shown, in the very cell the linked PO fact occupies, so
                 the row still comes out full and nothing shifts. */
              <FormField
                label="PO No. (not linked)"
                htmlFor="poCodeText"
                className="cl-span-2"
                help="This GRN was booked without a purchase order behind it."
              >
                <input
                  id="poCodeText"
                  className="innovic-input mono fw-700"
                  autoComplete="off"
                  {...register('header.poCodeText')}
                />
              </FormField>
            ) : (
              <FormField label="PO No." htmlFor="purchaseOrderId" className="cl-span-2">
                <select
                  id="purchaseOrderId"
                  className="innovic-select"
                  {...register('header.purchaseOrderId')}
                >
                  <option value="">— Select PO —</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.vendorName ?? p.vendorCodeText ?? '—'}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            <FormField label="GRN Date" required htmlFor="grnDate">
              <input
                id="grnDate"
                type="date"
                className="innovic-input"
                {...register('header.grnDate', { required: 'GRN Date is required.' })}
              />
            </FormField>
          </Cluster>

          {/* Row 2 — who delivered it. The one shared cluster; only the Vendor
              cell differs by screen, and the screen hands it in. Vendor stays
              EDITABLE here (it is the only vendor entry point this document
              has), while its code and GSTIN are read off the master and so are
              facts. A legacy row with no vendor linked keeps its free-text code
              box, in the very cell the Vendor Code fact occupies — no short row
              either way. */}
          <GrnVendorCluster
            vendorId={linkedVendorId}
            vendor={
              <VendorPicker
                className="form-grp cl-span-2"
                value={linkedVendorId || null}
                initialLabel={detail?.vendorName ?? ''}
                carriedText={linkedVendorId ? '' : vendorText}
                {...(errors.header?.vendorId?.message
                  ? { error: errors.header.vendorId.message }
                  : {})}
                onChange={(id) => {
                  setValue('header.vendorId', id ?? '', { shouldDirty: true });
                  if (id) clearErrors('header.vendorId');
                }}
              />
            }
            codeFallback={
              <FormField label="Vendor Code (not linked)" htmlFor="vendorCodeText">
                <input
                  id="vendorCodeText"
                  className="innovic-input mono fw-700"
                  autoComplete="off"
                  {...register('header.vendorCodeText')}
                />
              </FormField>
            }
          />

          {/* Row 3 — their paperwork. */}
          <Cluster name="Vendor paper">
            <FormField label="Vendor Invoice No." htmlFor="invoiceNo">
              <input
                id="invoiceNo"
                className="innovic-input"
                autoComplete="off"
                {...register('header.invoiceNo')}
              />
            </FormField>
            <FormField label="Vendor Challan No." htmlFor="dcNo">
              <input
                id="dcNo"
                className="innovic-input"
                autoComplete="off"
                {...register('header.dcNo')}
              />
            </FormField>
            {/* The DOCUMENT's note. The line's own is `Remarks`, behind ▸ More. */}
            <FormField label="GRN Remarks" htmlFor="remarks" className="cl-span-2">
              <input
                id="remarks"
                className="innovic-input"
                autoComplete="off"
                {...register('header.remarks')}
              />
            </FormField>
          </Cluster>

          {/* Row 4 — THE ACCOUNT: how much this receipt settles. Read-only, it
              reads left to right and ends on the result, and it recomputes from
              the lines on every keystroke. Against PO only (see `isPo`); the
              other two types end on row 3, with every row still full. */}
          {showAccount && account ? (
            <GrnReceiptAccount account={account} qtyLabel="PO Qty" />
          ) : null}
        </ClusterGrid>
      </Panel>

      <Panel
        title={`Line Items (${rows.length})`}
        bodyPadding="none"
        {...(itemEditable || accountWithheld
          ? {
              actions: (
                <>
                  {/* Said where the cause is: a line with no PO line behind it
                      is why the header has no `This receipt` row. */}
                  {accountWithheld ? (
                    <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                      A line that is not on the purchase order cannot be totalled against it, so
                      this GRN shows no receipt account.
                    </span>
                  ) : null}
                  {itemEditable ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => append(newLine())}
                    >
                      <Plus size={13} /> Add Line
                    </button>
                  ) : null}
                </>
              ),
            }
          : {})}
      >
        <GrnLinesTable
          rows={rows}
          qtyLabel="PO Qty"
          showAccount={showAccount}
          decimal={decimal}
          showQc={isEdit}
          {...(itemEditable ? { item: { onChange: onItemChange } } : {})}
          challan={{
            headerValue: (watch('header.dcNo') ?? '').trim(),
            onChange: (idx, v) =>
              setValue(`lines.${idx}.dcRefNo` as const, v, { shouldDirty: true }),
          }}
          emptyText={
            isCreate ? 'Pick a PO above to load its pending lines.' : 'This GRN has no lines.'
          }
          onReceiveNow={(idx, v) =>
            setValue(`lines.${idx}.receivedQty` as const, v, { shouldDirty: true })
          }
          onRemarks={(idx, v) =>
            setValue(`lines.${idx}.remarks` as const, v, { shouldDirty: true })
          }
          onRemove={(idx) => remove(idx)}
        />
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
        existingInspectedQty: Number(l.qcAcceptedQty) + Number(l.qcRejectedQty),
        ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
        ...(l.itemId ? { itemId: l.itemId } : {}),
        itemCodeText: l.itemCodeText ?? '',
        itemCodeDisplay: l.itemCode ?? l.itemCodeText ?? '',
        itemRevision: l.itemRevision,
        clientPoLineNo: l.clientPoLineNo,
        // The master's live name is what the GRN SCREENS show (NAMING.md
        // `masterItemName`); the line's saved copy is the fallback.
        itemName: l.masterItemName ?? l.itemName,
        uom: l.uom ?? null,
        poLineQty: l.poLineQty ?? null,
        poLineReceivedQty: l.poLineReceivedQty ?? null,
        receivedQty: String(l.receivedQty),
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
