// ONE PO line on the redesigned form — three table rows:
//   1. SR NO. · PR NO. · ITEM CODE · NAME · QTY · RATE · AMOUNT · DUE DATE · ✕
//   2. RAM REMARK  (full width)
//   3. REMARKS     (full width) + the "+ Add Line" button at its right end
//
// Split out of `po-form.tsx` because the PR → line auto-fill is a PER-LINE data
// fetch: `usePurchaseRequest` cannot be called inside the parent's
// `fields.map(...)`. Keyed upstream by the field-array's own id, so a row (and
// this component's memory of what it auto-filled) follows its line when a row
// above it is removed and the indexes shift.
//
// Auto-fill rule: picking a PR fills item code / name / qty / rate / due date,
// but ONLY where the user has not typed something of their own — a value that
// is still exactly what a previous PR put there is fair game, so swapping the
// PR on a line refills it. Every field stays editable afterwards; that is what
// "carried from PR — editable" in the band promises.

import type { ListItemsResponse } from '@innovic/shared';
import type { PurchaseRequestDetail } from '@innovic/shared';
import { Fragment, useEffect, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { inrFormat } from '@/lib/print/doc-print';
import { usePurchaseRequest } from '@/modules/purchase-requests/api';
import { PO_FORM_ITEM_DATALIST_ID, type PoFormLineValue, type PoFormValues } from './po-form-types';
import { PrPicker } from './pr-picker';

export type PoItemMasterRow = ListItemsResponse['items'][number];

/** What a PR put into this line last time, so we can tell "still the PR's
 *  value" (overwrite freely) from "the user typed this" (leave alone). */
interface AppliedFromPr {
  prId: string;
  itemCodeText: string;
  itemName: string;
  qty: number;
  rate: number;
  dueDate: string;
}

export interface PoFormLineProps {
  form: UseFormReturn<PoFormValues>;
  idx: number;
  /** This line's live values (the parent already watches `lines` for totals). */
  line: PoFormLineValue | undefined;
  isEdit: boolean;
  /** Total columns in the table, so rows 2 and 3 span the full width. */
  colCount: number;
  /** PR ids used on the OTHER lines — never offered in this row's picker. */
  excludePrIds: string[];
  /** The header's vendor. When set, the picker offers only that vendor's PRs
   *  (plus the vendor-less OSP ones) — the PR's vendor is what ties it here. */
  headerVendorId: string | null;
  /** Item Master indexed by UPPERCASE code. */
  itemsByCode: Map<string, PoItemMasterRow>;
  /** Reports the loaded PR up, so the form can seed Vendor + PO Remarks. */
  onPrLoaded: (pr: PurchaseRequestDetail) => void;
  onRemove: () => void;
  onAddLine: () => void;
  canRemove: boolean;
}

export function PoFormLine({
  form,
  idx,
  line,
  isEdit,
  colCount,
  excludePrIds,
  headerVendorId,
  itemsByCode,
  onPrLoaded,
  onRemove,
  onAddLine,
  canRemove,
}: PoFormLineProps): React.JSX.Element {
  const { register, setValue, getValues } = form;
  const prId = line?.sourcePrId;
  const { data: pr } = usePurchaseRequest(prId);

  const applied = useRef<AppliedFromPr | null>(null);

  useEffect(() => {
    if (!prId) {
      // PR cleared — forget what it filled, so re-picking it fills again.
      applied.current = null;
      return;
    }
    if (!pr || pr.id !== prId) return;
    if (applied.current?.prId === prId) return;

    const prev = applied.current;
    const cur = getValues(`lines.${idx}`);
    const code = pr.itemCode ?? pr.itemCodeText ?? '';
    const name = pr.itemName ?? '';
    const qty = pr.qty;
    const rate = Number(pr.estCost ?? 0);
    const due = pr.requiredDate ?? '';

    if (code && (!cur.itemCodeText.trim() || cur.itemCodeText === prev?.itemCodeText)) {
      setValue(`lines.${idx}.itemCodeText`, code, { shouldDirty: true });
    }
    if (name && (!cur.itemName.trim() || cur.itemName === prev?.itemName)) {
      setValue(`lines.${idx}.itemName`, name, { shouldDirty: true });
    }
    if (qty > 0 && (!(Number(cur.qty) > 0) || Number(cur.qty) === prev?.qty)) {
      setValue(`lines.${idx}.qty`, qty, { shouldDirty: true });
    }
    if (rate > 0 && (!(Number(cur.rate) > 0) || Number(cur.rate) === prev?.rate)) {
      setValue(`lines.${idx}.rate`, rate, { shouldDirty: true });
    }
    if (due && (!cur.dueDate || cur.dueDate === prev?.dueDate)) {
      setValue(`lines.${idx}.dueDate`, due, { shouldDirty: true });
    }
    setValue(`lines.${idx}.sourcePrCode`, pr.code);

    applied.current = { prId, itemCodeText: code, itemName: name, qty, rate, dueDate: due };
    onPrLoaded(pr);
  }, [pr, prId, idx, getValues, setValue, onPrLoaded]);

  // Item Master courtesy fill for a HAND-added line: a code that matches the
  // master names itself. Only when the name box is still empty — a PO may be
  // raised for an off-master part, and a name the user typed is theirs to keep.
  const codeText = line?.itemCodeText ?? '';
  const matched = itemsByCode.get(codeText.trim().toUpperCase());
  const matchedName = matched?.name;
  useEffect(() => {
    if (!matchedName) return;
    if (getValues(`lines.${idx}.itemName`).trim() === '') {
      setValue(`lines.${idx}.itemName`, matchedName, { shouldDirty: true });
    }
  }, [matchedName, idx, getValues, setValue]);

  const amount = (Number(line?.qty) || 0) * (Number(line?.rate) || 0);
  // An edit-mode line that already carries a PR shows it as a read-only code:
  // that PR is `po_created` and so is (rightly) not in the picker's list.
  const lockedPrCode = isEdit && line?.sourcePrId ? (line.sourcePrCode ?? '— linked —') : null;

  return (
    <Fragment>
      <tr className="pof-r-top">
        <td className="pof-sr">{idx + 1}</td>
        <td style={{ width: 128 }}>
          {lockedPrCode ? (
            <span className="pof-prcode" title={lockedPrCode}>
              {lockedPrCode}
            </span>
          ) : (
            <PrPicker
              // Remounted when the line's PR code becomes known, so a PR that
              // arrived by URL (`?prId=`) — and may not be on the picker's
              // first page of options — still shows its code instead of an
              // empty "Select …".
              key={line?.sourcePrCode ?? 'unset'}
              id={`pof-pr-${idx}`}
              className=""
              showLabel={false}
              codeOnly
              placeholder="Select …"
              value={line?.sourcePrId ?? null}
              initialLabel={line?.sourcePrCode ?? ''}
              excludeIds={excludePrIds}
              vendorId={headerVendorId}
              onChange={(id) => {
                setValue(`lines.${idx}.sourcePrId`, id ?? undefined, { shouldDirty: true });
                if (!id) setValue(`lines.${idx}.sourcePrCode`, undefined);
              }}
            />
          )}
        </td>
        <td style={{ width: 168 }}>
          <input
            className="pof-in pof-in-sm pof-num"
            list={PO_FORM_ITEM_DATALIST_ID}
            autoComplete="off"
            placeholder="Item code…"
            aria-label={`Item code, line ${idx + 1}`}
            {...register(`lines.${idx}.itemCodeText` as const)}
          />
        </td>
        <td style={{ minWidth: 200 }}>
          <input
            className="pof-in pof-in-sm"
            autoComplete="off"
            placeholder="Name…"
            aria-label={`Item name, line ${idx + 1}`}
            {...register(`lines.${idx}.itemName` as const)}
          />
        </td>
        <td style={{ width: 92 }}>
          <input
            type="number"
            min={0}
            className="pof-in pof-in-sm pof-num"
            aria-label={`Qty, line ${idx + 1}`}
            {...register(`lines.${idx}.qty` as const, { valueAsNumber: true })}
          />
        </td>
        <td style={{ width: 108 }}>
          <input
            type="number"
            step="0.01"
            min={0}
            className="pof-in pof-in-sm pof-num"
            aria-label={`Rate, line ${idx + 1}`}
            {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
          />
        </td>
        <td style={{ width: 118 }}>
          {/* Derived, never typed — qty × rate. */}
          <div className="pof-amt" title="Qty × Rate">
            ₹{inrFormat(amount)}
          </div>
        </td>
        <td style={{ width: 138 }}>
          <input
            type="date"
            className="pof-in pof-in-sm pof-num"
            aria-label={`Due date, line ${idx + 1}`}
            {...register(`lines.${idx}.dueDate` as const)}
          />
        </td>
        {isEdit ? (
          <td style={{ width: 92 }}>
            <input
              className="pof-in pof-in-sm pof-num"
              readOnly
              title="Received qty moves only with a GRN, never a plain edit"
              aria-label={`Received, line ${idx + 1}`}
              value={line?.receivedQty ?? 0}
            />
          </td>
        ) : null}
        <td style={{ width: 48 }}>
          <button
            type="button"
            className="pof-x"
            onClick={onRemove}
            disabled={!canRemove}
            title={canRemove ? 'Remove this line' : 'A PO needs at least one line'}
            aria-label={`Remove line ${idx + 1}`}
          >
            ✕
          </button>
        </td>
      </tr>

      <tr>
        <td className="pof-sub-l" colSpan={2}>
          Ram Remark
        </td>
        <td colSpan={colCount - 2}>
          <input
            className="pof-in pof-in-sm"
            autoComplete="off"
            placeholder="RAM remark…"
            aria-label={`RAM remark, line ${idx + 1}`}
            {...register(`lines.${idx}.ramRemark` as const)}
          />
        </td>
      </tr>

      <tr className="pof-r-end">
        <td className="pof-sub-l" colSpan={2}>
          Remarks
        </td>
        <td colSpan={colCount - 3}>
          <input
            className="pof-in pof-in-sm"
            autoComplete="off"
            placeholder="Remarks for this line…"
            aria-label={`Remarks, line ${idx + 1}`}
            {...register(`lines.${idx}.lineRemarks` as const)}
          />
        </td>
        <td style={{ textAlign: 'right' }}>
          <button type="button" className="pof-add" onClick={onAddLine}>
            + Add Line
          </button>
        </td>
      </tr>
    </Fragment>
  );
}
