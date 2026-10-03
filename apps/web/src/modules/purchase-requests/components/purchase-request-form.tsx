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
// Layout (Plan screens method, 2026-10-03): sticky PageHeader (Cancel + blue
// Save, Ctrl+S) → one Panel: an identity line (PR No., SO line, JC op), then
// four clusters of four cells, in the order the requester thinks —
//   Item     Item Code · Item Name (2) · PR Qty
//   Request  PR Type · PR Date · Due Date · Operation
//   Vendor   Vendor (2) · Est. Rate · Est. Amount (= qty × rate, the result)
//   Notes    Remarks (4)
// The PR view page shows the same clusters in the same order.

import {
  type CreatePurchaseRequestInput,
  type ListItemsResponse,
  PR_TYPES,
  type PurchaseRequest,
  type PurchaseRequestDetail,
  type UpdatePurchaseRequestInput,
  opSrNo,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { type Path, type PathValue, useForm } from 'react-hook-form';
import {
  type CascadeField,
  type CascadeFieldOptions,
  cascadeField,
  useFieldCascade,
} from '@/lib/use-field-cascade';
import { soNoWithInternal } from '@/lib/so-number';
import { useItemCodeResolver, useItemCodeSearch } from '@/modules/items/use-item-code-search';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterGrid, DocIdent, FormField, IdentCode, IdentSep } from '@/ui/forms';
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
  // excludePartyOwned (ADR-195): a customer's own -rm material is never purchased,
  // so it must not appear in the PR line picker.
  // Searched on the SERVER with the typed code — it used to be one preloaded page
  // of 1000, so a later item could neither be suggested nor auto-filled.
  const itemCodeValue = watch('itemCodeText') ?? '';
  const { items, match: matchedItem } = useItemCodeSearch(itemCodeValue, {
    excludePartyOwned: true,
  });
  const resolveItemCode = useItemCodeResolver({ excludePartyOwned: true });

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
    value: itemCodeValue,
    // Async exact-code lookup; a failed request leaves the fields as they are.
    resolve: resolveItemCode,
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
  // The item's unit, shown beside PR Qty (KGS / MTR may be decimal).
  const qtyUom = matchedItem?.uom ?? null;
  // The estimate the buyer is asking for, worked out as they type.
  const estQty = Number(watch('qty'));
  const estRate = Number(watch('estCost'));
  const estAmount = Number.isFinite(estQty * estRate) ? estQty * estRate : 0;

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
        {/* Which PR this is — on create the number does not exist yet. */}
        <DocIdent>
          {isEdit ? (
            <>
              <IdentCode>{props.detail.code}</IdentCode>
              {props.detail.soCode ? (
                <>
                  <IdentSep />
                  <span>
                    SO{' '}
                    <IdentCode>
                      {soNoWithInternal(props.detail.soCode, props.detail.soInternalNo)}
                    </IdentCode>
                    {props.detail.soLineNo ? ` · Ln ${props.detail.soLineNo}` : ''}
                  </span>
                </>
              ) : null}
              {props.detail.sourceJcCode ? (
                <>
                  <IdentSep />
                  <span>
                    JC <IdentCode>{props.detail.sourceJcCode}</IdentCode>
                    {props.detail.sourceJcOpSeq
                      ? ` · Op ${opSrNo(props.detail.sourceJcOpSeq)}`
                      : ''}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <span>
              PR No. <span className="text3">— auto-generated on save</span>
            </span>
          )}
        </DocIdent>

        {/* Four clusters, four cells each, in the order the requester thinks:
            WHAT and how many → what kind of buy and by when → who supplies it
            and roughly what it costs → anything else. The PR view page uses
            the same clusters in the same order. */}
        <ClusterGrid>
          <Cluster name="Item">
            <FormField
              label="Item Code"
              required={!isEdit}
              htmlFor="itemCodeText"
              error={errors.itemCodeText?.message}
            >
              {/* Stays a free-text box over a <datalist>, not a picker: a picker can
                  only return a master row's id, and an off-master item is legitimate
                  on a PR (ADR-124). */}
              <input
                id="itemCodeText"
                className="innovic-input mono fw-700"
                list={PR_ITEM_DATALIST_ID}
                autoComplete="off"
                placeholder="🔍 ITM-001"
                {...register('itemCodeText', {
                  // The ★ is enforced here, in plain words, instead of letting the
                  // server answer with "itemId or itemCodeText is required".
                  validate: (v) => isEdit || Boolean(v?.trim()) || 'Item Code is required.',
                })}
              />
            </FormField>

            <FormField label="Item Name" htmlFor="itemName" className="cl-span-2">
              {/* Rule: item code is the unique key — on-master name is derived +
                  read-only; off-master free text stays editable. */}
              <input
                id="itemName"
                className={itemLocked ? 'innovic-input is-derived' : 'innovic-input'}
                autoComplete="off"
                readOnly={itemLocked}
                title={
                  itemLocked ? 'Auto-filled from Item Master (item code is the key)' : undefined
                }
                {...register('itemName')}
              />
            </FormField>

            <FormField
              label={
                <>
                  PR Qty
                  {qtyUom ? (
                    <span className="mono" style={{ color: 'var(--text2)', marginLeft: 4 }}>
                      ({qtyUom})
                    </span>
                  ) : null}
                </>
              }
              required
              htmlFor="qty"
              error={errors.qty?.message}
            >
              {/* Decimal for KGS / MTR (3 places); a NOS / SET item stays whole —
                  the server refuses a fraction for it (0172). */}
              <input
                id="qty"
                type="number"
                min={0}
                step="any"
                className="innovic-input cl-num"
                {...register('qty', {
                  valueAsNumber: true,
                  validate: (v) => (Number.isFinite(v) && v > 0) || 'PR Qty must be more than 0.',
                })}
              />
            </FormField>
          </Cluster>

          <Cluster name="Request">
            <FormField label="PR Type" htmlFor="prType">
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

            <FormField label="PR Date" required htmlFor="prDate">
              <input
                id="prDate"
                type="date"
                className="innovic-input"
                {...register('prDate', { required: 'PR Date is required.' })}
              />
            </FormField>

            <FormField label="Due Date" htmlFor="requiredDate">
              <input
                id="requiredDate"
                type="date"
                className="innovic-input"
                {...register('requiredDate')}
              />
            </FormField>

            <FormField label="Operation" htmlFor="operation">
              <input
                id="operation"
                className="innovic-input"
                autoComplete="off"
                placeholder="COATING / TURN / …"
                {...register('operation')}
              />
            </FormField>
          </Cluster>

          {/* Vendor and the estimate read as one account: rate × qty = amount,
              ending on the result. Status is NOT a field, on create or edit: a
              new PR is always 'open', stamped by the server, and it advances
              only via Approve / Reject / Create PO. */}
          <Cluster name="Vendor">
            {/* The shared picker brings its own .form-grp; this cell gives it
                two of the cluster's four cells. */}
            <div className="cl-span-2">
              <PrVendorField
                form={form}
                carriedVendorText={carriedVendorText}
                initialLabel={vendorInitialLabel}
                onPickLabel={(label) => {
                  vendorLabelRef.current = label;
                }}
              />
            </div>

            <FormField label="Est. Rate (₹)" htmlFor="estCost">
              <input
                id="estCost"
                type="number"
                step="0.01"
                min={0}
                className="innovic-input cl-num"
                {...register('estCost', { valueAsNumber: true })}
              />
            </FormField>

            <FormField label="Est. Amount (₹)" htmlFor="estAmount" className="cl-lead">
              <input
                id="estAmount"
                className="innovic-input is-derived cl-num"
                readOnly
                tabIndex={-1}
                value={estAmount > 0 ? inr(estAmount) : '—'}
                title="PR Qty × Est. Rate"
              />
            </FormField>
          </Cluster>

          <Cluster name="Notes">
            <FormField label="Remarks" htmlFor="remarks" className="cl-span-4">
              <textarea
                id="remarks"
                className="innovic-textarea"
                rows={2}
                {...register('remarks')}
              />
            </FormField>
          </Cluster>
        </ClusterGrid>
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

const inr = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
