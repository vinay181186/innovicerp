// SO Status Review → Excel export. Mirror of legacy _soStatusExportExcel
// (L4555). Builds a Lines sheet (per-line progress) + a Job Cards sheet
// (every linked JC) from the already-loaded SoStatusResponse using SheetJS.

import type { SoStatusResponse } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { itemCodeWithRev } from '@/lib/item-code';

export function exportSoStatusExcel(data: SoStatusResponse): void {
  const { header, lines } = data;

  const lineRows = lines.map((l) => ({
    SO: header.code,
    Line: l.lineNo,
    // CODE/REV, the way an SO-traceable row reads everywhere else (user rule
    // 2026-09-23) — every line on this sheet IS a Sales Order line.
    'Item Code': itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision, ''),
    // The customer's drawing revision ALSO keeps its own column: in a
    // spreadsheet people filter and sort on the bare revision, so it has to
    // stay available on its own. Same split as the Job Card export.
    'Drawing Rev': l.itemRevision ?? '',
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
      'Item Code': itemCodeWithRev(jc.itemCode, jc.itemRevision, ''),
      'Drawing Rev': jc.itemRevision ?? '',
      // WHAT the job card makes. A JC number says which job, not which part, and
      // this sheet is read away from the screen where nothing else names the
      // item. Its OWN column for the same reason Drawing Rev keeps one: each
      // fact stays filterable on its own, even though the Item Code cell now
      // carries the revision with it.
      'Item Name': jc.itemName ?? '',
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
