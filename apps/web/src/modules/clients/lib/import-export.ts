// Client Master — Excel template + import parsing. Mirror of the Vendor
// importer (apps/web/src/modules/vendors/lib/import-export.ts): download a blank
// template + parse an .xlsx of client rows into create payloads. Uses SheetJS.
//
// NO Code column — the server auto-generates the next CLI-### in the company
// series on import (createClientInputSchema.code is optional). A file that still
// carries a Code column is honoured if present.

import { createClientInputSchema, type CreateClientInput } from '@innovic/shared';
import * as XLSX from 'xlsx';

import { getCol, parseActiveStatus, readSheetRows } from '@/lib/xlsx-import';

// No Code column — the server auto-generates the next CLI-### on import.
const COLUMNS = [
  'Customer Name*',
  'Contact Person',
  'Phone',
  'Email',
  'GSTIN',
  'Address',
  'City',
  'State',
  'Pincode',
  'Status (Active/Inactive)',
] as const;

export function downloadClientTemplate(): void {
  const sample = [
    'ABC Industries',
    'Mr. Shah',
    '9876543210',
    'abc@email.com',
    '24AABCU9603R1ZN',
    '12 MG Road',
    'Ahmedabad',
    'Gujarat',
    '380001',
    'Active',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [22, 18, 14, 22, 18, 30, 14, 12, 8, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  XLSX.writeFile(wb, 'Customer Import Template.xlsx');
}

export interface ClientImportResult {
  payloads: CreateClientInput[];
  /** The sheet row (1 = header) each payload came from, same order as
   *  `payloads` — the server names a refused row by its position in the array,
   *  which drifts from the sheet once rows are skipped here. */
  rowNums: number[];
  errors: string[];
}

// Plain-English column names for the per-row check below.
const FIELD_LABEL: Record<string, string> = {
  code: 'Code',
  name: 'Customer Name',
  contactPerson: 'Contact Person',
  email: 'Email',
  phone: 'Phone',
  gstNumber: 'GSTIN',
  addressLine1: 'Address',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
};

/** Check ONE row against the very schema the server applies to every row of
 *  the bulk request. The server parses the whole sheet in one go, so a single
 *  bad value (email "abc@", a 40-digit phone) used to fail the entire import
 *  with "Request validation failed" and no row named. Checking here lets that
 *  row be skipped with its reason and the rest go in. Null = row is fine. */
function rowProblem(payload: CreateClientInput): string | null {
  const res = createClientInputSchema.safeParse(payload);
  if (res.success) return null;
  return res.error.issues
    .map((iss) => {
      const key = String(iss.path[0] ?? '');
      const label = FIELD_LABEL[key] ?? key;
      if (key === 'email') return `Email "${payload.email ?? ''}" is not a valid email address`;
      if (iss.code === 'too_big')
        return `${label} is too long (max ${String(iss.maximum)} characters)`;
      return `${label}: ${iss.message}`;
    })
    .join('; ');
}

export async function parseClientImportFile(file: File): Promise<ClientImportResult> {
  const { rows, sheetError } = await readSheetRows(file);
  if (sheetError) return { payloads: [], rowNums: [], errors: [sheetError] };

  const errors: string[] = [];
  const payloads: CreateClientInput[] = [];
  const rowNums: number[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    // Code is optional — the server auto-generates the next CLI-### when it is
    // omitted. A file that still carries a Code column is honoured if present.
    const code = getCol(r, ['Code*', 'Code', 'code', 'Client Code']);
    // Headers renamed 2026-09-26 (Name → Customer Name, GST No. → GSTIN, PIN →
    // Pincode); the old names stay in each alias list so older sheets import.
    const name = getCol(r, [
      'Customer Name*',
      'Customer Name',
      'Name*',
      'Name',
      'name',
      'Client Name',
    ]);
    if (!code && !name) return;
    if (!name) {
      errors.push(`Row ${rowNum}: Customer Name is required — skipped`);
      return;
    }
    if (code && seen.has(code)) {
      errors.push(`Row ${rowNum}: Code "${code}" is repeated in the file — skipped`);
      return;
    }
    if (code) seen.add(code);
    const statusRaw = getCol(r, ['Status (Active/Inactive)', 'Status', 'status']);
    const status = parseActiveStatus(statusRaw);
    const payload: CreateClientInput = {
      code: code || undefined,
      name,
      contactPerson: getCol(r, ['Contact Person', 'Contact', 'contact']) || undefined,
      email: getCol(r, ['Email', 'email']) || undefined,
      phone: getCol(r, ['Phone', 'phone']) || undefined,
      gstNumber: getCol(r, ['GSTIN', 'GST No.', 'GST', 'gst', 'GST No']) || undefined,
      addressLine1: getCol(r, ['Address', 'address']) || undefined,
      city: getCol(r, ['City', 'city']) || undefined,
      state: getCol(r, ['State', 'state']) || undefined,
      pincode: getCol(r, ['Pincode', 'PIN', 'pincode', 'PinCode']) || undefined,
      isActive: status.value,
    };
    const problem = rowProblem(payload);
    if (problem) {
      errors.push(`Row ${rowNum} "${name}": ${problem} — skipped`);
      return;
    }
    if (status.warning) errors.push(`Row ${rowNum}: ${status.warning}`);
    payloads.push(payload);
    rowNums.push(rowNum);
  });

  return { payloads, rowNums, errors };
}
