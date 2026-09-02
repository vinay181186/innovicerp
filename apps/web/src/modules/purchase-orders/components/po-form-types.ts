// The redesigned PO form's in-progress value shape — NOT the save payload.
// Lives in its own file so `po-form.tsx` (header + band + totals) and
// `po-form-line.tsx` (one line, three rows) can both name it without importing
// each other.
//
// New next to the older `po-form-values.ts`: a line now carries its OWN
// `sourcePrId` (one PO may cover several PRs, one per line — see
// `createPurchaseOrderInputSchema`) plus `ramRemark`.
//
// `itemCodeText` is deliberately free text: a PO may be raised for something the
// Item Master has never heard of, so the code is not a picker id. `itemId` is
// filled only when that text happens to match a master item, and the save path
// sends the text when there is any (the API resolves it back to a master item).

import type { PoStatus, PoType } from '@innovic/shared';

export interface PoFormLineValue {
  /** Existing line id — edit mode only, so the server merges instead of inserting. */
  id?: string | undefined;
  /** The Purchase Request this line is raised against. Optional per line. */
  sourcePrId?: string | undefined;
  /** That PR's code, for display in the PR NO. cell and the header's audit ref. */
  sourcePrCode?: string | undefined;
  itemId?: string | undefined;
  itemCodeText: string;
  itemName: string;
  qty: number;
  rate: number;
  /** Read-only; moved only by the GRN cascade. */
  receivedQty?: number | undefined;
  dueDate?: string | undefined;
  ramRemark?: string | undefined;
  lineRemarks?: string | undefined;
}

export interface PoFormValues {
  header: {
    code: string;
    poDate: string;
    poType: PoType;
    /** Edit only — shown read-only; it moves via Approve / Reject / Cancel. */
    status?: PoStatus | undefined;
    vendorId?: string | undefined;
    vendorCodeText?: string | undefined;
    dueDate?: string | undefined;
    taxType?: string | undefined;
    sgstPct: number;
    cgstPct: number;
    igstPct: number;
    remarks?: string | undefined;
  };
  lines: PoFormLineValue[];
}

/** A blank hand-added line. Qty starts at 0 so an untouched line reads as
 *  "nothing entered yet" and the footer says so, rather than quietly shipping a
 *  quantity nobody asked for. */
export const NEW_PO_LINE: PoFormLineValue = {
  itemCodeText: '',
  itemName: '',
  qty: 0,
  rate: 0,
};

/** The `<datalist>` of item codes each line's code box binds to. Exported so the
 *  form that renders the list and the row that consumes it cannot drift apart. */
export const PO_FORM_ITEM_DATALIST_ID = 'dlPoFormItems';
