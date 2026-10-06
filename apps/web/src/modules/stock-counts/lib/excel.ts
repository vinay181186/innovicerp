// Stock Count Excel (ADR-193 phase 2): sheet parsing. Item codes are resolved
// by the server (/stock-counts/resolve-items) — never guessed here; unknown
// codes are reported back to the user.
//
// The blank template is built by the API (GET
// /import-templates/stock-count.xlsx, apps/api/src/modules/import-templates)
// so its columns can carry real Excel dropdowns — SheetJS, used below to READ
// a filled sheet, silently drops data validation and cannot write one.
import { getCol, readSheetRows } from '@/lib/xlsx-import';
import { resolveStockCountItems } from '../api';
import type { DraftLine } from './draft-line';

/** Read a sheet and merge its rows into `current` (one line per item). */
export async function mergeStockCountSheet(
  file: File,
  current: DraftLine[],
): Promise<{ lines: DraftLine[]; ok: boolean; text: string }> {
  const { rows, sheetError } = await readSheetRows(file);
  if (sheetError) return { lines: current, ok: false, text: sheetError };
  const parsed = rows
    .map((r) => ({
      code: getCol(r, ['Item Code*', 'Item Code', 'Code']).trim(),
      qty: getCol(r, ['Counted Qty*', 'Counted Qty', 'Qty']).trim(),
      reason: getCol(r, ['Reason']).trim(),
    }))
    .filter((r) => r.code);
  if (parsed.length === 0) {
    return { lines: current, ok: false, text: 'No rows with an Item Code in the sheet.' };
  }
  const res = await resolveStockCountItems(parsed.map((r) => r.code));
  const byCode = new Map(res.found.map((f) => [f.code, f]));
  const next = [...current];
  const skipped: string[] = [];
  let added = 0;
  for (const r of parsed) {
    const f = byCode.get(r.code);
    if (!f) continue;
    if (next.some((l) => l.itemId === f.itemId)) {
      skipped.push(r.code);
      continue;
    }
    next.push({
      itemId: f.itemId,
      itemCode: f.code,
      itemName: f.name,
      uom: f.uom,
      inStock: f.inStock,
      // Round computed cells (12.299999999) to the ledger's 3 decimals.
      countedQty:
        r.qty && Number.isFinite(Number(r.qty))
          ? String(Math.round(Number(r.qty) * 1000) / 1000)
          : r.qty,
      reason: r.reason,
    });
    added += 1;
  }
  const parts = [`${added} line(s) added.`];
  if (res.missing.length) parts.push(`Not in Item Master (not added): ${res.missing.join(', ')}.`);
  if (skipped.length) parts.push(`Already on the count (skipped): ${skipped.join(', ')}.`);
  return { lines: next, ok: res.missing.length === 0, text: parts.join(' ') };
}
