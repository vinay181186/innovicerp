// Item Master — Excel template + import parsing. Mirror of legacy
// itemImportTemplate (download a blank template) + itemImportExcel (parse an
// .xlsx of item rows into create payloads). Uses SheetJS, same shape as the
// SO importer (sales-orders/lib/import-export.ts).
//
// DELTA vs legacy: legacy's template carried a "Stock Qty" column — dropped
// here because Item Master defines items only; stock lives in Store. UOM and
// Item Type are validated against the shared enums (invalid → safe default).

import { ITEM_TYPES, type CreateItemInput, type ItemType, UOMS, type Uom } from '@innovic/shared';
import * as XLSX from 'xlsx';

// Template header row (the "*" marks required columns, legacy convention).
const COLUMNS = [
  'Item Code*',
  'Name*',
  'Description',
  'Drawing No.',
  'Revision',
  'Material',
  'UOM',
  'Item Type',
] as const;

function getCol(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) {
      const s = String(row[k]).trim();
      if (s !== '') return s;
    }
  }
  return '';
}

function normalizeUom(raw: string): Uom {
  const u = raw.trim().toUpperCase();
  return (UOMS as readonly string[]).includes(u) ? (u as Uom) : 'NOS';
}

function normalizeItemType(raw: string): ItemType {
  const t = raw.trim().toLowerCase();
  return (ITEM_TYPES as readonly string[]).includes(t) ? (t as ItemType) : 'component';
}

export function downloadItemTemplate(): void {
  const sample = ['ITM-001', 'Shaft 50mm', 'Main drive shaft', 'DRW-001', 'A', 'EN8 Steel', 'NOS', 'component'];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [14, 22, 28, 16, 10, 18, 8, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Items');
  XLSX.writeFile(wb, 'ItemMaster_ImportTemplate.xlsx');
}

export interface ItemImportResult {
  payloads: CreateItemInput[];
  errors: string[];
}

export async function parseItemImportFile(file: File): Promise<ItemImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const errors: string[] = [];
  const payloads: CreateItemInput[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2; // 1-indexed + header row
    const code = getCol(r, ['Item Code*', 'Item Code', 'item_code', 'Code', 'code']);
    const name = getCol(r, ['Name*', 'Name', 'name']);
    if (!code && !name) return; // fully blank row — skip silently
    if (!code) {
      errors.push(`Row ${rowNum}: Item Code is required — skipped`);
      return;
    }
    if (!name) {
      errors.push(`Row ${rowNum}: Name is required — skipped`);
      return;
    }
    if (seen.has(code)) {
      errors.push(`Row ${rowNum}: Item Code "${code}" is repeated in the file — skipped`);
      return;
    }
    seen.add(code);
    payloads.push({
      code,
      name,
      description: getCol(r, ['Description', 'desc', 'Desc']) || undefined,
      drawingNo: getCol(r, ['Drawing No.', 'Drawing No', 'Drawing', 'drawing']) || undefined,
      revision: getCol(r, ['Revision', 'Rev', 'rev']) || 'A',
      material: getCol(r, ['Material', 'material']) || undefined,
      uom: normalizeUom(getCol(r, ['UOM', 'uom'])),
      itemType: normalizeItemType(getCol(r, ['Item Type', 'ItemType', 'item_type', 'Type', 'type'])),
    });
  });

  return { payloads, errors };
}
