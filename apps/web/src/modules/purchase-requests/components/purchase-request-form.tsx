// Purchase Request form (UI-003-04) — single-row entity per ADR-015 #2, so the
// Item Code → Item cascade is one direct hook call, not one per line.
//
// Vendor is <PrVendorField> — the shared type-to-search picker. The free-text
// "Vendor Code (fallback)" input it replaced is gone, but `vendorCodeText` is
// NOT: it stays in form state and `onValid` re-sends it unchanged, because an
// older PR (and every OSP-generated one, which carries a `(vendor TBD)`
// sentinel) may hold free text and no `vendorId`, and the DB CHECK
// (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015) demands one of the
// two. Dropping it would make those PRs unsaveable.
//
// Layout (create-page pattern): sticky PageHeader (Cancel + blue Save, Ctrl+S)
// → one Panel on the 12-column grid, in the order the buyer thinks:
// PR Type · PR No. · PR Date / Item Code · Item Name · PR Qty /
// Due Date · Vendor · Est. Rate / Operation / Remarks.

import {
  type CreatePurchaseRequestInput,
  type ListItemsResponse,
  PR_TYPES,
  type PurchaseRequest,
  type PurchaseRequestDetail,
  type UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { type Path, type PathValue, useForm } from 'react-hook-form';
import {
  type CascadeField,
  type CascadeFieldOptions,
  cascadeField,
  useFieldCascade,
} from '@/lib/use-field-cascade';
import { useItemsList } from '@/modules/items/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import {
  PR_FORM_DEFAULTS,
  PR_ITEM_DATALIST_ID,
  PR_USER_ENTERED_FIELDS,
  type PrFormValues,
} from './pr-form-values';
import { PR_TYPE_LABELS } from '../lib/pr-labels';
import { PrVendorField } from './pr-vendor-field';

type FormValues = PrFormValues;
type PrItemMaster = ListItemsResponse['items'][number];

/** `cascadeField` with this form and this source record pinned, so each dependent
 *  below reads as just "path, where it comes from, what empty means". */
function prField<TName extends Path<FormValues>>(
  name: TName,
  from: (item: PrItemMaster) => PathValue<FormValues, TName>,
  empty: PathValue<FormValues, TName>,
  options?: CascadeFieldOptions,
): CascadeField<FormValues, PrItemMaster> {
  return cascadeField<FormValues, PrItemMaster, TName>(name, from, empty, options);
}

/** The page band the form renders itself, so Save sits top-right in the sticky
 *  header and is a real submit button of THIS form. */
type HeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  backLabel?: string;
  onBack?: () => void;
};

/** What "Save & New" carries onto the next blank form: PR Date, PR Type and
 *  Vendor (with its label, so the picker shows it). */
export interface PrKeepValues {
  prDate: string;
  prType: FormValues['prType'];
  vendorId?: string | undefined;
  vendorLabel: string;
}

