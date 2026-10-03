// Excel export of completed TPI records (legacy _tpiExport L21572 / "⬇ Excel"
// button). Built from the rows passed in — the TPI screen passes EVERY record
// matching its search (fetchAllPages, ADR-201), not just the page on screen.
// Columns mirror the legacy completed table. xlsx is dynamic-imported so the
// cost only lands when the user actually exports.

import { type TpiCompletedRow, opSrNo } from '@innovic/shared';
import { todayIst } from '@/lib/date';

export async function exportTpiRecords(rows: TpiCompletedRow[]): Promise<void> {
  const { utils: xlsxUtils, write: xlsxWrite } = await import('xlsx');
  const respLabel = (d: number | null): string =>
    d === null ? '' : d <= 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'}`;
  const aoa: (string | number)[][] = [
    [
      'JC No.',
      'Op',
      'SO No.',
      'Internal SO No.',
      // POL — the CUSTOMER's own purchase-order line number, its own column
      // immediately before the item code, as on every other export.
      'POL',
      'Item Code',
      // The drawing revision gets its own column instead of riding inside the
      // item code as CODE/REV. This sheet is filtered and VLOOKUP-ed against
      // Item Master, where a slashed code matches nothing. Same call as the Job
      // Card export.
      'Drawing Rev',
      // The part name is a column of its own for the same reason, and it earns
      // its place because a job-card number says WHICH JOB and not which part —
      // whoever reads this sheet back needs the part named, not just coded.
      'Item Name',
      'Operation',
      'Accepted',
      'Rejected',
      'Call Date',
      'TPI Date',
      'Days to Attend',
      'Inspector Name',
      'Organisation',
      'TPI Certificate No.',
    ],
    ...rows.map((l) => [
      l.jcCode,
      `Op ${opSrNo(l.opSeq)}`,
      l.soCode ?? '',
      l.soInternalNo ?? '',
      l.clientPoLineNo ?? '',
      l.itemCode ?? '',
      l.itemRevision ?? '',
      l.itemName ?? '',
      l.operation,
      l.accepted,
      l.rejected,
      l.callDate ?? '',
      l.attendedDate,
      respLabel(l.respDays),
      l.inspector ?? '',
      l.organization ?? '',
      l.certNo ?? '',
    ]),
  ];
  const sheet = xlsxUtils.aoa_to_sheet(aoa);
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, sheet, 'TPI Records');
  const buf = xlsxWrite(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TPI_Records_${todayIst()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
