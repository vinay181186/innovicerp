// Multi-Level BOM import — sheet reader (ADR-225 phase 2).
//
// Reads the "BOM Lines" sheet (else the first sheet) into the contract's raw
// rows: every cell as TEXT (so 00451 stays 00451), headers matched with the
// shared normalizeHeaderKey, the sheet row number kept, fully blank rows
// skipped. No business rule lives here — the server checks every row, for the
// Preview and the Import alike. The only stops are the ones the request
// itself could not carry: no sheet, a missing column, too many rows, a cell
// longer than the contract allows.

import { ML_BOM_IMPORT_MAX_ROWS, type MlBomImportRow, mlBomImportRowSchema } from '@innovic/shared';
import { normalizeHeaderKey } from '@/lib/xlsx-import';
import { ML_BOM_TEMPLATE_SHEET } from './ml-bom-import-template';

type RowField = Exclude<keyof MlBomImportRow, 'rowNum'>;

interface ColSpec {
  field: RowField;
  /** The template header first; older names after it. */
  headers: string[];
  required: boolean;
}

const COLS: ColSpec[] = [
  { field: 'bomItemCode', headers: ['BOM Item Code'], required: true },
  { field: 'childItemCode', headers: ['Child Item Code'], required: true },
  { field: 'qtyPerSet', headers: ['Qty per Set'], required: true },
  { field: 'lineType', headers: ['Line Type', 'Line Kind'], required: true },
  { field: 'rawMaterialGrade', headers: ['RM Grade'], required: false },
  { field: 'rawMaterialSize', headers: ['RM Size'], required: false },
  { field: 'remarks', headers: ['Line Remarks'], required: false },
];

const HEADER_OF: Record<RowField, string> = Object.fromEntries(
  COLS.map((c) => [c.field, c.headers[0] ?? c.field]),
) as Record<RowField, string>;

export interface MlBomSheetParse {
  rows: MlBomImportRow[];
  /** Set when the file cannot be sent at all; nothing else is shown. */
  fatal?: string;
}

interface SheetCell {
  t?: string;
  v?: unknown;
  w?: string;
}

/** Cell → text. Qty keeps full precision from the number; everything else is
 *  the text Excel shows (a code typed into a Text cell arrives as typed). */
function cellText(cell: SheetCell | undefined, field: RowField): string {
  if (!cell) return '';
  if (cell.t === 'n' && field === 'qtyPerSet' && typeof cell.v === 'number') {
    return String(cell.v);
  }
  if (typeof cell.w === 'string') return cell.w.trim();
  if (cell.v === undefined || cell.v === null) return '';
  return String(cell.v as string | number | boolean).trim();
}

export async function parseMlBomWorkbook(buf: ArrayBuffer): Promise<MlBomSheetParse> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', cellText: true, cellDates: false });
  const sheetName = wb.SheetNames.includes(ML_BOM_TEMPLATE_SHEET)
    ? ML_BOM_TEMPLATE_SHEET
    : wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) return { rows: [], fatal: 'The file has no sheets.' };
  const ref = ws['!ref'];
  if (!ref) return { rows: [], fatal: 'The sheet has no rows.' };
  const range = XLSX.utils.decode_range(ref);

  // Header row = first row of the sheet's used range.
  const headerRow = range.s.r;
  const colOfHeader = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })] as SheetCell | undefined;
    const key = normalizeHeaderKey(cellText(cell, 'remarks'));
    if (key && !colOfHeader.has(key)) colOfHeader.set(key, c);
  }
  const colOf = new Map<RowField, number>();
  const missing: string[] = [];
  for (const spec of COLS) {
    const c = spec.headers
      .map((h) => colOfHeader.get(normalizeHeaderKey(h)))
      .find((x) => x !== undefined);
    if (c !== undefined) colOf.set(spec.field, c);
    else if (spec.required) missing.push(spec.headers[0] ?? spec.field);
  }
  if (missing.length > 0) {
    return {
      rows: [],
      fatal: `Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    };
  }

  const rows: MlBomImportRow[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const text = (field: RowField): string => {
      const c = colOf.get(field);
      if (c === undefined) return '';
      return cellText(ws[XLSX.utils.encode_cell({ r, c })] as SheetCell | undefined, field);
    };
    const row: MlBomImportRow = {
      rowNum: r + 1,
      bomItemCode: text('bomItemCode'),
      childItemCode: text('childItemCode'),
      qtyPerSet: text('qtyPerSet'),
      lineType: text('lineType'),
      rawMaterialGrade: text('rawMaterialGrade') || null,
      rawMaterialSize: text('rawMaterialSize') || null,
      remarks: text('remarks') || null,
    };
    const blank =
      !row.bomItemCode &&
      !row.childItemCode &&
      !row.qtyPerSet &&
      !row.lineType &&
      !row.rawMaterialGrade &&
      !row.rawMaterialSize &&
      !row.remarks;
    if (blank) continue;
    rows.push(row);
    if (rows.length > ML_BOM_IMPORT_MAX_ROWS) break;
  }

  if (rows.length === 0) return { rows: [], fatal: 'The sheet has no rows.' };
  if (rows.length > ML_BOM_IMPORT_MAX_ROWS) {
    return {
      rows: [],
      fatal: `More than ${ML_BOM_IMPORT_MAX_ROWS} rows. Split the file.`,
    };
  }
  // The contract's own length limits — a longer cell would refuse the whole
  // request with no row to point at.
  for (const row of rows) {
    const check = mlBomImportRowSchema.safeParse(row);
    if (!check.success) {
      const field = check.error.issues[0]?.path[0];
      const label =
        typeof field === 'string' && field in HEADER_OF ? HEADER_OF[field as RowField] : 'A cell';
      return { rows: [], fatal: `Sheet row ${row.rowNum}: ${label} is too long.` };
    }
  }
  return { rows };
}

export async function parseMlBomFile(file: File): Promise<MlBomSheetParse> {
  return parseMlBomWorkbook(await file.arrayBuffer());
}
