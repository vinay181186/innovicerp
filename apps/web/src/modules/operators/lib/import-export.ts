// Operator Master — Excel template + import parsing. Mirror of the Vendor
// importer (apps/web/src/modules/vendors/lib/import-export.ts): download a blank
// template + parse an .xlsx of operator rows into create payloads. Uses SheetJS.
//
// DELTA vs vendors: operators carry no Code column (the server auto-generates the
// next OP-### on import) and no userId column (userId is a UUID link to a login,
// not user-fillable — left unset on import). createOperatorInputSchema keeps
// `skills` as a single free-text string, so it maps 1:1 to a column.

import type { CreateOperatorInput } from '@innovic/shared';
import * as XLSX from 'xlsx';

// No Code column — the server auto-generates the next OP-### on import.
// No userId column — it links to a login and is not user-fillable.
const COLUMNS = ['Name*', 'Department', 'Skills', 'Status (Active/Inactive)'] as const;

function getCol(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) {
      const s = String(row[k]).trim();
      if (s !== '') return s;
    }
  }
  return '';
}

export function downloadOperatorTemplate(): void {
  const sample = ['Ramesh Kumar', 'CNC', 'Turning, Milling', 'Active'];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [22, 16, 26, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Operators');
  XLSX.writeFile(wb, 'Operator_Import_Template.xlsx');
}

export interface OperatorImportResult {
  payloads: CreateOperatorInput[];
  errors: string[];
}

export async function parseOperatorImportFile(file: File): Promise<OperatorImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const errors: string[] = [];
  const payloads: CreateOperatorInput[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    // Code is optional — the server auto-generates the next OP-### when it is
    // omitted. A file that still carries a Code column is honoured if present.
    const code = getCol(r, ['Code*', 'Code', 'code', 'Operator ID', 'Operator Code']);
    const name = getCol(r, ['Name*', 'Name', 'name', 'Operator Name']);
    if (!code && !name) return;
    if (!name) {
      errors.push(`Row ${rowNum}: Name is required — skipped`);
      return;
    }
    if (code && seen.has(code)) {
      errors.push(`Row ${rowNum}: Code "${code}" is repeated in the file — skipped`);
      return;
    }
    if (code) seen.add(code);
    const statusRaw = getCol(r, ['Status (Active/Inactive)', 'Status', 'status']);
    payloads.push({
      code: code || undefined,
      name,
      department: getCol(r, ['Department', 'department']) || undefined,
      skills: getCol(r, ['Skills', 'skills']) || undefined,
      isActive: !(statusRaw && statusRaw.toLowerCase().includes('inact')),
    });
  });

  return { payloads, errors };
}
