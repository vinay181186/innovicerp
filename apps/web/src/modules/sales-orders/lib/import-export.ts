// SO / WO Master — Excel export + the SO form's line-item import. Uses SheetJS.
//
// The bulk multi-SO import (one spreadsheet → many Sales Orders, grouped by
// "SO No") was removed on the user's instruction 2026-08-31: orders are raised
// through + New SO / WO. What remains is the LINE import inside the SO form —
// item code only, name/UOM fetched from Item Master by the form.

import type { SalesOrderListItem } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { coerceDate } from '@/lib/xlsx-import';

/** Format a stored UTC timestamp as IST date + time for export/display. */
function fmtIst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Minimal type for the File System Access API (Chromium-only), used to pop a
// real "Save As" file-explorer dialog. Absent in Firefox/Safari → we fall back.
type SaveFilePicker = (opts: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Export the SO Master list (already filtered/searched by the caller) to an
// .xlsx — one row per SO, the same columns shown in the on-screen table. Opens
// a Save-As dialog where the browser supports it, else downloads to Downloads.
export async function exportSoListExcel(rows: SalesOrderListItem[]): Promise<void> {
  const header = [
    'SO No', 'Date', 'Customer', 'Client PO', 'Type', 'Lines', 'Total Qty',
    'JC Qty', 'Earliest Due', 'Status', 'BOM Status', 'Raised By', 'Raised On (IST)', 'Remarks',
  ];
  const body = rows.map((r) => [
    r.code,
    r.soDate,
    r.customerName ?? '',
    r.clientPoNo ?? '',
    r.type.replaceAll('_', ' '),
    r.lineCount,
    r.totalQty,
    r.jcQty,
    r.earliestDueDate ?? '',
    r.status,
    r.bomStatus ?? '',
    r.createdByName ?? '',
    fmtIst(r.createdAt),
    r.remarks ?? '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Orders');

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `sales-orders-${stamp}.xlsx`;
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buffer], { type: XLSX_MIME });

  // Preferred path (Chrome/Edge): a native Save-As dialog so the user picks the
  // folder and confirms the .xlsx name.
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'Excel Workbook', accept: { [XLSX_MIME]: ['.xlsx'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      // User cancelled the dialog → stop quietly. Any other error → fall back.
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }

  // Fallback (Firefox/Safari, or picker failed): trigger a normal download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── In-form line-items import (adds lines to the SO being created/edited) ──
const LINE_COLUMNS = ['Item Code', 'Material', 'Drawing No', 'CPO Line', 'Qty', 'Rate', 'Due Date'] as const;

export interface SoLineImportRow {
  itemCodeText: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
  clientPoLineNo?: string | undefined;
  orderQty: number;
  rate: number;
  dueDate?: string | undefined;
}

export function downloadSoLineTemplate(): void {
  const sample = ['ITM-001', 'EN8', 'DRG-001', '1', '100', '250', '2026-07-01'];
  const ws = XLSX.utils.aoa_to_sheet([LINE_COLUMNS as unknown as string[], sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SO Lines');
  XLSX.writeFile(wb, 'so-line-items-template.xlsx');
}

export async function parseSoLineFile(file: File): Promise<{ rows: SoLineImportRow[]; errors: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { rows: [], errors: ['Workbook has no sheets'] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const errors: string[] = [];
  const rows: SoLineImportRow[] = [];
  raw.forEach((r, i) => {
    const itemCodeText = String(r['Item Code'] ?? '').trim();
    const orderQty = Math.round(Number(r['Qty']));
    if (!itemCodeText) {
      errors.push(
        `Row ${i + 2}: "Item Code" is empty. Write the item code only — the item name comes from Item Master. Row skipped.`,
      );
      return;
    }
    if (!Number.isFinite(orderQty) || orderQty <= 0) {
      errors.push(`Row ${i + 2}: "Qty" must be a number bigger than 0. Row skipped.`);
      return;
    }
    rows.push({
      itemCodeText,
      material: String(r['Material'] ?? '').trim() || undefined,
      drawingNo: String(r['Drawing No'] ?? '').trim() || undefined,
      clientPoLineNo: String(r['CPO Line'] ?? '').trim() || undefined,
      orderQty,
      rate: Number(r['Rate']) || 0,
      dueDate: toDate(r['Due Date']),
    });
  });
  return { rows, errors };
}

/** A date cell → yyyy-mm-dd, or undefined when the cell is empty / unreadable.
 *
 *  Accepts a real Excel date cell, an ISO date, AND the Indian `dd/mm/yyyy` /
 *  `dd-mm-yyyy` written by hand — the last of which this parser used to drop on
 *  the floor, creating the line with a silently blank due date. The dd/mm rules
 *  live in the shared `coerceDate` that items / clients / vendors / operators
 *  already use, so all the importers now read a date the same way. */
function toDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return coerceDate(String(v));
}
