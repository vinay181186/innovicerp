// Client-side Excel export for QC History (legacy _qcExportExcel, HTML
// L23620-23621). Builds an .xlsx from the already-loaded rows using SheetJS
// (xlsx — an existing dependency). Dates are formatted DD-MM-YYYY (IST-safe via
// fmtDate, no timezone shift) to match the on-screen tables.

import type { QcHistoryLogRow, QcHistoryPendingRow } from '@innovic/shared';
import * as XLSX from 'xlsx';
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

export function exportCompletedQc(logs: QcHistoryLogRow[]): void {
  const rows = logs.map((l) => ({
    JC: l.jcCode,
    Op: `Op${l.opSeq}`,
    SO: l.soCode ?? '',
    Item: l.itemCode ?? '',
    Operation: l.operation,
    Accepted: l.accepted,
    Rejected: l.rejected,
    Date: fmtDate(l.logDate),
    Shift: l.shift ?? '',
    Inspector: l.inspector ?? '',
    Remarks: l.remarks ?? '',
    'Log No': l.logNo,
  }));
  download(rows, 'QC Completed', `qc-completed-${stamp()}.xlsx`);
}

export function exportPendingQc(pending: QcHistoryPendingRow[]): void {
  const rows = pending.map((o) => ({
    JC: o.jcCode,
    Op: `Op${o.opSeq}`,
    SO: o.soCode ?? '',
    Item: o.itemCode ?? '',
    Operation: o.operation,
    Order: o.orderQty,
    Done: o.completed,
    Accepted: o.qcAccepted,
    Rejected: o.qcRejected,
    Pending: o.qcPending,
    Since: fmtDate(o.pendSince),
    Overdue: o.overdue ? 'YES' : '',
  }));
  download(rows, 'QC Pending', `qc-pending-${stamp()}.xlsx`);
}
