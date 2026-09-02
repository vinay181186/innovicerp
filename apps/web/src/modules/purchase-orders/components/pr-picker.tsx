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

import { useState } from 'react';
import { type SearchableOption, SearchableSelect } from '@/components/shared/searchable-select';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';

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

  const rows = vendorId
    ? Array.from(
        new Map(
          [
            ...(vendorQ.data?.items ?? []),
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
