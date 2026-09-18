// Client-side Excel export for QC History (legacy _qcExportExcel, HTML
// L23620-23621). Builds an .xlsx from the already-loaded rows using SheetJS
// (xlsx — an existing dependency). Dates are formatted DD-MM-YYYY (IST-safe via
// fmtDate, no timezone shift) to match the on-screen tables.
//
// Item Code, Drawing Rev and Item Name are three separate columns rather than
// one glued "CODE/REV" cell the way the screen shows it. A spreadsheet is
// filtered and VLOOKUP-ed against Item Master, and neither a slashed code nor a
// code with a name appended matches anything there. Same call as the Job Card
// export (export-job-card-excel.ts). The name is on the sheet at all because a
// job-card number says WHICH JOB and never which part.
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
        JC: l.jcCode,
        Op: `Op${opSrNo(l.opSeq)}`,
        SO: l.soCode ?? '',
        'Item Code': l.itemCode ?? '',
        'Drawing Rev': l.itemRevision ?? '',
        'Item Name': l.itemName ?? '',
        Operation: l.operation,
        Accepted: l.accepted,
        Rejected: l.rejected,
        Date: fmtDate(l.logDate),
        Shift: l.shift ?? '',
        Inspector: l.inspector ?? '',
        Remarks: l.remarks ?? '',
        'Log No': l.logNo,
      }),
    ),
    ...incoming.map((l) =>
      tagged(mixed, 'Incoming', l.grnNo, {
        JC: '',
        Op: '',
        SO: '',
        'Item Code': l.itemCode ?? '',
        'Drawing Rev': l.itemRevision ?? '',
        'Item Name': l.itemName ?? '',
        Operation: `Incoming · ${l.vendorName ?? ''}`,
        Accepted: l.acceptedQty,
        Rejected: l.rejectedQty,
        Date: fmtDate(l.qcDate),
        Shift: '',
        Inspector: l.qcInspectedBy ?? '',
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
        JC: o.jcCode,
        Op: `Op${opSrNo(o.opSeq)}`,
        SO: o.soCode ?? '',
        'Item Code': o.itemCode ?? '',
        'Drawing Rev': o.itemRevision ?? '',
        'Item Name': o.itemName ?? '',
        Operation: o.operation,
        Order: o.orderQty,
        Done: o.completed,
        Accepted: o.qcAccepted,
        Rejected: o.qcRejected,
        Pending: o.qcPending,
        Since: fmtDate(o.pendSince),
        Overdue: o.overdue ? 'YES' : '',
      }),
    ),
    ...incoming.map((o) =>
      tagged(mixed, 'Incoming', o.grnNo, {
        JC: o.jcCode ?? '',
        Op: o.opSeq != null ? `Op${opSrNo(o.opSeq)}` : '',
        SO: o.soCode ?? '',
        'Item Code': o.itemCode ?? '',
        'Drawing Rev': o.itemRevision ?? '',
        'Item Name': o.itemName ?? '',
        Operation: `Incoming · ${o.vendorName ?? ''}`,
        Order: o.receivedQty,
        Done: '',
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
