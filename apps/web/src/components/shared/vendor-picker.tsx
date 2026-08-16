// <VendorPicker> — the ONE Vendor field. Every form that picks a vendor (PO
// header, PR header, …) renders this, so a fix to how vendors are found lands
// everywhere at once.
//
// WAS, in each form separately: a plain `<select>` holding every vendor
// (`limit: 200`, no search — you scrolled or you gave up) sitting next to a
// "Vendor code (fallback)" text input, with a "— Free-text vendor below —"
// option wiring the two together.
//
// NOW: `<SearchableSelect>`, server-searched via `?search=`, storing the
// vendor's ID — the exact same value the `<select>` stored, so nothing about
// any form's save payload shape or types changed.
//
// Owns its own search state and list hook: the parent form neither knows nor
// cares how the picker finds a vendor. It is deliberately NOT coupled to
// react-hook-form — each form wires its own register/setValue around it, since
// the field path (`vendorId` vs `header.vendorId`) and the required-rule differ
// per module. Pass that form's hidden registration input as `children`; it
// renders inside the field group, just above the error line.
//
// About `carriedText`: the free-text fallback input is gone from the forms, but
// `vendorCodeText` is NOT. A document raised before that change may hold free
// text and no `vendorId`, and both the Zod refine and the DB CHECK
// (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015) require one of the
// two. Pass the carried text in and the picker shows what is stored, so an empty
// box does not read as "no vendor at all".

import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useVendorsList } from '@/modules/vendors/api';

export interface VendorPickerProps {
  /** DOM id for the input, so the caller's <label htmlFor> still points at it. */
  id?: string | undefined;
  /** Selected vendor id, or null. */
  value: string | null;
  /** Picked vendor id (null when cleared) plus its "CODE — Name" label ('' when
   *  cleared), for callers that want to keep a display copy. */
  onChange: (id: string | null, label: string) => void;
  /** Vendor label joined onto the detail, so an edit form shows the current
   *  vendor before the search page containing it has loaded. */
  initialLabel?: string | undefined;
  /** Free-text vendor already stored on this document (edit only, '' otherwise). */
  carriedText?: string | undefined;
  /** Validation message from the caller's form state. */
  error?: string | undefined;
  /** Field-group wrapper class. Default `form-grp`; pass `form-grp form-span-2`
   *  where the picker inherits the width of the two fields it replaced. */
  className?: string | undefined;
  labelText?: string | undefined;
  /** The caller's hidden react-hook-form registration input. */
  children?: React.ReactNode;
}

export function VendorPicker({
  id = 'vendorId',
  value,
  onChange,
  initialLabel = '',
  carriedText = '',
  error,
  className = 'form-grp',
  labelText = 'Vendor',
  children,
}: VendorPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useVendorsList({
    ...(search.trim() ? { search: search.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const vendors = data?.vendors ?? [];

  // Held separately so the picked vendor still reads correctly once it scrolls
  // out of the current search page.
  const [label, setLabel] = useState(initialLabel);
  const selected = vendors.find((v) => v.id === value);

  return (
    <div className={className}>
      <label className="form-label" htmlFor={id}>
        {labelText}
        <span className="req">★</span>
      </label>
      <SearchableSelect
        id={id}
        value={value}
        onChange={(next) => {
          const v = vendors.find((x) => x.id === next);
          const nextLabel = v ? `${v.code} — ${v.name}` : '';
          setLabel(nextLabel);
          onChange(next, nextLabel);
        }}
        onSearch={setSearch}
        loading={isFetching}
        options={vendors.map((v) => ({ id: v.id, code: v.code, name: v.name }))}
        placeholder="🔍 Type vendor code or name…"
        valueLabel={selected ? `${selected.code} — ${selected.name}` : label || undefined}
      />
      {children}
      {error ? <div className="form-error">{error}</div> : null}
      {/* An older document whose vendor was only ever free text: show what is
          stored so the empty picker does not read as "no vendor at all". */}
      {!value && carriedText ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
          Saved as free text: <b>{carriedText}</b> — pick a vendor to link it.
        </div>
      ) : null}
    </div>
  );
}
