// The PR's Vendor picker: the shared <VendorPicker> plus the one rule that makes
// it safe to have removed the old "Vendor Code (fallback)" box.
//
// The picker itself (search state, vendor list hook, dropdown, carried-text note)
// lives in `@/components/shared/vendor-picker` — the same component the PO header
// uses. What stays here is what is specific to THIS form: the field path
// (`vendorId`) and the required-rule.
//
// The fallback input is gone, but `vendorCodeText` is NOT. Two kinds of PR hold
// free text and no `vendorId`: ones raised before this change, and every
// OSP-generated PR, which carries the `(vendor TBD)` sentinel written by the BOM
// cascade. Both the Zod refine and the DB CHECK
// (`num_nonnulls(vendor_id, vendor_code_text) >= 1`, ADR-015) accept either, so
// the rule below mirrors the SERVER rule instead of demanding a vendor
// unconditionally — force one and those PRs become permanently uneditable.
// On create there is never carried text, so it reads as a plain
// "Vendor is required".

import type { UseFormReturn } from 'react-hook-form';
import { VendorPicker } from '@/components/shared/vendor-picker';
import type { PrFormValues } from './pr-form-values';

export interface PrVendorFieldProps {
  form: UseFormReturn<PrFormValues>;
  /** Free-text vendor already stored on this PR (edit only, '' otherwise). Its
   *  presence is what allows the picker to be left empty. */
  carriedVendorText: string;
  /** Vendor code/name joined onto the detail, so an edit form shows the current
   *  vendor before the search page containing it has loaded. */
  initialLabel: string;
}

export function PrVendorField({
  form,
  carriedVendorText,
  initialLabel,
}: PrVendorFieldProps): React.JSX.Element {
  const { register, setValue, watch, formState } = form;

  const selectedId = watch('vendorId') ?? null;
  const errorMessage = formState.errors.vendorId?.message;

  return (
    <VendorPicker
      id="vendorId"
      value={selectedId}
      onChange={(id) => setValue('vendorId', id ?? undefined, { shouldValidate: true })}
      initialLabel={initialLabel}
      carriedText={carriedVendorText}
      error={errorMessage}
    >
      <input
        type="hidden"
        {...register('vendorId', {
          validate: (v) =>
            Boolean(v) || Boolean(carriedVendorText) || 'Pick a vendor from the master',
        })}
      />
    </VendorPicker>
  );
}
