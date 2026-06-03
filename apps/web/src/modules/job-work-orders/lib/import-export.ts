// JW line-items Excel template + import (in-form). Mirror of the SO form's
// in-form line import, with JW columns (Rate instead of SO's CPO Line). Adds
// parsed rows as line items to the JW being created/edited. Uses SheetJS.

import * as XLSX from 'xlsx';

const LINE_COLUMNS = ['Item Code', 'Part Name', 'Material', 'Drawing No', 'Qty', 'Rate', 'Due Date'] as const;

export interface JwLineImportRow {
  itemCodeText: string;
  partName: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
  orderQty: number;
  rate: number;
  dueDate?: string | undefined;
}

function toDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : undefined;
}

export function downloadJwLineTemplate(): void {
  const sample = ['ITM-001', 'Machined Shaft', 'EN8', 'DRG-001', '10', '35.50', '2026-07-01'];
  const ws = XLSX.utils.aoa_to_sheet([LINE_COLUMNS as unknown as string[], sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'JW Lines');
  XLSX.writeFile(wb, 'jw-line-items-template.xlsx');
}

export async function parseJwLineFile(file: File): Promise<{ rows: JwLineImportRow[]; errors: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { rows: [], errors: ['Workbook has no sheets'] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const errors: string[] = [];
  const rows: JwLineImportRow[] = [];
  raw.forEach((r, i) => {
    const itemCodeText = String(r['Item Code'] ?? '').trim();
    const partName = String(r['Part Name'] ?? '').trim() || itemCodeText;
    const orderQty = Math.round(Number(r['Qty']));
    if (!itemCodeText && !partName) {
      errors.push(`Row ${i + 2}: missing Item Code and Part Name — skipped`);
      return;
    }
    if (!Number.isFinite(orderQty) || orderQty <= 0) {
      errors.push(`Row ${i + 2}: Qty must be a positive number — skipped`);
      return;
    }
    rows.push({
      itemCodeText,
      partName,
      material: String(r['Material'] ?? '').trim() || undefined,
      drawingNo: String(r['Drawing No'] ?? '').trim() || undefined,
      orderQty,
      rate: Number(r['Rate']) || 0,
      dueDate: toDate(r['Due Date']),
    });
  });
  return { rows, errors };
}
