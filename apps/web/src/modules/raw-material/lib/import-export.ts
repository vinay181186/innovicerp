// Raw Material Master — Excel template + import parsing for BOTH masters.
// Mirror of the Operator importer (modules/operators/lib/import-export.ts).
//
// DELTA vs operators: neither sheet has a Code column — the server auto-numbers
// GRD-### / SZ-#### on import — and neither carries a Status column, because the
// two templates are deliberately tiny (the whole point is "paste your grade list
// in and go"). Rows import as Active; deactivate from the table afterwards.

import type { CreateMaterialGradeInput, CreateMaterialSizeInput } from '@innovic/shared';
import * as XLSX from 'xlsx';

import { getCol, readSheetRows } from '@/lib/xlsx-import';

const GRADE_COLUMNS = ['Grade*', 'Description'] as const;
const SIZE_COLUMNS = ['Size*', 'Description'] as const;

export function downloadMaterialGradeTemplate(): void {
  const sample = ['EN24', 'Alloy steel, 817M40 equivalent'];
  const ws = XLSX.utils.aoa_to_sheet([GRADE_COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [22, 40].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Grades');
  XLSX.writeFile(wb, 'Material_Grade_Import_Template.xlsx');
}

export function downloadMaterialSizeTemplate(): void {
  const sample = ['Ø30 × 1000', 'Round bar, cut length'];
  const ws = XLSX.utils.aoa_to_sheet([SIZE_COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [26, 40].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sizes');
  XLSX.writeFile(wb, 'Material_Size_Import_Template.xlsx');
}

export interface MaterialImportResult<T> {
  payloads: T[];
  errors: string[];
}

/** Shared row reader for both sheets — the only difference is which header the
 *  name lives under, so the caller passes the aliases and the noun used in the
 *  per-row messages. Duplicate names inside ONE file are refused here; the
 *  duplicate check against rows already in the master is the server's job (it
 *  is the only side that can see the whole master). */
async function parseRows(
  file: File,
  nameAliases: string[],
  noun: string,
): Promise<MaterialImportResult<{ name: string; description?: string }>> {
  const { rows, sheetError } = await readSheetRows(file);
  if (sheetError) return { payloads: [], errors: [sheetError] };

  const errors: string[] = [];
  const payloads: { name: string; description?: string }[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const name = getCol(r, nameAliases);
    const description = getCol(r, ['Description', 'description', 'Remarks', 'Note']);
    if (!name && !description) return;
    if (!name) {
      errors.push(`Row ${rowNum}: ${noun} is required — skipped`);
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Row ${rowNum}: ${noun} "${name}" is repeated in the file — skipped`);
      return;
    }
    seen.add(key);
    payloads.push({ name, ...(description ? { description } : {}) });
  });

  return { payloads, errors };
}

export async function parseMaterialGradeImportFile(
  file: File,
): Promise<MaterialImportResult<CreateMaterialGradeInput>> {
  const { payloads, errors } = await parseRows(
    file,
    ['Grade*', 'Grade', 'grade', 'Material Grade', 'Name'],
    'Grade',
  );
  return { payloads: payloads.map((p) => ({ ...p, isActive: true })), errors };
}

export async function parseMaterialSizeImportFile(
  file: File,
): Promise<MaterialImportResult<CreateMaterialSizeInput>> {
  const { payloads, errors } = await parseRows(
    file,
    ['Size*', 'Size', 'size', 'Material Size', 'Name'],
    'Size',
  );
  return { payloads: payloads.map((p) => ({ ...p, isActive: true })), errors };
}
