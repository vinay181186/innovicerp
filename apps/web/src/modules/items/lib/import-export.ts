// Item Master — Excel template + import parsing. Mirror of legacy
// itemImportTemplate (download a blank template) + itemImportExcel (parse an
// .xlsx of item rows into create payloads). Uses SheetJS, same shape as the
// SO importer (sales-orders/lib/import-export.ts).
//
// DELTA vs legacy: legacy's template carried a "Stock Qty" column — dropped
// here because Item Master defines items only; stock lives in Store. UOM and
// Item Type are validated against the shared enums (invalid → safe default).
//
// No "Drawing No." / "Revision" columns (user decision 2026-09-21): both belong
// to the SO / JWSO line, not the item. Older sheets that still carry those two
// columns import fine — they are simply ignored.

import { ITEM_PROCUREMENT_TYPES, ITEM_TYPES, type CreateItemInput, UOMS } from '@innovic/shared';
import * as XLSX from 'xlsx';

import { coerceEnum, getCol, readSheetRows } from '@/lib/xlsx-import';

// Template header row (the "*" marks required columns, legacy convention).
const COLUMNS = [
  'Item Code*',
  'Name*',
  'Description',
  'Material',
  'UOM',
  'Item Type',
  'Source',
] as const;

export function downloadItemTemplate(): void {
  const sample = [
    'ITM-001',
    'Shaft 50mm',
    'Main drive shaft',
    'EN8 Steel',
    'NOS',
    'component',
    'make',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [14, 22, 28, 18, 8, 12, 8].map((wch) => ({ wch }));
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
    const itemType = coerceEnum(
      getCol(r, ['Item Type', 'ItemType', 'item_type', 'Type', 'type']),
      ITEM_TYPES,
      {
        fallback: 'component',
        label: 'Item Type',
        transform: (s) => s.toLowerCase(),
      },
    );
    if (itemType.warning) errors.push(`Row ${rowNum}: ${itemType.warning}`);
    // ADR-171 — Source (make / buy); blank or unknown → make, the default.
    const source = coerceEnum(
      getCol(r, ['Source', 'source', 'Procurement Type', 'procurement_type']),
      ITEM_PROCUREMENT_TYPES,
      {
        fallback: 'make',
        label: 'Source',
        transform: (s) => s.toLowerCase(),
      },
    );
    if (source.warning) errors.push(`Row ${rowNum}: ${source.warning}`);
    payloads.push({
      code,
      name,
      description: getCol(r, ['Description', 'desc', 'Desc']) || undefined,
      // `revision` is required by the CreateItemInput type (the schema defaults
      // it to 'A' server-side); it is not read from the sheet any more.
      revision: 'A',
      material: getCol(r, ['Material', 'material']) || undefined,
      uom: uom.value,
      itemType: itemType.value,
      procurementType: source.value,
    });
  });

  return { payloads, errors };
}
