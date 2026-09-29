// One PO line (the detail row + its remarks row underneath). Split out of
// `purchase-order-form.tsx`, which was 779 lines — well past the 400-line rule —
// and, more to the point, because the Item Code → Name cascade is a per-line
// hook: it cannot live inside the parent's `fields.map(...)`.
//
// Keyed by the field-array's own `field.id` upstream, so this component (and the
// cascade's memory of what it auto-filled) follows its line when rows above it
// are removed and the indexes shift.

import type { ListItemsResponse } from '@innovic/shared';
import { Fragment, useId } from 'react';
import type { Path, PathValue, UseFormReturn } from 'react-hook-form';
import { inrFormat } from '@/lib/print/doc-print';
import {
  type CascadeField,
  type CascadeFieldOptions,
  cascadeField,
  useFieldCascade,
} from '@/lib/use-field-cascade';
import { useItemCodeResolver, useItemCodeSearch } from '@/modules/items/use-item-code-search';
import type { PoFormValues, PoLineFormValue } from './po-form-values';

export type PoItemMaster = ListItemsResponse['items'][number];

/** `cascadeField` with this form and this source record pinned, so each dependent
 *  below reads as just "path, where it comes from, what empty means". */
function poField<TName extends Path<PoFormValues>>(
  name: TName,
  from: (item: PoItemMaster) => PathValue<PoFormValues, TName>,
  empty: PathValue<PoFormValues, TName>,
  options?: CascadeFieldOptions,
): CascadeField<PoFormValues, PoItemMaster> {
  return cascadeField<PoFormValues, PoItemMaster, TName>(name, from, empty, options);
}

export interface PoLineRowProps {
  form: UseFormReturn<PoFormValues>;
  idx: number;
  /** This line's live values (the parent already watches `lines` for totals). */
  line: PoLineFormValue | undefined;
  isEdit: boolean;
  receivedQty: number | undefined;
  /** Columns the remarks row spans, so it lines up under the detail row. */
  remarksSpan: number;
  rowBg: string;
  onRemove: () => void;
}

export function PoLineRow({
  form,
  idx,
  line,
  isEdit,
  receivedQty,
  remarksSpan,
  rowBg,
  onRemove,
}: PoLineRowProps): React.JSX.Element {
  const { register, formState } = form;
  const codeText = line?.itemCodeText ?? '';
  // The Item Master is searched on the SERVER with the typed code (it used to be
  // one preloaded page, so later items could not be suggested or auto-filled).
  // excludePartyOwned (ADR-195): a customer's own -rm material is never purchased.
  const { items: codeSuggestions, match: matchedItem } = useItemCodeSearch(codeText, {
    excludePartyOwned: true,
  });
  const resolveItemCode = useItemCodeResolver({ excludePartyOwned: true });
  const itemDatalistId = useId();
  const lineAmt = (Number(line?.qty) || 0) * (Number(line?.rate) || 0);
  const nameError = formState.errors.lines?.[idx]?.itemName?.message;

  // Item Code is the controller; Item Id + Item Name are its dependents.
  //
  // Name is `userEditable`: a PO may be raised for an off-master part, and the
  // name the user typed for such a part is theirs to keep. So it is replaced
  // whenever the code matches a master item, but on a miss it is only cleared
  // while it still holds exactly what we auto-filled — which is what stops a
  // stale name from sitting under a code that no longer matches.
  //
  // Id is not: nothing but a master match can ever put a value there, so a miss
  // always clears it (as the old inline handler did).
  useFieldCascade<PoFormValues, PoItemMaster>({
    form,
    value: codeText,
    resolve: resolveItemCode,
    fields: [
      poField(`lines.${idx}.itemId`, (it) => it.id, undefined),
      poField(`lines.${idx}.itemName`, (it) => it.name, '', { userEditable: true }),
    ],
    // Never auto-written, whatever the code does.
    userEntered: [
      `lines.${idx}.qty`,
      `lines.${idx}.rate`,
      `lines.${idx}.dueDate`,
      `lines.${idx}.lineRemarks`,
    ],
  });

  return (
    <Fragment>
      <tr style={{ background: rowBg }}>
        <td className="mono fw-700 cyan" style={{ width: 32 }} rowSpan={2}>
          {idx + 1}
        </td>
        <td style={{ minWidth: 140 }}>
          <input
            className="innovic-input"
            list={itemDatalistId}
            autoComplete="off"
            placeholder="🔍 Item code…"
            {...register(`lines.${idx}.itemCodeText` as const)}
          />
          <datalist id={itemDatalistId}>
            {codeSuggestions.map((it) => (
              <option key={it.id} value={it.code}>
                {it.code} — {it.name}
                {it.material ? ` [${it.material}]` : ''}
              </option>
            ))}
          </datalist>
        </td>
        {/* Rule: item code is the unique key. When the code is on
            the Item Master the name is derived + read-only; PO still
            accepts off-master free text, so the name stays editable
            only when there is no master match. */}
        <td style={{ minWidth: 90 }}>
          <input
            className="innovic-input"
            autoComplete="off"
            readOnly={Boolean(matchedItem)}
            title={matchedItem ? 'Auto-filled from Item Master (item code is the key)' : undefined}
            style={matchedItem ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined}
            {...register(`lines.${idx}.itemName` as const, {
              required: 'Item name is required',
            })}
          />
          {nameError ? <div className="form-error">{nameError}</div> : null}
        </td>
        <td className="text3" style={{ minWidth: 50, fontSize: 11 }}>
          {matchedItem?.material ?? ''}
        </td>
        <td style={{ width: 80 }}>
          <input
            type="number"
            min={1}
            className="innovic-input"
            style={{ fontWeight: 800, color: 'var(--cyan)' }}
            placeholder="Qty ★"
            {...register(`lines.${idx}.qty` as const, {
              valueAsNumber: true,
              min: { value: 1, message: 'Min 1' },
            })}
          />
        </td>
        <td style={{ width: 90 }}>
          <input
            type="number"
            step="0.01"
            min={0}
            className="innovic-input"
            placeholder="₹ Rate"
            {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
          />
        </td>
        <td style={{ width: 85 }}>
          <span
            className={lineAmt > 0 ? 'mono fw-700 green' : 'mono fw-700 text3'}
            style={{ fontSize: 13 }}
          >
            {lineAmt > 0 ? `₹${inrFormat(lineAmt)}` : '—'}
          </span>
        </td>
        <td style={{ width: 85 }}>
          <input
            type="date"
            className="innovic-input"
            {...register(`lines.${idx}.dueDate` as const)}
          />
        </td>
        {isEdit ? (
          <td style={{ width: 80 }}>
            <input
              type="number"
              className="innovic-input"
              readOnly
              title="Received changes only when a GRN is saved"
              value={receivedQty ?? 0}
            />
          </td>
        ) : null}
        <td style={{ width: 28 }} rowSpan={2}>
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon"
            onClick={onRemove}
            title="Remove"
            aria-label={`Remove line ${idx + 1}`}
          >
            ×
          </button>
        </td>
      </tr>
      <tr style={{ background: rowBg }}>
        <td colSpan={remarksSpan} style={{ padding: '0 6px 6px' }}>
          <input
            className="innovic-input"
            autoComplete="off"
            placeholder="Remarks for this line…"
            {...register(`lines.${idx}.lineRemarks` as const)}
          />
        </td>
      </tr>
    </Fragment>
  );
}
