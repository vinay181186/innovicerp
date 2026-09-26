// Client-side Excel export for QC History (legacy _qcExportExcel, HTML
// L23620-23621). Builds an .xlsx from the already-loaded rows using SheetJS
// (xlsx — an existing dependency). Dates are formatted DD-MM-YYYY (IST-safe via
// fmtDate, no timezone shift) to match the on-screen tables.
//
// The Item Code cell is written `CODE/REV`, the same way it reads on screen and
// on every print for a row that traces back to a Sales Order line (user rule
// 2026-09-23). Drawing Rev and Item Name KEEP their own columns beside it: a
// spreadsheet is filtered and sorted, so the bare revision has to stay usable
// on its own, and a job-card number says WHICH JOB and never which part. Same
// call as the Job Card export (export-job-card-excel.ts).
// Rows with no SO line behind them — a raw-material receipt from a vendor —
// have a null revision and correctly keep the bare code; itemCodeWithRev never
// prints a trailing slash.
//
// The QC Call Register exports the same two sheets but its register also holds
// incoming-material (GRN line) calls. Those are passed as the optional second
// argument; when any are present the sheet gains a leading Source column and a
// GRN column so the two kinds of row are told apart. With none passed (the QC
// History page) the sheet is exactly what it always was.

import {
  type IncomingQcCompletedRow,
  type IncomingQcPendingRow,
  type QcHistoryLogRow,
  type QcHistoryPendingRow,
  opSrNo,
} from '@innovic/shared';
import * as XLSX from 'xlsx';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/print/doc-print';

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function download(rows: Record<string, unknown>[], sheetName: string, filename: string): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/** Prefix the Source / GRN columns only when the export mixes both kinds of row. */
function tagged(
  mixed: boolean,
  source: 'Process' | 'Incoming',
  grn: string,
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return mixed ? { Source: source, GRN: grn, ...rest } : rest;
}

export function exportCompletedQc(
  logs: QcHistoryLogRow[],
  incoming: IncomingQcCompletedRow[] = [],
): void {
  const mixed = incoming.length > 0;
  const rows = [
    ...logs.map((l) =>
      tagged(mixed, 'Process', '', {
        'JC No.': l.jcCode,
        Op: `Op${opSrNo(l.opSeq)}`,
        'SO No.': l.soCode ?? '',
        'Item Code': itemCodeWithRev(l.itemCode, l.itemRevision, ''),
        'Drawing Rev': l.itemRevision ?? '',
        'Item Name': l.itemName ?? '',
        Operation: l.operation,
        Accepted: l.accepted,
        Rejected: l.rejected,
        'QC Date': fmtDate(l.logDate),
        Shift: l.shift ?? '',
        'Inspected By': l.inspector ?? '',
        Remarks: l.remarks ?? '',
        'Log No': l.logNo,
      }),
    ),
    ...incoming.map((l) =>
      tagged(mixed, 'Incoming', l.grnNo, {
        'JC No.': '',
        Op: '',
        'SO No.': '',
        'Item Code': itemCodeWithRev(l.itemCode, l.itemRevision, ''),
        'Drawing Rev': l.itemRevision ?? '',
        'Item Name': l.itemName ?? '',
        Operation: `Incoming · ${l.vendorName ?? ''}`,
        Accepted: l.acceptedQty,
        Rejected: l.rejectedQty,
        'QC Date': fmtDate(l.qcDate),
        Shift: '',
        'Inspected By': l.qcInspectedBy ?? '',
        Remarks: l.qcRemarks ?? '',
        'Log No': '',
      }),
    ),
  ];
  download(rows, 'QC Completed', `qc-completed-${stamp()}.xlsx`);
}

export function exportPendingQc(
  pending: QcHistoryPendingRow[],
  incoming: IncomingQcPendingRow[] = [],
): void {
  const mixed = incoming.length > 0;
  const rows = [
    ...pending.map((o) =>
      tagged(mixed, 'Process', '', {
        'JC No.': o.jcCode,
        Op: `Op${opSrNo(o.opSeq)}`,
        'SO No.': o.soCode ?? '',
        'Item Code': itemCodeWithRev(o.itemCode, o.itemRevision, ''),
        'Drawing Rev': o.itemRevision ?? '',
        'Item Name': o.itemName ?? '',
        Operation: o.operation,
        'Order Qty': o.orderQty,
        Completed: o.completed,
        Accepted: o.qcAccepted,
        Rejected: o.qcRejected,
        Pending: o.qcPending,
        Since: fmtDate(o.pendSince),
        Overdue: o.overdue ? 'YES' : '',
      }),
    ),
    ...incoming.map((o) =>
      tagged(mixed, 'Incoming', o.grnNo, {
        'JC No.': o.jcCode ?? '',
        Op: o.opSeq != null ? `Op${opSrNo(o.opSeq)}` : '',
        'SO No.': o.soCode ?? '',
        'Item Code': itemCodeWithRev(o.itemCode, o.itemRevision, ''),
        'Drawing Rev': o.itemRevision ?? '',
        'Item Name': o.itemName ?? '',
        Operation: `Incoming · ${o.vendorName ?? ''}`,
        'Order Qty': o.receivedQty,
        Completed: '',
        Accepted: '',
        Rejected: '',
        Pending: o.pendingQty,
        Since: fmtDate(o.grnDate),
        Overdue: '',
      }),
    ),
  ];
  download(rows, 'QC Pending', `qc-pending-${stamp()}.xlsx`);
}
