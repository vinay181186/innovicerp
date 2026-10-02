// Operator Master — Excel template + import parsing (ERPNext Data Import
// behaviour, see packages/shared/src/schemas/master-import.ts). Uses SheetJS.
//
// Mirror of the Vendor importer (apps/web/src/modules/vendors/lib/import-export.ts):
// the parser only does the STRUCTURAL checks (no name, no Code in Update mode,
// a Code repeated in the file); every field rule and every duplicate check
// against the saved master is the server's, answered per row by the preview
// (dryRun). One bad row is reported and left out instead of rejecting the sheet.
//
// Insert new: Code is optional (the server gives the next OP-### when blank).
// Update existing: Code is required and is how the row finds its operator; a
// BLANK cell is left out of the payload, so it keeps the current value. That is
// why the template now carries a Code column — a sheet without it cannot be
// used for updates.
//
// DELTA vs vendors: operators carry no userId column (userId is a UUID link to
// a login, not user-fillable — left unset on import). createOperatorInputSchema
// keeps `skills` as a single free-text string, so it maps 1:1 to a column.

import type { MasterImportMode } from '@innovic/shared';
import * as XLSX from 'xlsx';

import {
  appendListsSheet,
  putIfFilled,
  type MasterImportParse,
  type ParsedImportRow,
  type ParsedImportSkip,
} from '@/lib/master-import';
import { getCol, parseActiveStatus, readSheetRows } from '@/lib/xlsx-import';

// No userId column — it links to a login and is not user-fillable.
// The header names are the ones the server's refusal messages use
// (OPERATOR_IMPORT_LABELS in apps/api/src/modules/operators/service.ts).
const COLUMNS = [
  'Code',
  'Operator Name*',
  'Department',
  'Skills',
  'Status (Active/Inactive)',
] as const;

export function downloadOperatorTemplate(): void {
  const sample = ['', 'Ramesh Kumar', 'CNC', 'Turning, Milling', 'Active'];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [12, 22, 16, 26, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Operators');
  appendListsSheet(wb, [{ header: 'Status (Active/Inactive)', values: ['Active', 'Inactive'] }]);
  XLSX.writeFile(wb, 'Operator Import Template.xlsx');
}

export async function parseOperatorImportFile(
  file: File,
  mode: MasterImportMode,
): Promise<MasterImportParse> {
  const { rows: sheet, sheetError } = await readSheetRows(file);
  if (sheetError) return { rows: [], skipped: [], fatal: sheetError, notes: [] };

  const rows: ParsedImportRow[] = [];
  const skipped: ParsedImportSkip[] = [];
  const seen = new Set<string>();
  const isUpdate = mode === 'update';

  sheet.forEach((r, i) => {
    const rowNum = i + 2;
    const code = getCol(r, ['Code*', 'Code', 'code', 'Operator ID', 'Operator Code']);
    // 'Operator Name*' is the template header since 2026-09-26; older sheets carry 'Name*'.
    const name = getCol(r, ['Operator Name*', 'Operator Name', 'Name*', 'Name', 'name']);
    if (!code && !name) return;
    const skip = (reason: string): void => {
      skipped.push({ rowNum, code: code || null, name, reason });
    };
    if (isUpdate && !code) return skip('Code is required to update an operator');
    if (!isUpdate && !name) return skip('Operator Name is required');
    const codeKey = code.toLowerCase();
    if (code && seen.has(codeKey)) return skip(`Code "${code}" is repeated in the file`);
    if (code) seen.add(codeKey);

    const payload: Record<string, unknown> = {};
    const warnings: string[] = [];
    putIfFilled(payload, 'code', code);
    putIfFilled(payload, 'name', name);
    putIfFilled(payload, 'department', getCol(r, ['Department', 'department']));
    putIfFilled(payload, 'skills', getCol(r, ['Skills', 'Skills / Machines', 'skills']));

    const statusRaw = getCol(r, ['Status (Active/Inactive)', 'Status', 'status']);
    if (statusRaw) {
      const status = parseActiveStatus(statusRaw);
      // Update Existing must never guess: a status nobody can read would
      // overwrite a saved one, so the row is left out with its reason. In
      // Insert new it defaults to Active, said out loud as a warning.
      if (status.warning && isUpdate) {
        return skip(`Status "${statusRaw}" is not Active or Inactive`);
      }
      if (status.warning) warnings.push(status.warning);
      payload.isActive = status.value;
    }

    rows.push({ rowNum, payload, code: code || null, name, warnings });
  });

  return { rows, skipped, notes: [] };
}
