// Dispatch Register Excel export (user request 2026-06-06). One row per
// dispatch LINE with the dispatch header columns repeated — so every dispatch
// + all its lines land in Excel, filter/pivot-friendly. Same xlsx pattern as
// the SO Master export.

import type { CustomerDispatchRegisterRow, CustomerDispatchStatus } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

// Status code → the word the user reads (no shared label map exists yet).
const DISPATCH_STATUS_LABEL: Record<CustomerDispatchStatus, string> = {
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

const COLUMNS = [
  'Dispatch No.',
  'Dispatch Date',
  'SO No.',
  'Customer',
  'JC No.',
  'POL',
  // Reads CODE/REV, the way a dispatch line — which always traces back to a
  // Sales Order line — reads everywhere else (user rule 2026-09-23). No
  // separate Drawing Rev column: the revision is already in this cell (owner
  // decision, round 3 wave 2).
  'Item Code',
  'Item Name',
  'Dispatch Qty',
  'UOM',
  'Dispatched By',
  'Remarks',
  'Stock Before',
  'Stock After',
  'Dispatch Status',
] as const;

export function exportDispatchRegister(rows: CustomerDispatchRegisterRow[], soFilter?: string): void {
  const data = rows.map((r) => [
    r.dispatchCode,
    r.date,
    r.soNo ?? '',
    r.customer ?? '',
    r.jcNo ?? '',
    r.clientPoLineNo ?? '',
    itemCodeWithRev(r.itemCode ?? r.itemCodeText, r.itemRevision, ''),
    r.itemName,
    r.qty,
    r.uom ?? 'NOS',
    r.dispatchedBy ?? '',
    r.remarks ?? '',
    r.stockBefore ?? '',
    r.stockAfter ?? '',
    DISPATCH_STATUS_LABEL[r.status],
  ]);
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dispatch Register');
  const suffix = soFilter ? ` ${soFilter}` : '';
  XLSX.writeFile(
    wb,
    `Dispatch Register Export${suffix} ${todayIst()}.xlsx`,
  );
}
