// SO / WO Master — Excel template + import parsing. Mirror of legacy
// soImportTemplate (download a blank template) + soImportExcel (parse an .xlsx
// of SO lines, grouped by SO No, into create payloads). Uses SheetJS.

import type { CreateSalesOrderInput, SalesOrderListItem, SoType } from '@innovic/shared';
import * as XLSX from 'xlsx';

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

// Column order = the template header row. One row per SO LINE; rows sharing an
// "SO No" are grouped into one SO (header taken from the first row).
const COLUMNS = [
  'SO No',
  'SO Date',
  'Client',
  'Client PO',
  'Type',
  'Item Code',
  'Part Name',
  'Material',
  'Drawing No',
  'CPO Line',
  'Qty',
  'Rate',
  'Due Date',
  'Remarks',
] as const;

const TYPE_MAP: Record<string, SoType> = {
  component: 'component_manufacturing',
  component_manufacturing: 'component_manufacturing',
  'component manufacturing': 'component_manufacturing',
  equipment: 'equipment',
  with_material: 'with_material',
  'with material': 'with_material',
};

// ── In-form line-items import (adds lines to the SO being created/edited) ──
const LINE_COLUMNS = ['Item Code', 'Material', 'Drawing No', 'CPO Line', 'Qty', 'Rate', 'Due Date'] as const;

export interface SoLineImportRow {
  itemCodeText: string;
  partName: string;
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
      clientPoLineNo: String(r['CPO Line'] ?? '').trim() || undefined,
      orderQty,
      rate: Number(r['Rate']) || 0,
      dueDate: toDate(r['Due Date']),
    });
  });
  return { rows, errors };
}

export function downloadSoTemplate(): void {
  const sample = [
    'SO-EXAMPLE-1', '2026-06-03', 'Acme Industries', 'PO-9001', 'component',
    'ITM-001', 'Shaft 12mm', 'EN8', 'DRG-001', '1', '100', '250', '2026-07-01', 'Sample row — delete before import',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SO Import');
  XLSX.writeFile(wb, 'so-import-template.xlsx');
}

function toDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  // Excel may yield a Date or a serial number or a string.
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : undefined;
}

export interface SoImportResult {
  payloads: CreateSalesOrderInput[];
  rowCount: number;
  errors: string[];
}

export async function parseSoImportFile(
  file: File,
  // Client master — the "Client" column is resolved against this (by name or
  // code). SOs must reference a real client, so unmatched rows are skipped.
  clients: ReadonlyArray<{ id: string; code: string; name: string }>,
): Promise<SoImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], rowCount: 0, errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const clientByKey = new Map<string, string>();
  for (const c of clients) {
    clientByKey.set(c.name.trim().toLowerCase(), c.id);
    clientByKey.set(c.code.trim().toLowerCase(), c.id);
  }

  const errors: string[] = [];
  const groups = new Map<string, { header: Record<string, unknown>; lines: Record<string, unknown>[] }>();

  rows.forEach((r, i) => {
    const soNo = String(r['SO No'] ?? '').trim();
    const partName = String(r['Part Name'] ?? '').trim();
    const itemCode = String(r['Item Code'] ?? '').trim();
    const qty = Number(r['Qty']);
    if (!soNo) {
      errors.push(`Row ${i + 2}: missing "SO No" — skipped`);
      return;
    }
    if (!partName && !itemCode) {
      errors.push(`Row ${i + 2} (${soNo}): missing both Item Code and Part Name — skipped`);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Row ${i + 2} (${soNo}): Qty must be a positive number — skipped`);
      return;
    }
    if (!groups.has(soNo)) groups.set(soNo, { header: r, lines: [] });
    groups.get(soNo)!.lines.push(r);
  });

  const payloads: CreateSalesOrderInput[] = [];
  let rowCount = 0;
  for (const [soNo, grp] of groups) {
    const h = grp.header;
    const typeRaw = String(h['Type'] ?? '').trim().toLowerCase();
    const type = TYPE_MAP[typeRaw] ?? 'component_manufacturing';
    const clientCell = String(h['Client'] ?? '').trim();
    if (!clientCell) {
      errors.push(`${soNo}: missing "Client" — SO skipped`);
      continue;
    }
    const clientId = clientByKey.get(clientCell.toLowerCase());
    if (!clientId) {
      errors.push(`${soNo}: client "${clientCell}" not found in client master — SO skipped`);
      continue;
    }
    const payload: CreateSalesOrderInput = {
      header: {
        code: soNo,
        soDate: toDate(h['SO Date']) ?? new Date().toISOString().slice(0, 10),
        clientId,
        clientPoNo: String(h['Client PO'] ?? '').trim() || undefined,
        type,
        status: 'open',
        gstPercent: 18,
        remarks: String(h['Remarks'] ?? '').trim() || undefined,
      },
      lines: grp.lines.map((l) => {
        rowCount += 1;
        const itemCode = String(l['Item Code'] ?? '').trim();
        const partName = String(l['Part Name'] ?? '').trim() || itemCode;
        return {
          itemCodeText: itemCode || undefined,
          partName,
          uom: 'NOS' as const,
          material: String(l['Material'] ?? '').trim() || undefined,
          drawingNo: String(l['Drawing No'] ?? '').trim() || undefined,
          clientPoLineNo: String(l['CPO Line'] ?? '').trim() || undefined,
          orderQty: Math.round(Number(l['Qty'])),
          rate: Number(l['Rate']) || 0,
          dueDate: toDate(l['Due Date']),
        };
      }),
    };
    payloads.push(payload);
  }

  return { payloads, rowCount, errors };
}
