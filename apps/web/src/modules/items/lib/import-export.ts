// Item Master — Excel import parsing (ERPNext Data Import behaviour, see
// packages/shared/src/schemas/master-import.ts). Uses SheetJS to READ a filled
// sheet.
//
// The blank template itself is built by the API (GET
// /import-templates/items.xlsx, apps/api/src/modules/import-templates) so its
// Item Type / UOM / Source columns can carry real Excel dropdowns — SheetJS
// silently drops data validation and cannot write one. The parser here only
// does the structural checks (blank Item Code / Item Name, an Item Code
// repeated in the file, an Item Type / UOM / Source that cannot be read); every
// field rule is the server's, answered per row by the preview (dryRun).
//
// Insert new: Item Code, Item Name and Item Type are required. Item Type
// (ADR-193 Q2): blank or unknown → the row is refused, never guessed. UOM:
// unknown → NOS with a warning; Source: blank → Make.
// Update existing: matched by Item Code; a BLANK cell is left out of the
// payload, so it keeps the current value. Import never changes an Item Type —
// the server skips the row if the sheet's type differs from the item's.
//
// No "Drawing No." / "Revision" columns (user decision 2026-09-21): both belong
// to the SO / JWSO line, not the item. Older sheets that still carry those two
// columns import fine — they are simply ignored.

import {
  ITEM_PROCUREMENT_TYPES,
  ITEM_TYPES,
  itemTypeLabel,
  type ItemType,
  type MasterImportMode,
  UOMS,
} from '@innovic/shared';

import {
  putIfFilled,
  type MasterImportParse,
  type ParsedImportRow,
  type ParsedImportSkip,
} from '@/lib/master-import';
import { coerceEnum, getCol, readSheetRows } from '@/lib/xlsx-import';

/** "Component", "component", "Tool / Instrument", "Raw Material",
 *  "raw_material" → the Item Type code; null when it matches none. */
function resolveItemType(raw: string): ItemType | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '_')
    .replace(/_+/g, '_');
  for (const t of ITEM_TYPES) {
    const labelKey = itemTypeLabel(t)
      .toLowerCase()
      .replace(/[\s/]+/g, '_')
      .replace(/_+/g, '_');
    if (key === t || key === labelKey) return t;
  }
  // Older sheets: "Tool_Instrument" / "tool instrument".
  const stripped = key.replace(/_instrument$/, '');
  return (ITEM_TYPES as readonly string[]).includes(stripped) ? (stripped as ItemType) : null;
}

export async function parseItemImportFile(
  file: File,
  mode: MasterImportMode,
): Promise<MasterImportParse> {
  const { rows: sheet, sheetError } = await readSheetRows(file);
  if (sheetError) return { rows: [], skipped: [], fatal: sheetError, notes: [] };

  const rows: ParsedImportRow[] = [];
  const skipped: ParsedImportSkip[] = [];
  const seen = new Set<string>();
  const isUpdate = mode === 'update';
  const typeList = ITEM_TYPES.map((t) => itemTypeLabel(t)).join(' / ');

  sheet.forEach((r, i) => {
    const rowNum = i + 2; // 1-indexed + header row
    const code = getCol(r, ['Item Code*', 'Item Code', 'item_code', 'Code', 'code']);
    // 'Item Name*' is the template header since 2026-09-26; older sheets carry 'Name*'.
    const name = getCol(r, ['Item Name*', 'Item Name', 'item_name', 'Name*', 'Name', 'name']);
    if (!code && !name) return; // fully blank row — skip silently
    const skip = (reason: string): void => {
      skipped.push({ rowNum, code: code || null, name, reason });
    };
    if (!code) {
      return skip(isUpdate ? 'Item Code is required to update an item' : 'Item Code is required');
    }
    if (!isUpdate && !name) return skip('Item Name is required');
    const codeKey = code.toLowerCase();
    if (seen.has(codeKey)) return skip(`Item Code "${code}" is repeated in the file`);
    seen.add(codeKey);

    const payload: Record<string, unknown> = {};
    const warnings: string[] = [];
    putIfFilled(payload, 'code', code);
    putIfFilled(payload, 'name', name);
    putIfFilled(payload, 'description', getCol(r, ['Description', 'desc', 'Desc']));
    putIfFilled(payload, 'material', getCol(r, ['Material', 'material']));
    putIfFilled(payload, 'hsnCode', getCol(r, ['HSN Code', 'HSN', 'hsn', 'HSN/SAC', 'hsn_code']));

    // Q2 (ADR-193): the Item Type is chosen per item — a blank cell on a NEW
    // item is an error, never a silent 'component'.
    const rawType = getCol(r, ['Item Type*', 'Item Type', 'ItemType', 'item_type', 'Type', 'type']);
    if (rawType) {
      const itemType = resolveItemType(rawType);
      if (!itemType) return skip(`Item Type "${rawType}" is not one of ${typeList}`);
      payload.itemType = itemType;
    } else if (!isUpdate) {
      return skip(`Item Type is blank — choose ${typeList}`);
    }

    const rawUom = getCol(r, ['UOM', 'uom']);
    if (rawUom) {
      const uom = coerceEnum(rawUom, UOMS, {
        fallback: 'NOS',
        label: 'UOM',
        transform: (s) => s.toUpperCase(),
      });
      // Update mode must not quietly overwrite a good UOM with the fallback.
      if (uom.warning && isUpdate) return skip(`UOM "${rawUom}" is not one of ${UOMS.join(' / ')}`);
      if (uom.warning) warnings.push(uom.warning);
      payload.uom = uom.value;
    }

    // ADR-171 — Source (make / buy); blank → the server's default (make).
    const rawSource = getCol(r, ['Source', 'source', 'Procurement Type', 'procurement_type']);
    if (rawSource) {
      const source = coerceEnum(rawSource, ITEM_PROCUREMENT_TYPES, {
        fallback: 'make',
        label: 'Source',
        transform: (s) => s.toLowerCase(),
      });
      if (source.warning && isUpdate) return skip(`Source "${rawSource}" is not Make or Buy`);
      if (source.warning) warnings.push(source.warning);
      payload.procurementType = source.value;
    }

    rows.push({ rowNum, payload, code, name, warnings });
  });

  return { rows, skipped, notes: [] };
}
