// The PR form's in-progress value shape — NOT the save payload. Lives in its own
// file so `purchase-request-form.tsx` and `pr-vendor-field.tsx` can both name it
// without importing each other. Mirrors `po-form-values.ts`.
//
// `itemCodeText` is deliberately free text: a PR may be raised for something the
// Item Master has never heard of, so the code is not a picker id. `itemId` is
// filled only when that text happens to match a master item. Both are carried and
// `onValid` decides which one to send.
//
// `vendorCodeText` has no input of its own any more — the Vendor field is the
// type-to-search picker — but it stays in form state because an older PR (and
// every OSP-generated one, which carries a `(vendor TBD)` sentinel) may hold free
// text and no `vendorId`, and the DB CHECK requires one of the two.

import type { PrStatus } from '@innovic/shared';
import { todayLocal } from '@/lib/date';

export interface PrFormValues {
  code: string;
  prDate: string;
  status: PrStatus;
  vendorId?: string;
  vendorCodeText?: string;
  itemId?: string;
  itemCodeText?: string;
  itemName?: string;
  qty: number;
  estCost: number;
  requiredDate?: string;
  operation?: string;
  remarks?: string;
}

export const PR_FORM_DEFAULTS: PrFormValues = {
  code: '',
  prDate: todayLocal(),
  status: 'open',
  qty: 1,
  estCost: 0,
};

/** The `<datalist>` of item codes the Item Code box binds to. */
export const PR_ITEM_DATALIST_ID = 'dlPrItems';

/** Fields the user owns outright. The Item Code cascade is hard-blocked from
 *  writing any of these, whatever the code does. */
export const PR_USER_ENTERED_FIELDS = [
  'qty',
  'estCost',
  'requiredDate',
  'operation',
  'remarks',
  'prDate',
  'code',
  'status',
] as const;
