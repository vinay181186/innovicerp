// The PO form's in-progress value shape — NOT the save payload. Lives in its own
// file so `purchase-order-form.tsx` (the header + totals) and `po-line-row.tsx`
// (one line) can both name it without importing each other.
//
// `itemCodeText` is deliberately free text: a PO may be raised for something the
// Item Master has never heard of, so the code is not a picker id. `itemId` is
// filled only when that text happens to match a master item. Both are carried and
// `onValid` decides which one to send.

import type { PoStatus, PoType } from '@innovic/shared';

export interface PoLineFormValue {
  id?: string;
  itemId?: string;
  itemCodeText: string;
  itemName: string;
  qty: number;
  rate: number;
  receivedQty?: number;
  dueDate?: string;
  lineRemarks?: string;
}

export interface PoFormValues {
  header: {
    code: string;
    poDate: string;
    poType: PoType;
    status: PoStatus;
    vendorId?: string;
    vendorCodeText?: string;
    dueDate?: string;
    taxType?: string;
    sgstPct: number;
    cgstPct: number;
    igstPct: number;
    prCodeText?: string;
    approvalRemarks?: string;
    remarks?: string;
  };
  lines: PoLineFormValue[];
}

/** The `<datalist>` of item codes the line's code box binds to. Exported so the
 *  form that renders the list and the row that consumes it cannot drift apart. */
export const PO_ITEM_DATALIST_ID = 'dlPoItems';
