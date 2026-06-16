// Purchase Request form (UI-003-04) — single-row entity per ADR-015 #2.

import {
  type CreatePurchaseRequestInput,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequest,
  type UpdatePurchaseRequestInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useItemsList } from '@/modules/items/api';
import { useVendorsList } from '@/modules/vendors/api';

interface FormValues {
  code: string;
  prDate: string;
  status: PrStatus;
  vendorId?: string;
  vendorCodeText?: string;
  itemId?: string;
  itemCodeText?: string;
  itemName?: string;
  qty: number;
  estCost: number;
  requiredDate?: string;
  operation?: string;
  remarks?: string;
}

const DEFAULTS: FormValues = {
  code: '',
  prDate: new Date().toISOString().slice(0, 10),
  status: 'open',
  qty: 1,
  estCost: 0,
};

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

type EditMode = {
  mode: 'edit';
  detail: PurchaseRequest;
  onSubmit: (values: UpdatePurchaseRequestInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
};

export type PurchaseRequestFormProps = CreateMode | EditMode;

export function PurchaseRequestForm(props: PurchaseRequestFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit ? detailToFormValues(props.detail) : DEFAULTS;

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, handleSubmit, formState, setValue } = form;
  const errors = formState.errors;

  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const vendors = vendorsData?.vendors ?? [];

  // Item master drives the code autosuggest + name auto-fill. PR still accepts
  // off-master free text, so a non-matching code is left as-is.
  const { data: itemsData } = useItemsList({ limit: 1000, offset: 0 });
  const items = itemsData?.items ?? [];
  const itemsByCode = useMemo(() => {
    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) m.set(it.code.toUpperCase(), it);
    return m;
  }, [items]);

  const itemCodeReg = register('itemCodeText');
  const onItemCodeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    void itemCodeReg.onChange(e);
    const match = itemsByCode.get(e.target.value.trim().toUpperCase());
    if (match) {
      setValue('itemId', match.id, { shouldDirty: true });
      setValue('itemName', match.name, { shouldDirty: true });
    } else {
      setValue('itemId', undefined, { shouldDirty: true });
    }
  };

  const onValid = async (values: FormValues): Promise<void> => {
    const trimmedItemCode = values.itemCodeText?.trim();
    const itemRefs: { itemId?: string; itemCodeText?: string } = trimmedItemCode
      ? { itemCodeText: trimmedItemCode }
      : values.itemId
        ? { itemId: values.itemId }
        : {};

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
    };

    if (isEdit) {
      await props.onSubmit(payload);
    } else {
      await props.onSubmit({ code: values.code.trim(), ...payload } as CreatePurchaseRequestInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <div className="form-grid form-grid-3">
        <div className="form-grp">
          <label className="form-label" htmlFor="code">
            PR No.<span className="req">★</span>
          </label>
          <input
            id="code"
            className="innovic-input"
            autoFocus={!isEdit}
            autoComplete="off"
            readOnly={isEdit}
            {...register('code', { required: !isEdit ? 'PR No. is required' : false })}
          />
          {isEdit ? <div className="form-help">Code cannot be changed after creation.</div> : null}
          {errors.code?.message ? <div className="form-error">{errors.code.message}</div> : null}
        </div>
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
          <label className="form-label" htmlFor="status">
            Status
          </label>
          <select id="status" className="innovic-select" {...register('status')}>
            {PR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="vendorId">
            Vendor
          </label>
          <select id="vendorId" className="innovic-select" {...register('vendorId')}>
            <option value="">— Free-text vendor below —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} — {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="vendorCodeText">
            Vendor Code (fallback)
          </label>
          <input
            id="vendorCodeText"
            className="innovic-input"
            autoComplete="off"
            placeholder="Required if no vendor picked"
            {...register('vendorCodeText')}
          />
        </div>
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
          <label className="form-label" htmlFor="itemCodeText">
            Item Code
          </label>
          <input
            id="itemCodeText"
            className="innovic-input"
            list="dlPrItems"
            autoComplete="off"
            placeholder="🔍 ITM-001"
            {...itemCodeReg}
            onChange={onItemCodeChange}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="itemName">
            Item Name (snapshot)
          </label>
          <input
            id="itemName"
            className="innovic-input"
            autoComplete="off"
            {...register('itemName')}
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

      <datalist id="dlPrItems">
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
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create PR')}
          </button>
        </div>
      </div>
    </form>
  );
}

function detailToFormValues(detail: PurchaseRequest): FormValues {
  return {
    code: detail.code,
    prDate: detail.prDate,
    status: detail.status,
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
