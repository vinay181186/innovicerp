// <PrPicker> — the ONE Purchase-Request field for raising a PO.
//
// A PO is now always raised AGAINST a Purchase Request (the "+ New PO" flow is
// PR-first). This picker is that first field: type a PR code / item name and
// pick the PR the PO is for. Storing the PR's id is what lets the server link
// the PO back to the PR.
//
// WHAT IT OFFERS — AND WHY THAT CHANGED (ADR-152). It used to offer only PRs
// with NO purchase order at all, and the design goal written here was "stop a
// second PO being raised for the same request". That goal is deliberately
// REVERSED: a PR for 100 that got a PO for 10 still has 90 to buy, and the old
// boolean test (`poId === null && status !== 'po_created'`) made those 90
// unorderable and invisible the moment the first PO was raised. A PR is now
// offered while it has BALANCE LEFT, however many POs already touch it, and the
// dropdown says how much is left so the buyer orders the right quantity.
//
// The balance is a SUM over live purchase order lines (cancelled POs excluded),
// which the browser cannot compute, so the SERVER decides: the list query asks
// for `convertibleOnly: true` and renders what comes back. The only filtering
// left here is `excludeIds` (a PR already taken on another line of this same
// PO) plus a belt-and-braces `cancelled` guard.
//
// Mirrors <VendorPicker>: owns its own search state + list hook, wraps the
// shared <SearchableSelect>, and stays decoupled from react-hook-form so each
// caller wires its own value/onChange.
//
// The vendor is a HARD prerequisite: a PR belongs to a vendor, so with no vendor
// named there is no honest list to show and the caller disables this control
// outright rather than offering PRs it cannot stand behind.
//
// `excludeIds` exists because ONE PO may now cover several PRs, one per line:
// a PR already picked on another line must not be offerable a second time, or
// the same request would be ordered twice on one document. The picker also
// renders inside a table cell there, so the label can be turned off (the column
// header names it) and the placeholder is caller-supplied.

