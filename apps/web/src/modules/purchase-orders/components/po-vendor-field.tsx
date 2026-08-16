// The PO header's Vendor picker: the shared <VendorPicker> plus the one rule
// that makes it safe to have removed the old free-text fallback box.
//
// The picker itself (search state, vendor list hook, the dropdown, the
// carried-text note) lives in `@/components/shared/vendor-picker` — one
// component, one behaviour, so a fix lands on every vendor field at once. What
// stays here is the part that is specific to THIS form: the react-hook-form
// field path (`header.vendorId`) and the required-rule.
//
// The fallback input is gone, but `vendorCodeText` is NOT: a PO raised before
// this change may hold free text and no `vendorId`, and BOTH the Zod refine and
// the DB CHECK (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015)
// require one of the two. So the stored text is carried through untouched and
// the required-rule below mirrors the server's rule rather than demanding a
// vendor unconditionally — otherwise those older POs could never be saved again.

import type { UseFormReturn } from 'react-hook-form';
import { VendorPicker } from '@/components/shared/vendor-picker';
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

  const selectedId = watch('header.vendorId') ?? null;
  const errorMessage = formState.errors.header?.vendorId?.message;

  return (
    // Two columns: the picker inherits the width the old Vendor `<select>` +
    // "Vendor code (fallback)" pair occupied, so the header row still runs
    // 4 across (Vendor ×2 · Due date · PR ref).
    <VendorPicker
      id="vendorId"
      className="form-grp form-span-2"
      value={selectedId}
      onChange={(id) => setValue('header.vendorId', id ?? undefined, { shouldValidate: true })}
      initialLabel={initialLabel}
      carriedText={carriedVendorText}
      error={errorMessage}
    >
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
    </VendorPicker>
  );
}
