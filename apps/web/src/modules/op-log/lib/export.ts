// Op Log → Excel, for the CURRENT filter (JC No., log type, shift, date range).
//
// The screen is server-paged (50 a page), so the export pages through the same
// GET /op-log with the API's largest page (200) until it has every matching
// row, then writes one sheet with SheetJS (xlsx — the existing dependency every
// other register export uses; see qc-history/lib/export.ts). Capped at
// EXPORT_CAP rows so a wide-open filter cannot hang the tab; the caller is told
// when the cap cut the file short.
//
// Columns follow the table on screen; the Item Code cell is CODE/REV and the
// revision + part name keep their own columns, as in the other exports.

import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { toQueryString, type ListOpLogQuery, type ListOpLogResponse } from '../api';

const PAGE = 200;
export const EXPORT_CAP = 10_000;

const LOG_TYPE_LABEL: Record<'start' | 'complete' | 'qc', string> = {
  start: 'Start',
  complete: 'Completed',
  qc: 'QC Inspection',
};

/** Writes the file; resolves to { written, total } so the page can say when
 *  the cap trimmed it. */
export async function exportOpLog(
  filter: Omit<ListOpLogQuery, 'limit' | 'offset'>,
): Promise<{ written: number; total: number }> {
  const rows: ListOpLogResponse['items'] = [];
  let total = 0;
  for (let offset = 0; offset < EXPORT_CAP; offset += PAGE) {
    const res = await apiFetch<ListOpLogResponse>(
      `/op-log?${toQueryString({ ...filter, limit: PAGE, offset })}`,
    );
    total = res.total;
    rows.push(...res.items);
    if (res.items.length < PAGE || rows.length >= total) break;
  }

  const sheet = rows.slice(0, EXPORT_CAP).map((r) => ({
    'Log No.': r.logNo,
    'JC No.': r.jcNo,
    POL: r.clientPoLineNo ?? '',
    'Item Code': itemCodeWithRev(r.itemCode, r.itemRevision, ''),
    'Drawing Rev': r.itemRevision ?? '',
    'Item Name': r.itemName ?? '',
    'Log Date': fmtDate(r.logDate),
    Op: opSrNo(r.opSeq),
    'Log Type': `${LOG_TYPE_LABEL[r.logType]}${r.isTpi ? ' (TPI)' : ''}`,
    Shift: SHIFT_LABELS[r.shift as Shift] ?? r.shift,
    'Planned Machine': r.plannedMachineCode ?? '',
    'Actual Machine': r.machineCode ?? '',
    Operation: r.operation ?? '',
    Completed: r.qty,
    Rejected: r.rejectQty,
    Operator: r.operatorName ?? '',
    Remarks: r.remarks ?? '',
    'Logged By': r.createdByName ?? '',
  }));

  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(sheet);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Operation Log');
  XLSX.writeFile(wb, `Operation-Log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return { written: sheet.length, total };
}