import { useEffect, useRef, useState } from 'react';
import { type SearchableOption, SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import { prBalanceText } from '@/modules/purchase-requests/lib/pr-balance';

/** Why the PR box is greyed out. The vendor is a HARD prerequisite now, not a
 *  hint: a PR belongs to a vendor, so there is no honest list to show until the
 *  header names one. */
export const PICK_VENDOR_FIRST_TIP =
  "Select a Vendor first — each line's PR list is only that vendor's Purchase Requests.";

/** The disabled control's own placeholder. The cell is 168px wide, so the detail
 *  lives in the note above, not in here. */
export const PICK_VENDOR_FIRST_PLACEHOLDER = 'Select a Vendor first…';

/** Shown when a vendor IS named and the settled query genuinely returned nothing.
 *  An empty dropdown on its own reads as a broken screen. This is the COMMON case
 *  rather than an edge one — most vendors have nothing waiting to be converted at
 *  any given moment — so it is worded as a plain statement of fact with the two
 *  ways forward, never as an error.
 *
 *  "Nothing left to order" is now the honest wording: a PR only drops out of this
 *  list once its whole quantity is on a purchase order, not the moment the first
 *  PO is raised (ADR-152). */
export function noOpenPrsMessage(vendorName: string): string {
  const who = vendorName.trim() === '' ? 'this vendor' : vendorName.trim();
  return `No Purchase Requests left to order for ${who} — raise a PR first, or choose another vendor.`;
}

export interface PrPickerProps {
  /** DOM id for the input, so the caller's <label htmlFor> still points at it.
   *  MUST be unique per instance — several pickers share one page on the PO
   *  form (one per line), and a duplicated id breaks every <label htmlFor>. */
  id?: string | undefined;
  /** Selected PR id, or null. */
  value: string | null;
  /** Picked PR id (null when cleared) plus its "CODE — item · N of M left" label. */
  onChange: (id: string | null, label: string) => void;
  /** Label for a pre-selected value, so it reads correctly before its search
   *  page has loaded. */
  initialLabel?: string | undefined;
  labelText?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  /** PR ids already used elsewhere (e.g. on another PO line) — never offered. */
  excludeIds?: string[] | undefined;
  /** False inside a table cell, where the column header is the label. */
  showLabel?: boolean | undefined;
  placeholder?: string | undefined;
  /** Show only the PR code once picked. The dropdown still lists
   *  "CODE - item - N of M left"; a table cell is too narrow for all of it. */
  codeOnly?: boolean | undefined;
  /** The vendor the document is being raised on. STRICT: only that vendor's PRs
   *  are offered — the PR's vendor is what ties it to this PO. Null/undefined
   *  means the caller has nothing to filter by, and should be passing `disabled`
   *  with it. */
  vendorId?: string | null | undefined;
  /** That vendor's name, for the "no open PRs for <vendor>" message. Display
   *  only — the picker still stores ids. */
  vendorName?: string | undefined;
  /** True once the query has SETTLED with a vendor chosen and no PR to offer —
   *  distinct from "still loading". Lets the caller show the same message
   *  outside the dropdown, where it is readable. */
  onNoOptions?: ((none: boolean) => void) | undefined;
}

export function PrPicker({
  id = 'prId',
  value,
  onChange,
  initialLabel = '',
  labelText = 'Purchase Request',
  className = 'form-grp',
  disabled = false,
  excludeIds,
  showLabel = true,
  codeOnly = false,
  placeholder = '🔍 Type PR number or item…',
  vendorId,
  vendorName = '',
  onNoOptions,
}: PrPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const base = {
    ...(search.trim() ? { search: search.trim() } : {}),
    // The SERVER decides what is still convertible: `balanceQty > 0`, i.e. a PR
    // with quantity left to order, however many POs already exist against it
    // (ADR-152). The old browser-side `poId === null` test could not see a
    // part-ordered PR at all.
    convertibleOnly: true,
    limit: 50,
    offset: 0,
  };
  // ONE query, keyed by the vendor. The filter runs SERVER-side
  // (`GET /purchase-requests?vendorId=`), so it searches the whole table rather
  // than whichever 50 rows this page happens to hold — and it matches BOTH ways a
  // PR names its vendor: `vendor_id = :id OR upper(btrim(vendor_code_text)) =
  // :vendorCode`, the ADR-015 FK-or-text pattern. That second half is the whole
  // ball game in production, where every PR carries its vendor as TEXT and
  // `vendor_id` is NULL on all of them.
  const listQ = usePurchaseRequestsList(vendorId ? { ...base, vendorId } : base, {
    enabled: !disabled,
  });

  // NO client-side re-check of each row's own `vendorId`, and no "keep the
  // vendor-less ones" exception. Against production data the first would throw
  // away every legitimate row (that column is NULL on all of them) and the second
  // let the entire table through, which is exactly why the filter looked like it
  // was doing nothing. The server owns the filter; this renders what comes back.
  //
  // Stale pages are the CALLER's job: it remounts this picker when the header
  // vendor changes (see the key in `po-form-line.tsx`). A fresh mount has no
  // previous page for `placeholderData` to carry over, so the vendor you just
  // left can never have its PRs shown under the new vendor's name.
  const rows = listQ.data?.items ?? [];
  const isFetching = listQ.isFetching;

  // The balance filter is the server's (`convertibleOnly` above). Two things are
  // still decided here:
  //   • a PR already taken on ANOTHER line of this same PO — one request, one
  //     line on one document, or the same balance gets ordered twice;
  //   • `cancelled`, as a belt-and-braces guard so a cancelled PR can never be
  //     offered even if a stale page is on screen.
  // Nothing here looks at `poId` or `po_created` any more: on a part-ordered PR
  // both say "has a PO" while 90 of 100 are still to buy.
  const excluded = new Set((excludeIds ?? []).filter((x) => x !== value));
  const convertible = rows.filter((pr) => pr.status !== 'cancelled' && !excluded.has(pr.id));

  // "Shaft 50mm · 90 of 100 left" — the buyer is choosing how much to order, so
  // the quantity STILL AVAILABLE is what the option has to say, not the PR's
  // original qty on its own. <SearchableSelect> renders this after the code, so
  // the row reads "IN-PR-00012 — Shaft 50mm · 90 of 100 left".
  const labelFor = (pr: (typeof convertible)[number]): string => {
    // The name is what a buyer recognises, so it wins. Only when there is no
    // name does the option fall back to the CODE — and a code carries the
    // customer's drawing revision with it, `CODE/REV`, exactly as the PR card
    // and the PO line do. The revision is never appended to a NAME.
    const item = pr.itemName ?? itemCodeWithRev(pr.itemCodeText, pr.itemRevision, 'item');
    return `${item} · ${prBalanceText(pr)}`;
  };

  const [label, setLabel] = useState(initialLabel);
  const selected = convertible.find((p) => p.id === value);

  // "This vendor has nothing to offer" — asserted only once the query has
  // SETTLED (not fetching) and only for the unfiltered list, so a search term
  // that matches nothing still reads as "No matches" rather than blaming the
  // vendor.
  const noneForVendor =
    Boolean(vendorId) &&
    !disabled &&
    !isFetching &&
    search.trim() === '' &&
    convertible.length === 0;
  const reported = useRef<boolean | null>(null);
  useEffect(() => {
    if (reported.current === noneForVendor) return;
    reported.current = noneForVendor;
    onNoOptions?.(noneForVendor);
  }, [noneForVendor, onNoOptions]);

  return (
    <div className={className}>
      {showLabel ? (
        <label className="form-label" htmlFor={id}>
          {labelText}
          <span className="req">★</span>
        </label>
      ) : null}
      <SearchableSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          const p = convertible.find((x) => x.id === next);
          const nextLabel = p ? `${p.code} — ${labelFor(p)}` : '';
          setLabel(p && codeOnly ? p.code : nextLabel);
          onChange(next, nextLabel);
        }}
        onSearch={setSearch}
        loading={isFetching}
        options={convertible.map((p) => ({ id: p.id, code: p.code, name: labelFor(p) }))}
        placeholder={placeholder}
        {...(noneForVendor ? { emptyText: noOpenPrsMessage(vendorName) } : {})}
        {...(codeOnly ? { selectedLabel: (o: SearchableOption) => o.code ?? o.name } : {})}
        valueLabel={
          selected
            ? codeOnly
              ? selected.code
              : `${selected.code} — ${labelFor(selected)}`
            : label || undefined
        }
      />
    </div>
  );
}
