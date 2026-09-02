// <PrPicker> — the ONE Purchase-Request field for raising a PO.
//
// A PO is now always raised AGAINST a Purchase Request (the "+ New PO" flow is
// PR-first). This picker is that first field: type a PR code / item name and
// pick the PR the PO is for. Storing the PR's id is what lets the server link
// the PO back to the PR, flip it to `po_created`, and stop a second PO being
// raised for the same request.
//
// Mirrors <VendorPicker>: owns its own search state + list hook, wraps the
// shared <SearchableSelect>, and stays decoupled from react-hook-form so each
// caller wires its own value/onChange. Only PRs that can still be converted are
// offered — an already-linked (`po_created` / has a poId) or `cancelled` PR is
// filtered out so it can never be picked.
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
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';

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
 *  ways forward, never as an error. */
export function noOpenPrsMessage(vendorName: string): string {
  const who = vendorName.trim() === '' ? 'this vendor' : vendorName.trim();
  return `No open Purchase Requests for ${who} — raise a PR first, or choose another vendor.`;
}

export interface PrPickerProps {
  /** DOM id for the input, so the caller's <label htmlFor> still points at it.
   *  MUST be unique per instance — several pickers share one page on the PO
   *  form (one per line), and a duplicated id breaks every <label htmlFor>. */
  id?: string | undefined;
  /** Selected PR id, or null. */
  value: string | null;
  /** Picked PR id (null when cleared) plus its "CODE — item · qty" label. */
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
   *  "CODE - item - qty"; a table cell is too narrow for all of it. */
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

  // Only PRs that can still become a PO. An already-linked or cancelled PR must
  // never be pickable — the server would reject it, and offering it invites a
  // duplicate-PO attempt.
  // A PR taken on another line is dropped too — one request, one line.
  const excluded = new Set((excludeIds ?? []).filter((x) => x !== value));
  const convertible = rows.filter(
    (pr) =>
      pr.poId === null &&
      pr.status !== 'po_created' &&
      pr.status !== 'cancelled' &&
      !excluded.has(pr.id),
  );

  const labelFor = (pr: (typeof convertible)[number]): string => {
    const item = pr.itemName ?? pr.itemCodeText ?? 'item';
    return `${item} · qty ${pr.qty}`;
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
