// Item Master — Excel template + import parsing. Mirror of legacy
// itemImportTemplate (download a blank template) + itemImportExcel (parse an
// .xlsx of item rows into create payloads). Uses SheetJS, same shape as the
// SO importer (sales-orders/lib/import-export.ts).
//
// DELTA vs legacy: legacy's template carried a "Stock Qty" column — dropped
// here because Item Master defines items only; stock lives in Store. UOM and
// Item Type are validated against the shared enums (invalid → safe default).

import { ITEM_TYPES, type CreateItemInput, UOMS } from '@innovic/shared';
import * as XLSX from 'xlsx';

import { coerceEnum, getCol, readSheetRows } from '@/lib/xlsx-import';

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
  const { rows, sheetError } = await readSheetRows(file);
  if (sheetError) return { payloads: [], errors: [sheetError] };

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
    const uom = coerceEnum(getCol(r, ['UOM', 'uom']), UOMS, {
      fallback: 'NOS',
      label: 'UOM',
      transform: (s) => s.toUpperCase(),
    });
    if (uom.warning) errors.push(`Row ${rowNum}: ${uom.warning}`);
    const itemType = coerceEnum(getCol(r, ['Item Type', 'ItemType', 'item_type', 'Type', 'type']), ITEM_TYPES, {
      fallback: 'component',
      label: 'Item Type',
      transform: (s) => s.toLowerCase(),
    });
    if (itemType.warning) errors.push(`Row ${rowNum}: ${itemType.warning}`);
    payloads.push({
      code,
      name,
      description: getCol(r, ['Description', 'desc', 'Desc']) || undefined,
      drawingNo: getCol(r, ['Drawing No.', 'Drawing No', 'Drawing', 'drawing']) || undefined,
      revision: getCol(r, ['Revision', 'Rev', 'rev']) || 'A',
      material: getCol(r, ['Material', 'material']) || undefined,
      uom: uom.value,
      itemType: itemType.value,
    });
  });

  return { payloads, errors };
}