type CreateMode = HeaderProps & {
  mode: 'create';
  onSubmit: (values: CreatePurchaseRequestInput) => Promise<void> | void;
  /** Given → a ghost "Save & New" button sits beside Save. It saves the same
   *  payload, then the page reopens a blank form seeded from `keep`. */
  onSaveAndNew?: (values: CreatePurchaseRequestInput, keep: PrKeepValues) => Promise<void> | void;
  /** Seeds for a new PR — from Save & New (date / type / vendor) or from a
   *  "Raise PR" link (`?itemId=&qty=`: item + qty). Every one stays editable. */
  initialValues?: Partial<FormValues> | undefined;
  /** "CODE — Name" of a seeded vendor, so the picker shows it. */
  initialVendorLabel?: string | undefined;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = HeaderProps & {
  mode: 'edit';
  detail: PurchaseRequestDetail;
  onSubmit: (values: UpdatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type PurchaseRequestFormProps = CreateMode | EditMode;

export function PurchaseRequestForm(props: PurchaseRequestFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { ...PR_FORM_DEFAULTS, ...(props.initialValues ?? {}) };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch } = form;
  const errors = formState.errors;

  // Free text already stored on this PR. Its presence is what lets the vendor
  // picker be left empty — see the rule in <PrVendorField>.
  const carriedVendorText = isEdit ? (props.detail.vendorCodeText?.trim() ?? '') : '';
  const vendorInitialLabel = isEdit
    ? joinVendorLabel(props.detail)
    : (props.initialVendorLabel ?? '');
  // The vendor's label as last picked — Save & New hands it to the next form.
  const vendorLabelRef = useRef(vendorInitialLabel);
  // Which header button submitted: Save (false) or Save & New (true).
  const andNewRef = useRef(false);
  const onSaveAndNew = props.mode === 'create' ? props.onSaveAndNew : undefined;

  // Item master drives the code autosuggest + name auto-fill. PR still accepts
  // off-master free text, so a non-matching code is left as-is.
  const { data: itemsData } = useItemsList({ limit: 1000, offset: 0 });
  const items = itemsData?.items ?? [];
  // Until this has actually arrived, every code looks off-master — so the
  // cascade stays inert rather than resetting the name against a master it
  // cannot see yet.
  const itemsLoaded = itemsData !== undefined;
  const itemsByCode = useMemo(() => {
    const m = new Map<string, PrItemMaster>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  // Item Code is the controller; Item Id + Item Name are its dependents.
  //
  // Name is `userEditable`: a PR may be raised for an off-master part (the DB
  // CHECK `num_nonnulls(item_id, item_code_text) >= 1` accepts a bare code), and
  // the name the user typed for such a part is theirs to keep. So it is replaced
  // whenever the code matches a master item, but on a miss it is only cleared
  // while it still holds exactly what we auto-filled — which is what stops a
  // stale name from sitting under a code that no longer matches.
  //
  // Id is not: nothing but a master match can ever put a value there, so a miss
  // always clears it (as the old inline handler did).
  useFieldCascade<FormValues, PrItemMaster>({
    form,
    value: watch('itemCodeText'),
    enabled: itemsLoaded,
    resolve: (code) => itemsByCode.get(code.toUpperCase()) ?? null,
    fields: [
      prField('itemId', (it) => it.id, undefined),
      prField('itemName', (it) => it.name, '', { userEditable: true }),
    ],
    userEntered: PR_USER_ENTERED_FIELDS,
  });

  const onValid = async (values: FormValues): Promise<void> => {
    // Send BOTH the code and the master id whenever the cascade resolved one.
    //
    // This used to be an either/or: a non-empty code sent `itemCodeText` ALONE
    // and dropped `itemId`, so every hand-raised PR was stored with no link to
    // the Item Master even when the code matched it exactly. That null was then
    // copied PR -> PO line -> DC line -> GRN line, and creditGrnQcStock returns
    // early on `!itemId` — so QC accept credited nothing and the stock never
    // moved. Only system-raised OSP PRs (which set itemId directly) worked.
    const trimmedItemCode = values.itemCodeText?.trim();
    const itemRefs: { itemId?: string; itemCodeText?: string } = {
      ...(values.itemId ? { itemId: values.itemId } : {}),
      ...(trimmedItemCode ? { itemCodeText: trimmedItemCode } : {}),
    };

    const payload = {
      prDate: values.prDate,
      ...(values.vendorId
        ? { vendorId: values.vendorId }
        : values.vendorCodeText?.trim()
          ? { vendorCodeText: values.vendorCodeText.trim() }
          : {}),
      ...itemRefs,
      itemName: values.itemName?.trim() || undefined,
      qty: Number(values.qty),
      estCost: Number(values.estCost),
      requiredDate: values.requiredDate || undefined,
      operation: values.operation?.trim() || undefined,
      remarks: values.remarks?.trim() || undefined,
    };

    if (isEdit) {
      await props.onSubmit(payload);
    } else {
      // PR No. is system-generated, full stop: `code` is never sent, so the
      // server always allocates the next IN-PR-#####. It used to be a free text
      // box that merely defaulted to auto when left blank, which is how PRs
      // ended up coded "001" / "002" / "009" instead of the series.
      // prType is create-only — `updatePurchaseRequestInputSchema` omits it, so
      // it is never sent on an edit.
      const createPayload = {
        prType: values.prType,
        ...payload,
      } as CreatePurchaseRequestInput;
      const andNew = andNewRef.current;
      andNewRef.current = false;
      if (andNew && onSaveAndNew) {
        await onSaveAndNew(createPayload, {
          prDate: values.prDate,
          prType: values.prType,
          vendorId: values.vendorId,
          vendorLabel: values.vendorId ? vendorLabelRef.current : '',
        });
      } else {
        await props.onSubmit(createPayload);
      }
    }
  };

  // Ctrl+S runs the same Save as the header button.
  const submitting = formState.isSubmitting;
  useSaveShortcut(() => void handleSubmit(onValid)(), !submitting);

  // Field errors, collected so the user sees them under the header, where Save
  // is — not only beside a field that may be scrolled away.
  const errorList = [
    errors.prDate?.message,
    errors.itemCodeText?.message,
    errors.qty?.message,
    errors.vendorId?.message,
    errors.code?.message,
  ].filter((m): m is string => typeof m === 'string' && m !== '');

  const itemLocked = Boolean(watch('itemId'));

  return (
    <form onSubmit={handleSubmit(onValid)}>
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
            {onSaveAndNew ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                title="Save this PR, then open a blank one with the same PR Date, PR Type and Vendor"
                onClick={() => {
                  andNewRef.current = true;
                  void handleSubmit(onValid, () => {
                    andNewRef.current = false;
                  })();
                }}
              >
                Save &amp; New
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              title="Save (Ctrl+S)"
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : (
                (props.submitLabel ?? (isEdit ? 'Save Changes' : 'Save PR'))
              )}
            </button>
          </>
        }
      />

      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}
      {errorList.length > 0 ? (
        <Banner tone="warn" role="alert">
          {errorList.join(' · ')}
        </Banner>
      ) : null}

      <Panel>
        <FormGrid>
          {/* ── Row 1: PR Type · PR No. · PR Date */}
          <FormField
            label="PR Type"
            size="md"
            htmlFor="prType"
            help={isEdit ? undefined : 'Service = work done outside (DC out).'}
          >
            {/* What this PR is FOR, and therefore what the PO it becomes can do:
                standard ends in a GRN (goods in), service sends the item out on
                a DC and receives it back (the job-work chain). 'jw_osp' is NOT
                offered — the system stamps that itself when an outsource JC op
                raises the PR, and hand-picking it would fake an OSP job with no
                operation behind it.

                Immutable after create: `updatePurchaseRequestInputSchema` omits
                prType, so on edit this shows the stored value read-only rather
                than a dropdown that silently would not save. */}
            {isEdit ? (
              <input
                id="prType"
                className="innovic-input is-derived"
                readOnly
                value={PR_TYPE_LABELS[watch('prType') ?? 'standard']}
              />
            ) : (
              <select
                id="prType"
                className="innovic-select"
                title="Service = buying work (calibration, heat-treat, plating). Its PO sends the item out on a DC instead of receiving stock in."
                {...register('prType')}
              >
                {PR_TYPES.filter((t) => t === 'standard' || t === 'service').map((t) => (
                  <option key={t} value={t}>
                    {PR_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField label="PR No." size="md" htmlFor="code" error={errors.code?.message}>
            {/* System-generated, never typed. The server allocates the next
                IN-PR-##### on save. This was a free text box that only defaulted
                to auto when left blank, which is how PRs ended up numbered
                "001" / "002" / "009" instead of following the series. */}
            <input
              id="code"
              className="innovic-input is-derived"
              readOnly
              tabIndex={-1}
              value={isEdit ? (watch('code') ?? '') : 'Auto-generated on save'}
              onChange={() => undefined}
            />
          </FormField>

          <FormField label="PR Date" required size="md" htmlFor="prDate">
            <input
              id="prDate"
              type="date"
              className="innovic-input"
              {...register('prDate', { required: 'PR Date is required.' })}
            />
          </FormField>

          {/* ── Row 2: Item Code · Item Name · PR Qty */}
          <FormField label="Item Code" required={!isEdit} size="sm" htmlFor="itemCodeText">
            {/* Stays a free-text box over a <datalist>, not a picker: a picker can
                only return a master row's id, and an off-master item is legitimate
                on a PR (ADR-124). */}
            <input
              id="itemCodeText"
              className="innovic-input"
              list={PR_ITEM_DATALIST_ID}
              autoComplete="off"
              placeholder="🔍 ITM-001"
              {...register('itemCodeText')}
            />
          </FormField>

          <FormField label="Item Name" size="lg" htmlFor="itemName">
            {/* Rule: item code is the unique key — on-master name is derived +
                read-only; off-master free text stays editable. */}
            <input
              id="itemName"
              className={itemLocked ? 'innovic-input is-derived' : 'innovic-input'}
              autoComplete="off"
              readOnly={itemLocked}
              title={itemLocked ? 'Auto-filled from Item Master (item code is the key)' : undefined}
              {...register('itemName')}
            />
          </FormField>

          <FormField label="PR Qty" required size="sm" htmlFor="qty" error={errors.qty?.message}>
            <input
              id="qty"
              type="number"
              min={1}
              className="innovic-input"
              {...register('qty', {
                valueAsNumber: true,
                min: { value: 1, message: 'PR Qty must be at least 1.' },
              })}
            />
          </FormField>

          {/* ── Row 3: Due Date · Vendor · Est. Rate */}
          <FormField label="Due Date" size="sm" htmlFor="requiredDate">
            <input
              id="requiredDate"
              type="date"
              className="innovic-input"
              {...register('requiredDate')}
            />
          </FormField>

          {/* The shared picker brings its own .form-grp; this cell gives it the
              party width (6/12) on the grid. */}
          <div className="f-lg">
            <PrVendorField
              form={form}
              carriedVendorText={carriedVendorText}
              initialLabel={vendorInitialLabel}
              onPickLabel={(label) => {
                vendorLabelRef.current = label;
              }}
            />
          </div>

          <FormField label="Est. Rate (₹)" size="sm" htmlFor="estCost">
            <input
              id="estCost"
              type="number"
              step="0.01"
              min={0}
              className="innovic-input"
              {...register('estCost', { valueAsNumber: true })}
            />
          </FormField>

          {/* Status is NOT a field, on create or edit: a new PR is always 'open',
              stamped by the server, and it advances only via Approve / Reject /
              Create PO. The Edit page header shows the current status badge. */}

          {/* ── Row 4 / 5: Operation · Remarks */}
          <FormField label="Operation" size="full" htmlFor="operation">
            <input
              id="operation"
              className="innovic-input"
              autoComplete="off"
              placeholder="COATING / TURN / …"
              {...register('operation')}
            />
          </FormField>

          <FormField label="Remarks" size="full" htmlFor="remarks">
            <textarea id="remarks" className="innovic-textarea" rows={3} {...register('remarks')} />
          </FormField>
        </FormGrid>
      </Panel>

      <datalist id={PR_ITEM_DATALIST_ID}>
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.name}
          </option>
        ))}
      </datalist>
    </form>
  );
}

/** "CODE — Name" for the vendor already linked to this PR, so the picker reads
 *  correctly on edit before its own search page has loaded. */
function joinVendorLabel(detail: PurchaseRequestDetail): string {
  if (!detail.vendorId) return '';
  const name = detail.vendorName ?? '';
  return detail.vendorCode ? `${detail.vendorCode} — ${name}`.trim() : name;
}

function detailToFormValues(detail: PurchaseRequest): FormValues {
  return {
    code: detail.code,
    prDate: detail.prDate,
    status: detail.status,
    prType: detail.prType,
    ...(detail.vendorId ? { vendorId: detail.vendorId } : {}),
    ...(detail.vendorCodeText ? { vendorCodeText: detail.vendorCodeText } : {}),
    ...(detail.itemId ? { itemId: detail.itemId } : {}),
    ...(detail.itemCodeText ? { itemCodeText: detail.itemCodeText } : {}),
    ...(detail.itemName ? { itemName: detail.itemName } : {}),
    qty: detail.qty,
    estCost: Number(detail.estCost),
    ...(detail.requiredDate ? { requiredDate: detail.requiredDate } : {}),
    ...(detail.operation ? { operation: detail.operation } : {}),
    ...(detail.remarks ? { remarks: detail.remarks } : {}),
  };
}
