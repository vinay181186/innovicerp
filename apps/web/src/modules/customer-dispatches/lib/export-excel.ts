// Dispatch Register Excel export (user request 2026-06-06). One row per
// dispatch LINE with the dispatch header columns repeated — so every dispatch
// + all its lines land in Excel, filter/pivot-friendly. Same xlsx pattern as
// the SO Master export.

import type { CustomerDispatchRegisterRow } from '@innovic/shared';
import * as XLSX from 'xlsx';

const COLUMNS = [
  'Dispatch No',
  'Date',
  'SO No',
  'Customer',
  'JC No',
  'CPO Ln',
  'Item Code',
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
    r.itemCode ?? '',
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
