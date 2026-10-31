// Production Orders master — Excel export (owner request 2026-10-26). One row
// per order, the same facts and labels as the list's columns
// (components/po-list-columns.tsx, docs/NAMING.md). The column list and row
// values live here once; the Print / Download PDF register reuses them.

import { PRODUCTION_ORDER_STATUS_LABEL, type ProductionOrderListItem } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev, docDrawingRev } from '@/lib/item-code';
import { isProCancelled } from '../components/po-list-columns';

export const PRO_REGISTER_COLUMNS = [
  'Sr No',
  'Production Order No.',
  'Production Order Date',
  'Item Code',
  'Item Name',
  'Order Qty',
  'Completed',
  'Stock Received',
  'Short Closed Qty',
  'Production Order Status',
  'PRO Target Date',
  'Plan No.',
  'SO / JWSO No.',
  'Internal SO No.',
  'POL',
  'JC No.',
] as const;

/** Indexes of the number columns (right-aligned on the print). */
export const PRO_REGISTER_NUM_COLS = new Set([0, 5, 6, 7, 8]);

/** The status word the list shows (ADR-235: a Cancelled order reads "Cancelled"). */
export function proStatusText(po: ProductionOrderListItem): string {
  return isProCancelled(po) ? 'Cancelled' : PRODUCTION_ORDER_STATUS_LABEL[po.status];
}

/** One order's cells, in PRO_REGISTER_COLUMNS order. */
export function proRegisterRow(po: ProductionOrderListItem, srNo: number): (string | number)[] {
  return [
    srNo,
    po.code,
    fmtDate(po.createdAt, ''),
    itemCodeWithRev(po.itemCodeText, docDrawingRev(po), ''),
    po.itemNameText ?? '',
    po.orderQty,
    po.jcFinishedQty,
    po.creditedQty ?? 0,
    // ADR-233 — blank while the order is still running, as on the list.
    po.shortClosedQty > 0 ? po.shortClosedQty : '',
    proStatusText(po),
    fmtDate(po.targetDate, ''),
    po.planCodeText,
    po.soCodeText ? `${po.soCodeText}${po.lineNo ? `/${po.lineNo}` : ''}` : '',
    po.soInternalNo?.trim() ?? '',
    po.clientPoLineNo ?? '',
    po.jcCodeText,
  ];
}

export function exportProductionOrders(rows: ProductionOrderListItem[]): void {
  const data = rows.map((po, i) => proRegisterRow(po, i + 1));
  const ws = XLSX.utils.aoa_to_sheet([[...PRO_REGISTER_COLUMNS], ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Production Orders');
  XLSX.writeFile(wb, `Production Orders ${todayIst()}.xlsx`);
}
