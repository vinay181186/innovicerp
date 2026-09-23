// Dispatch Register Excel export (user request 2026-06-06). One row per
// dispatch LINE with the dispatch header columns repeated — so every dispatch
// + all its lines land in Excel, filter/pivot-friendly. Same xlsx pattern as
// the SO Master export.

import type { CustomerDispatchRegisterRow } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { itemCodeWithRev } from '@/lib/item-code';

const COLUMNS = [
  'Dispatch No',
  'Date',
  'SO No',
  'Customer',
  'JC No',
  'POL',
  'Item Code',
  // The Item Code cell above reads CODE/REV, the way a dispatch line — which
  // always traces back to a Sales Order line — reads everywhere else (user
  // rule 2026-09-23). The customer's drawing revision ALSO keeps its own
  // column here so it stays filterable and sortable on its own. Same decision
  // as the Job Card export.
  'Drawing Rev',
  'Item Name',
  'Qty',
  'UOM',
  'Dispatched By',
  'Remarks',
  'Stock Before',
  'Stock After',
  'Status',
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
    r.itemRevision ?? '',
    r.itemName,
    r.qty,
    r.uom ?? 'NOS',
    r.dispatchedBy ?? '',
    r.remarks ?? '',
    r.stockBefore ?? '',
    r.stockAfter ?? '',
    r.status,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dispatch Register');
  const suffix = soFilter ? `-${soFilter}` : '';
  XLSX.writeFile(wb, `dispatch-register${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
