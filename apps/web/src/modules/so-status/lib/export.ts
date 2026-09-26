// SO Status Review → Excel export. Mirror of legacy _soStatusExportExcel
// (L4555). Builds a Lines sheet (per-line progress) + a Job Cards sheet
// (every linked JC) from the already-loaded SoStatusResponse using SheetJS.

import type { SoStatusJcStatus, SoStatusLineStatus, SoStatusResponse } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { itemCodeWithRev } from '@/lib/item-code';

// Status codes → the words the SO Status screen shows (so-status-detail.tsx).
const LINE_STATUS_LABEL: Record<SoStatusLineStatus, string> = {
  complete: 'Completed',
  qc_pending: 'QC Pending',
  no_jc: 'No JC',
  in_progress: 'In Progress',
};
const JC_STATUS_LABEL: Record<SoStatusJcStatus, string> = {
  complete: 'Completed',
  qc_pending: 'QC Pending',
  in_progress: 'In Progress',
  no_ops: 'No Operations',
};
const PRIORITY_LABEL: Record<string, string> = { high: 'High', normal: 'Normal' };

export function exportSoStatusExcel(data: SoStatusResponse): void {
  const { header, lines } = data;

  const lineRows = lines.map((l) => ({
    'SO No.': header.code,
    Ln: l.lineNo,
    // POL — the line number on the CUSTOMER'S OWN purchase order, an extra
    // column beside our `Line`, never a replacement for it.
    POL: l.clientPoLineNo ?? '',
    // CODE/REV, the way an SO-traceable row reads everywhere else (user rule
    // 2026-09-23) — every line on this sheet IS a Sales Order line.
    'Item Code': itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision, ''),
    // The customer's drawing revision ALSO keeps its own column: in a
    // spreadsheet people filter and sort on the bare revision, so it has to
    // stay available on its own. Same split as the Job Card export.
    'Drawing Rev': l.itemRevision ?? '',
    'Item Name': l.partName ?? '',
    'Order Qty': l.orderQty,
    // `doneQty` is the same number the API puts in the "produced" chip, so it
    // prints once, here — there is no separate "Produced" column.
    Completed: l.doneQty,
    'Progress %': l.completionPct,
    // The status of THIS LINE, not of the whole SO.
    'Line Status': LINE_STATUS_LABEL[l.status],
    'JC Issued': l.chips.jcIssued.qty,
    'PO Raised': l.chips.poRaised.qty,
    'GRN Received': l.chips.grnReceived.qty,
    'QC Accepted': l.chips.qcAccepted.qty,
    Dispatched: l.chips.dispatched.qty,
  }));

  const jcRows = lines.flatMap((l) =>
    l.jobCards.map((jc) => ({
      'SO No.': header.code,
      Ln: l.lineNo,
      POL: jc.clientPoLineNo ?? l.clientPoLineNo ?? '',
      'JC No.': jc.code,
      'Item Code': itemCodeWithRev(jc.itemCode, jc.itemRevision, ''),
      'Drawing Rev': jc.itemRevision ?? '',
      // WHAT the job card makes. A JC number says which job, not which part, and
      // this sheet is read away from the screen where nothing else names the
      // item. Its OWN column for the same reason Drawing Rev keeps one: each
      // fact stays filterable on its own, even though the Item Code cell now
      // carries the revision with it.
      'Item Name': jc.itemName ?? '',
      'Order Qty': jc.orderQty,
      Completed: jc.doneQty,
      Pending: jc.remainingQty,
      'Progress %': jc.completionPct,
      Priority: PRIORITY_LABEL[jc.priority] ?? jc.priority,
      'Due Date': jc.dueDate ?? '',
      'JC Status': JC_STATUS_LABEL[jc.status],
    })),
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows), 'Lines');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      jcRows.length ? jcRows : [{ 'SO No.': header.code, Note: 'No job cards' }],
    ),
    'Job Cards',
  );
  XLSX.writeFile(wb, `SO Status Export ${header.code}.xlsx`);
}
