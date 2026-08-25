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

import {
  type CreatePurchaseRequestInput,
  type ListItemsResponse,
  PR_STATUSES,
  PR_TYPES,
  type PurchaseRequest,
  type PurchaseRequestDetail,
  type UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type Path, type PathValue, useForm } from 'react-hook-form';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSalesOrder, useSalesOrdersList } from '@/modules/sales-orders/api';
import {
  type CascadeField,
  type CascadeFieldOptions,
  cascadeField,
  useFieldCascade,
} from '@/lib/use-field-cascade';
import { useItemsList } from '@/modules/items/api';
import {
  PR_FORM_DEFAULTS,
  PR_ITEM_DATALIST_ID,
  PR_USER_ENTERED_FIELDS,
  type PrFormValues,
} from './pr-form-values';
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

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
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
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : PR_FORM_DEFAULTS;

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errors = formState.errors;

  // SO No. — the PR stores an SO LINE (purchase_requests.source_so_line_id
  // references sales_order_lines), so picking the order is only half of it. The
  // Line box appears once an SO is chosen and is what actually gets saved; on an
  // order with a single line it is picked automatically, so the usual case is
  // still one field. An edit form starts with the SO id unknown (the detail
  // carries soCode/soLineNo, not the header id), so the picker shows the stored
  // code via `valueLabel` until the user opens it.
  const [soId, setSoId] = useState<string | null>(null);
  const [soSearch, setSoSearch] = useState('');
  const soList = useSalesOrdersList({
    ...(soSearch.trim() ? { search: soSearch.trim() } : {}),
    limit: 20,
    offset: 0,
  });
  const soDetail = useSalesOrder(soId ?? undefined);
  const soLines = soDetail.data?.lines ?? [];
  // An order with exactly one line picks that line itself, so the usual case
  // stays a single "SO No." box and the Line select is only a decision when the
  // order genuinely has more than one.
  const soLineId = watch('sourceSoLineId');
  useEffect(() => {
    if (soLines.length === 1 && !soLineId) setValue('sourceSoLineId', soLines[0]!.id);
  }, [soLines, soLineId, setValue]);

  const storedSoLabel = isEdit
    ? [props.detail.soCode, props.detail.soLineNo ? `Ln ${props.detail.soLineNo}` : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  // Free text already stored on this PR. Its presence is what lets the vendor
  // picker be left empty — see the rule in <PrVendorField>.
  const carriedVendorText = isEdit ? (props.detail.vendorCodeText?.trim() ?? '') : '';
  const vendorInitialLabel = isEdit ? joinVendorLabel(props.detail) : '';

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
      status: values.status,
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
      ...(values.sourceSoLineId ? { sourceSoLineId: values.sourceSoLineId } : {}),
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
      await props.onSubmit({
        prType: values.prType,
        ...payload,
      } as CreatePurchaseRequestInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid-4">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            PR No.
          </label>
          {/* System-generated, never typed. The server allocates the next
              IN-PR-##### on save. This was a free text box that only defaulted
              to auto when left blank, which is how PRs ended up numbered
              "001" / "002" / "009" instead of following the series. */}
          <input
            id="code"
            className="innovic-input"
            readOnly
            tabIndex={-1}
            style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            value={isEdit ? (watch('code') ?? '') : 'Auto-generated on save'}
            onChange={() => undefined}
          />
          <div className="form-help">
            {isEdit
              ? 'PR No. cannot be changed after creation.'
              : 'Allocated by the system — the next IN-PR-##### in the series.'}
          </div>
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="pr-so">
            SO No.
          </label>
          <SearchableSelect
            id="pr-so"
            value={soId}
            valueLabel={storedSoLabel || undefined}
            onChange={(id) => {
              setSoId(id);
              // Clear any line held from the previously chosen order.
              setValue('sourceSoLineId', undefined);
            }}
            onSearch={setSoSearch}
            loading={soList.isFetching}
            placeholder="🔍 Select SO — number or customer…"
            options={(soList.data?.items ?? []).map((o) => ({
              id: o.id,
              code: o.code,
              name: o.customerName ?? '',
            }))}
          />
          <div className="form-help">
            Optional — links this PR to the order it was raised for.
          </div>
        </div>

        {soId ? (
          <div className="form-grp">
            <label className="form-label" htmlFor="pr-so-line">
              SO Line<span className="req">★</span>
            </label>
            {/* The PR links to an SO LINE, not the header, so the order alone is
                not enough to save. A single-line order picks itself. */}
            <select
              id="pr-so-line"
              className="innovic-select"
              disabled={soDetail.isFetching}
              value={watch('sourceSoLineId') ?? ''}
              onChange={(e) => setValue('sourceSoLineId', e.target.value || undefined)}
            >
              <option value="">
                {soDetail.isFetching
                  ? 'Loading lines…'
                  : soLines.length === 0
                    ? 'No lines on this SO'
                    : 'Select a line…'}
              </option>
              {soLines.map((l) => (
                <option key={l.id} value={l.id}>
                  Ln {l.lineNo} · {l.partName} · Qty {l.orderQty}
                </option>
              ))}
            </select>
            <div className="form-help">Which line of the order this PR is for.</div>
          </div>
        ) : null}
        <div className="form-grp">
          <label className="form-label" htmlFor="prDate">
            Date<span className="req">★</span>
          </label>
          <input
            id="prDate"
            type="date"
            className="innovic-input"
            {...register('prDate', { required: 'Date is required' })}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="operation">
            Operation
          </label>
          <input
            id="operation"
            className="innovic-input"
            autoComplete="off"
            placeholder="COATING / TURN / …"
            {...register('operation')}
          />
        </div>
        <PrVendorField
          form={form}
          carriedVendorText={carriedVendorText}
          initialLabel={vendorInitialLabel}
        />
        <div className="form-grp">
          <label className="form-label" htmlFor="requiredDate">
            Required Date
          </label>
          <input
            id="requiredDate"
            type="date"
            className="innovic-input"
            {...register('requiredDate')}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="status">
            Status
          </label>
          {/* Status is immutable on edit — it only advances via the Approve /
              Reject / Create-PO actions, never a free dropdown. Editable on
              create (initial state) only. */}
          <select
            id="status"
            className="innovic-select"
            disabled={isEdit}
            style={isEdit ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined}
            {...register('status')}
          >
            {PR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {isEdit ? (
            <div className="form-help">
              Status changes via Approve / Reject / Create PO — not here.
            </div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="prType">
            PR Type
          </label>
          {/* What this PR is FOR, and therefore what the PO it becomes can do:
              standard ends in a GRN (goods in), service sends the item out on a
              DC and receives it back (the job-work chain). 'jw_osp' is NOT
              offered — the system stamps that itself when an outsource JC op
              raises the PR, and hand-picking it would fake an OSP job with no
              operation behind it.

              Immutable after create: `updatePurchaseRequestInputSchema` omits
              prType, so on edit this shows the stored value read-only rather
              than a dropdown that silently would not save. */}
          {isEdit ? (
            <input
              id="prType"
              className="innovic-input"
              readOnly
              title="PR type is fixed when the PR is created"
              style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
              value={(watch('prType') ?? 'standard').replaceAll('_', ' ')}
            />
          ) : (
            <select id="prType" className="innovic-select" {...register('prType')}>
              {PR_TYPES.filter((t) => t === 'standard' || t === 'service').map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          )}
          {isEdit ? (
            <div className="form-help">PR type is fixed at creation.</div>
          ) : (
            <div className="form-help">
              Service = buying work (calibration, heat-treat, plating). Its PO sends
              the item out on a DC instead of receiving stock in.
            </div>
          )}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="itemCodeText">
            Item Code
            {isEdit ? null : <span className="req">★</span>}
          </label>
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
        </div>
        <div className="form-grp form-span-2">
          <label className="form-label" htmlFor="itemName">
            Item Name (snapshot)
          </label>
          {/* Rule: item code is the unique key — on-master name is derived +
              read-only; off-master free text stays editable. */}
          <input
            id="itemName"
            className="innovic-input"
            autoComplete="off"
            readOnly={Boolean(watch('itemId'))}
            title={
              watch('itemId') ? 'Auto-filled from Item Master (item code is the key)' : undefined
            }
            style={watch('itemId') ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined}
            {...register('itemName')}
          />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="qty">
            Qty<span className="req">★</span>
          </label>
          <input
            id="qty"
            type="number"
            min={1}
            className="innovic-input"
            {...register('qty', {
              valueAsNumber: true,
              min: { value: 1, message: 'Min 1' },
            })}
          />
          {errors.qty?.message ? <div className="form-error">{errors.qty.message}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="estCost">
            Estimated Cost (₹)
          </label>
          <input
            id="estCost"
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            {...register('estCost', { valueAsNumber: true })}
          />
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">
            Remarks
          </label>
          <textarea
            id="remarks"
            className="innovic-textarea"
            rows={3}
            {...register('remarks')}
          />
        </div>
      </div>

      <datalist id={PR_ITEM_DATALIST_ID}>
        {items.map((it) => (
          <option key={it.id} value={it.code}>
            {it.name}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? (
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="btn btn-success" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}✓{' '}
            {props.submitLabel ?? (isEdit ? 'Save PR' : 'Create PR')}
          </button>
        </div>
      </div>
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
    ...(detail.sourceSoLineId ? { sourceSoLineId: detail.sourceSoLineId } : {}),
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
