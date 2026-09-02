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

import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';

export interface PrPickerProps {
  /** DOM id for the input, so the caller's <label htmlFor> still points at it. */
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
}

export function PrPicker({
  id = 'prId',
  value,
  onChange,
  initialLabel = '',
  labelText = 'Purchase Request',
  className = 'form-grp',
  disabled = false,
}: PrPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = usePurchaseRequestsList({
    ...(search.trim() ? { search: search.trim() } : {}),
    limit: 50,
    offset: 0,
  });

  // Only PRs that can still become a PO. An already-linked or cancelled PR must
  // never be pickable — the server would reject it, and offering it invites a
  // duplicate-PO attempt.
  const convertible = (data?.items ?? []).filter(
    (pr) => pr.poId === null && pr.status !== 'po_created' && pr.status !== 'cancelled',
  );

  const labelFor = (pr: (typeof convertible)[number]): string => {
    const item = pr.itemName ?? pr.itemCodeText ?? 'item';
    return `${item} · qty ${pr.qty}`;
  };

  const [label, setLabel] = useState(initialLabel);
  const selected = convertible.find((p) => p.id === value);

  return (
    <div className={className}>
      <label className="form-label" htmlFor={id}>
        {labelText}
        <span className="req">★</span>
      </label>
      <SearchableSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(next) => {
          const p = convertible.find((x) => x.id === next);
          const nextLabel = p ? `${p.code} — ${labelFor(p)}` : '';
          setLabel(nextLabel);
          onChange(next, nextLabel);
        }}
        onSearch={setSearch}
        loading={isFetching}
        options={convertible.map((p) => ({ id: p.id, code: p.code, name: labelFor(p) }))}
        placeholder="🔍 Type PR number or item…"
        valueLabel={selected ? `${selected.code} — ${labelFor(selected)}` : label || undefined}
      />
    </div>
  );
}
