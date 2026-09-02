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
// Auto-fill rule: the line's PR is the CONTROLLER; item code / name / qty / rate
// / due date (and the display-only PR code) are its DEPENDENTS. Swapping PR-1
// for PR-2 refreshes every dependent PR-1 auto-filled — none of PR-1's values
// may be left stranded under PR-2's code — while anything the buyer typed over
// the top is theirs and survives. That "ours vs theirs" bookkeeping, and the
// race guard for a slow PR fetch landing after a newer pick, is the shared
// `useFieldCascade`; this file only declares the mapping. Every field stays
// editable afterwards; that is what "carried from PR — editable" promises.
//
// Clearing the PR is deliberately NOT a reset: it unlinks the line (sourcePrId +
// sourcePrCode) and leaves the item fields where they are, so the buyer can keep
// the row as a hand-entered one. The footer stops counting it toward "at least
// one line has a PR" the moment sourcePrId goes.
//
// The PR control is DISABLED until the header names a vendor. A PR belongs to a
// vendor, so with none named there is no honest list to offer — the reason sits
// in the note row under the line and in the control's own placeholder.
//
// A SECOND chain lives on this row: item code → item name from the Item Master,
// which re-evaluates (and resets) when the code changes or is cleared.

import type { ListItemsResponse } from '@innovic/shared';
import type { PurchaseRequestDetail } from '@innovic/shared';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { Path, PathValue, SetValueConfig, UseFormReturn } from 'react-hook-form';
import { inrFormat } from '@/lib/print/doc-print';
import {
  type CascadeField,
  type CascadeFieldOptions,
  cascadeField,
  useFieldCascade,
} from '@/lib/use-field-cascade';
import { usePurchaseRequest } from '@/modules/purchase-requests/api';
import { PO_FORM_ITEM_DATALIST_ID, type PoFormLineValue, type PoFormValues } from './po-form-types';
import {
  PICK_VENDOR_FIRST_PLACEHOLDER,
  PICK_VENDOR_FIRST_TIP,
  noOpenPrsMessage,
  PrPicker,
} from './pr-picker';

export type PoItemMasterRow = ListItemsResponse['items'][number];

/** What a PR fill writes with. Dirty (it changes what would be saved) but NOT
 *  validating: this form blocks from its own watched values in the footer, and
 *  firing RHF validation from an auto-fill would flash errors on untouched rows. */
const PR_FILL_OPTIONS: SetValueConfig = { shouldDirty: true };

/** `cascadeField` with this form and an Item Master row pinned. */
function itemField<TName extends Path<PoFormValues>>(
  name: TName,
  from: (it: PoItemMasterRow) => PathValue<PoFormValues, TName>,
  empty: PathValue<PoFormValues, TName>,
  options?: CascadeFieldOptions,
): CascadeField<PoFormValues, PoItemMasterRow> {
  return cascadeField<PoFormValues, PoItemMasterRow, TName>(name, from, empty, options);
}

/** `cascadeField` with this form and the PR record pinned, so each dependent
 *  below reads as just "path, where it comes from, what empty means". */
