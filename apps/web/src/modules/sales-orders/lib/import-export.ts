// SO / WO Master — Excel template + import parsing. Mirror of legacy
// soImportTemplate (download a blank template) + soImportExcel (parse an .xlsx
// of SO lines, grouped by SO No, into create payloads). Uses SheetJS.

import type { CreateSalesOrderInput, SoType } from '@innovic/shared';
import * as XLSX from 'xlsx';

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

export async function parseSoImportFile(file: File): Promise<SoImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], rowCount: 0, errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

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
    const customerName = String(h['Client'] ?? '').trim();
    if (!customerName) {
      errors.push(`${soNo}: missing "Client" — SO skipped`);
      continue;
    }
    const payload: CreateSalesOrderInput = {
      header: {
        code: soNo,
        soDate: toDate(h['SO Date']) ?? new Date().toISOString().slice(0, 10),
        customerName,
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
