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
// `excludeIds` exists because ONE PO may now cover several PRs, one per line:
// a PR already picked on another line must not be offerable a second time, or
// the same request would be ordered twice on one document. The picker also
// renders inside a table cell there, so the label can be turned off (the column
// header names it) and the placeholder is caller-supplied.

import { useEffect, useRef, useState } from 'react';
import { type SearchableOption, SearchableSelect } from '@/components/shared/searchable-select';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';

/** Shown when the buyer reaches for a PR before naming a vendor. Guidance, NOT a
 *  block: the picker still offers every convertible PR, because picking the PR
 *  first and letting it seed the vendor is a legitimate way round this form. */
export const PICK_VENDOR_FIRST_TIP =
  "Pick a Vendor first — then this list shows only that vendor's Purchase Requests.";

/** Shown when a vendor IS named and the settled query genuinely returned nothing.
 *  An empty dropdown on its own reads as a broken screen. */
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
  /** The vendor the document is being raised on. When set, only that vendor's
   *  PRs are offered — the PR's vendor is what ties it to this PO — PLUS the
   *  OSP "(vendor TBD)" PRs, which carry no vendor at all and are precisely the
   *  ones a buyer picks a vendor for. Null/undefined offers everything, so a
   *  buyer who picks the PR first is not blocked. */
  vendorId?: string | null | undefined;
  /** That vendor's name, for the "no open PRs for <vendor>" message. Display
   *  only — the picker still stores ids. */
  vendorName?: string | undefined;
  /** Fired when the buyer reaches for this field (click or keyboard focus), so
   *  the caller can raise the "pick a vendor first" note next to it. */
  onInteract?: (() => void) | undefined;
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
  onInteract,
  onNoOptions,
}: PrPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const base = {
    ...(search.trim() ? { search: search.trim() } : {}),
    limit: 50,
    offset: 0,
  };
  // The vendor filter runs SERVER-side (`GET /purchase-requests?vendorId=`), so
  // it searches the whole table rather than whichever 50 rows this page happens
  // to hold. Skipped entirely when no vendor is chosen.
  const vendorQ = usePurchaseRequestsList(vendorId ? { ...base, vendorId } : base, {
    enabled: Boolean(vendorId),
  });
  // The unfiltered page. It IS the option list when no vendor is chosen, and
  // when one is, it is where the OSP "(vendor TBD)" PRs come from — they have
  // no vendor_id, so a vendor-filtered query can never return them.
  const openQ = usePurchaseRequestsList(base);

  // `usePurchaseRequestsList` keeps the previous page on screen while a new one
  // loads (`placeholderData`), which is right for typing a search term and WRONG
  // when the header vendor changes: for a moment the list would still be the OLD
  // vendor's PRs under the new vendor's name. Re-checking each row's own
  // `vendorId` throws those away, so a vendor change can only ever show the new
  // vendor's rows or an honest "Loading…".
  const rows = vendorId
    ? Array.from(
        new Map(
          [
            ...(vendorQ.data?.items ?? []).filter((pr) => pr.vendorId === vendorId),
            ...(openQ.data?.items ?? []).filter((pr) => pr.vendorId === null),
          ].map((pr) => [pr.id, pr]),
        ).values(),
      )
    : (openQ.data?.items ?? []);
  const isFetching = openQ.isFetching || vendorQ.isFetching;

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
  // SETTLED (both halves idle) and only for the unfiltered list, so a search term
  // that matches nothing still reads as "No matches" rather than blaming the
  // vendor.
  const noneForVendor =
    Boolean(vendorId) && !isFetching && search.trim() === '' && convertible.length === 0;
  const reported = useRef<boolean | null>(null);
  useEffect(() => {
    if (reported.current === noneForVendor) return;
    reported.current = noneForVendor;
    onNoOptions?.(noneForVendor);
  }, [noneForVendor, onNoOptions]);

  return (
    <div
      className={className}
      // Capture phase: the notice must fire on the way DOWN to the input inside
      // <SearchableSelect>, which this file must not reach into.
      onMouseDownCapture={onInteract}
      onFocusCapture={onInteract}
    >
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