function prField<TName extends Path<PoFormValues>>(
  name: TName,
  from: (pr: PurchaseRequestDetail) => PathValue<PoFormValues, TName>,
  empty: PathValue<PoFormValues, TName>,
  options?: CascadeFieldOptions,
): CascadeField<PoFormValues, PurchaseRequestDetail> {
  return cascadeField<PoFormValues, PurchaseRequestDetail, TName>(name, from, empty, options);
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
   *  (plus the vendor-less OSP ones) — the PR's vendor is what ties it here.
   *  Changing it re-queries this line's picker; a line whose PR belongs to the
   *  OLD vendor is named in the footer rather than silently wiped. */
  headerVendorId: string | null;
  /** That vendor's name, for the "no open PRs for <vendor>" note. Display only. */
  vendorName: string;
  /** True for the ONE line that carries the shared PR hints, so a vendor with no
   *  open PRs says so once instead of once per row. */
  showPrHints: boolean;
  /** Item Master indexed by UPPERCASE code. */
  itemsByCode: Map<string, PoItemMasterRow>;
  /** False until that list has actually arrived — an empty map must not read as
   *  "this code is off-master" and reset the names. */
  itemsLoaded: boolean;
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
  vendorName,
  showPrHints,
  itemsByCode,
  itemsLoaded,
  onPrLoaded,
  onRemove,
  onAddLine,
  canRemove,
}: PoFormLineProps): React.JSX.Element {
  const { register, setValue, getValues } = form;
  const prId = line?.sourcePrId;
  const { data: pr } = usePurchaseRequest(prId);

  // ── Second chain on this row: ITEM CODE (controller) → ITEM NAME (dependent).
  //
  // Was a one-way courtesy fill that only ever wrote, and only into an empty box.
  // So editing a code that used to match the master left the OLD master's name
  // sitting under a code it no longer belongs to — the half-a-reset bug the
  // shared cascade exists to kill. Now a match refills the name and a miss resets
  // it, with the same "is this still ours?" test: a name the buyer typed for an
  // off-master part is theirs and survives, because a PO may legitimately be
  // raised for something the Item Master has never heard of.
  const codeText = line?.itemCodeText ?? '';
  const matched = itemsByCode.get(codeText.trim().toUpperCase());
  const matchedName = matched?.name;
  useFieldCascade<PoFormValues, PoItemMasterRow>({
    form,
    value: codeText,
    // Inert until the master list has actually arrived, or an empty map would
    // read as "no such code" and reset every name on the form.
    enabled: itemsLoaded,
    resolve: (code) => itemsByCode.get(code.trim().toUpperCase()) ?? null,
    // Name only. `itemId` is deliberately NOT a dependent here: the save path
    // sends the code TEXT whenever there is any and the API resolves it back to
    // the master itself, so writing an id would change what goes over the wire
    // for no gain. `userEditable` (not `keepUserEdits`): the code is this
    // system's unique key and the name is derived from it, so a match refills the
    // name — but a MISS only clears it while it is still what we auto-filled, so
    // the name the buyer typed for an off-master part is never wiped.
    fields: [itemField(`lines.${idx}.itemName`, (it) => it.name, '', { userEditable: true })],
    userEntered: [
      `lines.${idx}.itemId`,
      `lines.${idx}.qty`,
      `lines.${idx}.rate`,
      `lines.${idx}.dueDate`,
      `lines.${idx}.ramRemark`,
      `lines.${idx}.lineRemarks`,
    ],
    setValueOptions: PR_FILL_OPTIONS,
  });

  // An EDIT-mode line that arrived from the server already carrying a PR holds
  // the document's own history: the saved item / qty / rate may deliberately
  // differ from the PR's and are not ours to refresh. Every other case — a blank
  // line, or a create-mode line opened from `?prId=` — fills from the first PR it
  // sees. Read once, at mount, so the flag cannot flip mid-life.
  const arrivedWithPr = useRef(Boolean(prId)).current;

  // PR (controller) → item code · name · qty · rate · due date
  // (dependents). `keepUserEdits` is what makes a SWAP behave: each dependent is
  // rewritten while it is still empty or still holds exactly what the PREVIOUS PR
  // put there, and skipped once the buyer has typed a value of their own. That is
  // what stops PR-1's numbers being stranded on a line now showing PR-2.
  useFieldCascade<PoFormValues, PurchaseRequestDetail>({
    form,
    value: prId,
    // Inert until THIS line's PR detail has arrived (so a half-loaded record can
    // never fill the row), and inert again the moment the PR is cleared — the
    // picker's onChange unlinks the line and the item fields deliberately stay
    // put, so the buyer can keep it as a hand-entered line.
    enabled: Boolean(prId) && pr?.id === prId,
    resolve: () => (pr && pr.id === prId ? pr : null),
    fields: [
      prField(`lines.${idx}.itemCodeText`, (p) => p.itemCode ?? p.itemCodeText ?? '', '', {
        keepUserEdits: true,
      }),
      prField(`lines.${idx}.itemName`, (p) => p.itemName ?? '', '', {
        keepUserEdits: true,
        // A name the Item Master courtesy-filled under the OUTGOING code was not
        // hand-written either, so it counts as ours to refresh.
        isEmpty: (v) => typeof v !== 'string' || v.trim() === '' || v === matchedName,
      }),
      prField(`lines.${idx}.qty`, (p) => p.qty, 0, { keepUserEdits: true }),
      prField(`lines.${idx}.rate`, (p) => Number(p.estCost ?? 0), 0, { keepUserEdits: true }),
      prField(`lines.${idx}.dueDate`, (p) => p.requiredDate ?? undefined, undefined, {
        keepUserEdits: true,
      }),
    ],
    // Never PR-written, whatever the picker does: the two remark boxes are the
    // buyer's own words, and itemId / receivedQty move only via the Item Master
    // match and the GRN cascade respectively.
    userEntered: [
      `lines.${idx}.itemId`,
      `lines.${idx}.receivedQty`,
      `lines.${idx}.ramRemark`,
      `lines.${idx}.lineRemarks`,
    ],
    runOnMount: !(isEdit && arrivedWithPr),
    setValueOptions: PR_FILL_OPTIONS,
  });

  // `sourcePrCode` is NOT a cascade dependent: it is a pure mirror of whichever
  // PR the line points at (the PR NO. cell, and the codes the header joins into
  // its audit ref). Nobody types it, so it is simply kept equal to the loaded
  // PR's code — including after a clear-and-re-pick of the SAME PR, which the
  // cascade's "controller has not changed" guard would rightly skip.
  //
  // The same effect reports the PR upward: the header seeds Vendor + PO Remarks
  // from the first one, and the footer needs every PR it has seen to name a line
  // whose PR belongs to a vendor the header no longer holds.
  const reportedPrId = useRef<string | null>(null);
  useEffect(() => {
    if (!pr || pr.id !== prId) return;
    if (getValues(`lines.${idx}.sourcePrCode`) !== pr.code) {
      setValue(`lines.${idx}.sourcePrCode`, pr.code, PR_FILL_OPTIONS);
    }
    if (reportedPrId.current === pr.id) return;
    reportedPrId.current = pr.id;
    onPrLoaded(pr);
  }, [pr, prId, idx, getValues, setValue, onPrLoaded]);

  // Whether THIS line's picker has settled on "this vendor has nothing to offer".
  // Reported up from the picker, which owns the query. Reset by the remount that
  // a vendor change forces, and gated below on a vendor being set at all, so it
  // can never survive the vendor it described.
  const [noPrsForVendor, setNoPrsForVendor] = useState(false);

  // The PR picker is remounted when this line's PR code first becomes KNOWN, so a
  // PR that arrived by URL (`?prId=`) shows its code rather than "Select …". It is
  // deliberately NOT remounted when the code is CLEARED: <SearchableSelect> drops
  // the selection on the first keystroke, so a remount there threw away the search
  // the buyer was halfway through typing — which made swapping one PR for another
  // by typing impossible. Hence a ratchet: it only ever takes a real code.
  const prCodeKey = useRef('unset');
  if (line?.sourcePrCode) prCodeKey.current = line.sourcePrCode;

  const amount = (Number(line?.qty) || 0) * (Number(line?.rate) || 0);
  // An edit-mode line that already carries a PR shows it as a read-only code:
  // that PR is `po_created` and so is (rightly) not in the picker's list.
  const lockedPrCode = isEdit && line?.sourcePrId ? (line.sourcePrCode ?? '— linked —') : null;

  // The PR box is DISABLED until the header names a vendor — the rule is a block,
  // not a hint. An edit-mode line that is already linked keeps showing its locked
  // code chip either way: that link is history, not something the vendor field
  // gets to take away.
  const prDisabled = !headerVendorId;

  // ONE note slot per line: amber for "do this first" (the reason the control is
  // greyed out), blue for "there is nothing here to pick". Never both — the second
  // only exists once a vendor is set, which is exactly when the first stops. Both
  // are statements of the current state, so neither is dismissible: hiding one
  // would leave a dead control with no explanation.
  let noteText: string | null = null;
  let noteKind = 'pof-tip-info';
  if (prDisabled && showPrHints && !lockedPrCode) {
    noteText = PICK_VENDOR_FIRST_TIP;
    noteKind = 'pof-tip-warn';
  } else if (!prDisabled && showPrHints && noPrsForVendor && !lockedPrCode) {
    noteText = noOpenPrsMessage(vendorName);
  }

  return (
    <Fragment>
      <tr className="pof-r-top">
        <td className="pof-sr">{idx + 1}</td>
        {/* 168, not 128. A real PR code is `IN-JWPR-00003` — 13 monospace
            characters, plus the input's padding and the dropdown caret — and at
            128px the last digit was cut off, which on a document number is the
            one character you cannot afford to lose. Same width as Item Code. */}
        <td style={{ width: 168 }} title={prDisabled ? PICK_VENDOR_FIRST_TIP : undefined}>
          {lockedPrCode ? (
            <span className="pof-prcode" title={lockedPrCode}>
              {lockedPrCode}
            </span>
          ) : (
            <PrPicker
              // Two reasons to remount. (1) The `prCodeKey` ratchet above:
              // remount on "code known", never on "code cleared". (2) THE VENDOR.
              // A fresh mount has no previous page for react-query's
              // `placeholderData` to carry over, so the vendor you just left can
              // never have its PRs shown — and the picker's own search box and
              // cached label are reset with it.
              key={`${headerVendorId ?? 'no-vendor'}|${prCodeKey.current}`}
              id={`pof-pr-${idx}`}
              className=""
              showLabel={false}
              codeOnly
              disabled={prDisabled}
              placeholder={prDisabled ? PICK_VENDOR_FIRST_PLACEHOLDER : 'Select …'}
              value={line?.sourcePrId ?? null}
              initialLabel={line?.sourcePrCode ?? ''}
              excludeIds={excludePrIds}
              vendorId={headerVendorId}
              vendorName={vendorName}
              onNoOptions={setNoPrsForVendor}
              onChange={(id) => {
                // Clearing UNLINKS the line — id and code go, the item fields
                // stay. The footer stops counting this line toward "at least one
                // line has a PR" as soon as sourcePrId is gone.
                setValue(`lines.${idx}.sourcePrId`, id ?? undefined, { shouldDirty: true });
                if (!id) setValue(`lines.${idx}.sourcePrCode`, undefined, { shouldDirty: true });
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
        {/* THIS LINE's due date. Nothing to do with the header's Delivery Date /
            Delivery Days pair: that promises one delivery for the whole PO, this
            one dates a single item. Neither writes to the other. */}
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

      {/* The note sits on its own full-width row rather than under the 168px PR
          cell, where a sentence would wrap to six lines and read as a tiny grey
          hint. Same amber / blue as the rest of the `pof-` palette. */}
      {noteText ? (
        <tr className="pof-r-note">
          <td />
          <td colSpan={colCount - 1}>
            <div className={`pof-tip ${noteKind}`} role="status">
              <span className="pof-tip-t">{noteText}</span>
            </div>
          </td>
        </tr>
      ) : null}

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
