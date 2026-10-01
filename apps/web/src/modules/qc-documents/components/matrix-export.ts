// Matrix view exports (legacy _qcDocExportExcel L23157, _qcDocDownloadAllSO
// L23213). Split out of routes/list.tsx. No JSX.

import type { QcMatrixResponse } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { saveQcDoc } from '../api';
import { fmtExportDate } from './qc-doc-shared';

// Export the matrix to xlsx (legacy _qcDocExportExcel L23157).
export function exportMatrixExcel(matrix: QcMatrixResponse): void {
  const header = [
    'Ln',
    'POL',
    'Item Code',
    // Item Code above is written CODE/REV, the way it reads everywhere else on
    // an SO-traceable row (user rule 2026-09-23). The drawing revision ALSO
    // keeps its own column, so it stays sortable and filterable on its own.
    // Same call as the Job Card export.
    'Drawing Rev',
    'Item Name',
    'Order Qty',
    'JC No.',
    ...matrix.qcColumns,
    'Overall',
  ];
  const aoa: (string | number)[][] = [header];
  for (const r of matrix.rows) {
    const cells = r.cells.map((c) => {
      if (!c.applicable) return '—';
      if (c.done)
        return c.hasDoc ? `Completed (${fmtExportDate(c.docDate)})` : 'Completed, Report Missing';
      if (c.pending)
        return `QC Pending (${c.qcPending} pcs)${c.accepted > 0 ? ` ${c.accepted} Accepted` : ''}`;
      return 'Waiting';
    });
    const overall =
      r.overall === 'no_qc' || r.overall === 'no_jc' ? 'No QC' : `${r.done}/${r.total}`;
    aoa.push([
      r.lineNo,
      r.clientPoLineNo ?? '',
      itemCodeWithRev(r.itemCode, r.itemRevision, ''),
      r.itemRevision ?? '',
      r.itemName ?? '',
      r.orderQty,
      r.jcCode ?? '—',
      ...cells,
      overall,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `QC Docs ${matrix.so.code}`.slice(0, 31));
  const stamp = todayIst();
  XLSX.writeFile(wb, `QC_Documents_${matrix.so.code}_${stamp}.xlsx`);
}

// Download all reports for the SO (legacy _qcDocDownloadAllSO L23213) — open
// each matched doc's signed URL sequentially.
export async function downloadAllReports(matrix: QcMatrixResponse): Promise<void> {
  const paths: string[] = [];
  for (const r of matrix.rows) {
    for (const c of r.cells) {
      if (c.hasDoc && c.storagePath) paths.push(c.storagePath);
    }
  }
  if (paths.length === 0) return;
  for (const p of paths) {
    try {
      await saveQcDoc(p, null, matrix.so.code);
    } catch {
      // Skip anything the server refuses or cannot sign. One bad file must not
      // stop the rest of the batch arriving.
    }
  }
}
