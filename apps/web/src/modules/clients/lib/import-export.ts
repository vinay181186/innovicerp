// Client Master — Excel template + import parsing. Mirror of the Vendor
// importer (apps/web/src/modules/vendors/lib/import-export.ts): download a blank
// template + parse an .xlsx of client rows into create payloads. Uses SheetJS.
//
// NO Code column — the server auto-generates the next CLI-### in the company
// series on import (createClientInputSchema.code is optional). A file that still
// carries a Code column is honoured if present.

import type { CreateClientInput } from '@innovic/shared';
import * as XLSX from 'xlsx';

// No Code column — the server auto-generates the next CLI-### on import.
const COLUMNS = [
  'Name*',
  'Contact Person',
  'Phone',
  'Email',
  'GST No.',
  'Address',
  'City',
  'State',
  'PIN',
  'Status (Active/Inactive)',
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

export function downloadClientTemplate(): void {
  const sample = [
    'ABC Industries', 'Mr. Shah', '9876543210', 'abc@email.com', '24AABCU9603R1ZN',
    '12 MG Road', 'Ahmedabad', 'Gujarat', '380001', 'Active',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [22, 18, 14, 22, 18, 30, 14, 12, 8, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  XLSX.writeFile(wb, 'Client_Import_Template.xlsx');
}

export interface ClientImportResult {
  payloads: CreateClientInput[];
  errors: string[];
}

export async function parseClientImportFile(file: File): Promise<ClientImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const errors: string[] = [];
  const payloads: CreateClientInput[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    // Code is optional — the server auto-generates the next CLI-### when it is
    // omitted. A file that still carries a Code column is honoured if present.
    const code = getCol(r, ['Code*', 'Code', 'code', 'Client Code']);
    const name = getCol(r, ['Name*', 'Name', 'name', 'Client Name']);
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
      contactPerson: getCol(r, ['Contact Person', 'Contact', 'contact']) || undefined,
      email: getCol(r, ['Email', 'email']) || undefined,
      phone: getCol(r, ['Phone', 'phone']) || undefined,
      gstNumber: getCol(r, ['GST No.', 'GST', 'gst', 'GST No']) || undefined,
      addressLine1: getCol(r, ['Address', 'address']) || undefined,
      city: getCol(r, ['City', 'city']) || undefined,
      state: getCol(r, ['State', 'state']) || undefined,
      pincode: getCol(r, ['PIN', 'Pincode', 'pincode', 'PinCode']) || undefined,
      isActive: !(statusRaw && statusRaw.toLowerCase().includes('inact')),
    });
  });

  return { payloads, errors };
}
