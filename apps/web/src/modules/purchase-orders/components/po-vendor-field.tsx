// The PO header's Vendor picker — the shared type-to-search dropdown, plus the
// one rule that makes it safe to have removed the old free-text fallback box.
//
// WAS: a plain `<select>` holding every vendor (`limit: 200`, no search — you
// scrolled or you gave up) sitting next to a "Vendor code (fallback)" text input,
// with a "— Free-text vendor below —" option wiring the two together.
//
// NOW: `<SearchableSelect>`, server-searched via `?search=`, storing the vendor's
// ID — the exact same value the `<select>` stored, so nothing about the save
// payload's shape or types changed.
//
// The fallback input is gone, but `vendorCodeText` is NOT: a PO raised before this
// change may hold free text and no `vendorId`, and BOTH the Zod refine and the DB
// CHECK (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015) require one of
// the two. So the stored text is carried through untouched and the required-rule
// below mirrors the server's rule rather than demanding a vendor unconditionally —
// otherwise those older POs could never be saved again.
//
// Owns its own search state and list hook, which is why it is its own file: the
// parent form neither knows nor cares how the picker finds a vendor.

import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useVendorsList } from '@/modules/vendors/api';
import type { PoFormValues } from './po-form-values';

export interface PoVendorFieldProps {
  form: UseFormReturn<PoFormValues>;
  /** Free-text vendor already stored on this PO (edit only, '' otherwise). Its
   *  presence is what allows the picker to be left empty. */
  carriedVendorText: string;
  /** Vendor name joined onto the detail, so an edit form shows the current
   *  vendor before the search page containing it has loaded. */
  initialLabel: string;
}

export function PoVendorField({
  form,
  carriedVendorText,
  initialLabel,
}: PoVendorFieldProps): React.JSX.Element {
  const { register, setValue, watch, formState } = form;

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

  const selectedId = watch('header.vendorId') ?? null;
  const selected = vendors.find((v) => v.id === selectedId);
  const errorMessage = formState.errors.header?.vendorId?.message;

  return (
    // Two columns: the picker inherits the width the old Vendor `<select>` +
    // "Vendor code (fallback)" pair occupied, so the header row still runs
    // 4 across (Vendor ×2 · Due date · PR ref).
    <div className="form-grp form-span-2">
      <label className="form-label" htmlFor="vendorId">
        Vendor<span className="req">★</span>
      </label>
      <SearchableSelect
        id="vendorId"
        value={selectedId}
        onChange={(id) => {
          setValue('header.vendorId', id ?? undefined, { shouldValidate: true });
          const v = vendors.find((x) => x.id === id);
          setLabel(v ? `${v.code} — ${v.name}` : '');
        }}
        onSearch={setSearch}
        loading={isFetching}
        options={vendors.map((v) => ({ id: v.id, code: v.code, name: v.name }))}
        placeholder="🔍 Type vendor code or name…"
        valueLabel={selected ? `${selected.code} — ${selected.name}` : label || undefined}
      />
      <input
        type="hidden"
        {...register('header.vendorId', {
          // Mirrors the server rule exactly: a vendor ID OR carried free text.
          // On create there is never carried text, so this reads as a plain
          // "Vendor is required"; on an older free-text PO it lets the record
          // still be saved without forcing a vendor to be re-picked.
          validate: (v) =>
            Boolean(v) || Boolean(carriedVendorText) || 'Pick a vendor from the master',
        })}
      />
      {errorMessage ? <div className="form-error">{errorMessage}</div> : null}
      {/* An older PO whose vendor was only ever free text: show what is stored so
          the empty picker does not read as "no vendor at all". */}
      {!selectedId && carriedVendorText ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
          Saved as free text: <b>{carriedVendorText}</b> — pick a vendor to link it.
        </div>
      ) : null}
    </div>
  );
}
