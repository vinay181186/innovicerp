// SO Status Review → Excel export. Mirror of legacy _soStatusExportExcel
// (L4555). Builds a Lines sheet (per-line progress) + a Job Cards sheet
// (every linked JC) from the already-loaded SoStatusResponse using SheetJS.

import type { SoStatusResponse } from '@innovic/shared';
import * as XLSX from 'xlsx';

export function exportSoStatusExcel(data: SoStatusResponse): void {
  const { header, lines } = data;

  const lineRows = lines.map((l) => ({
    SO: header.code,
    Line: l.lineNo,
    'Item Code': l.itemCode ?? l.itemCodeText ?? '',
    'Part Name': l.partName ?? '',
    'SO Qty': l.orderQty,
    Done: l.doneQty,
    'Progress %': l.completionPct,
    Status: l.status,
    'JC Issued': l.chips.jcIssued.qty,
    'PO Raised': l.chips.poRaised.qty,
    'GRN Recd': l.chips.grnReceived.qty,
    'QC Accepted': l.chips.qcAccepted.qty,
    Produced: l.chips.produced.qty,
    Dispatched: l.chips.dispatched.qty,
  }));

  const jcRows = lines.flatMap((l) =>
    l.jobCards.map((jc) => ({
      SO: header.code,
      Line: l.lineNo,
      'JC No': jc.code,
      'Item Code': jc.itemCode ?? '',
      'JC Qty': jc.orderQty,
      Completed: jc.doneQty,
      Remaining: jc.remainingQty,
      'Progress %': jc.completionPct,
      Priority: jc.priority,
      Due: jc.dueDate ?? '',
      Status: jc.status,
    })),
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'Lines');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(jcRows.length ? jcRows : [{ SO: header.code, note: 'No job cards' }]),
    'Job Cards',
  );
  XLSX.writeFile(wb, `so-status-${header.code}.xlsx`);
}
