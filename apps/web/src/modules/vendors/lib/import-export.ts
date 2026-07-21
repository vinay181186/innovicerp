// Vendor Master — Excel template + import parsing. Mirror of legacy
// _vendorTemplate (download a blank template) + _vendorImportExcel (parse an
// .xlsx of vendor rows into create payloads). Uses SheetJS, same shape as the
// SO / Item importers.
//
// DELTA vs legacy: legacy concatenated Address+City+State+PIN into one field;
// our schema keeps them separate, so we map each column to its own field.
// Status "Inactive" → isActive=false; rating keeps just the first letter.

import type { CreateVendorInput } from '@innovic/shared';
import * as XLSX from 'xlsx';

// No Code column — the server auto-generates the next VND-### on import.
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
  'Materials/Services',
  'Rating (A/B/C)',
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

export function downloadVendorTemplate(): void {
  const sample = [
    'ABC Engineering', 'Mr. Patel', '9876543210', 'abc@email.com', '24AABCU9603R1ZN',
    '123 Industrial Area', 'Ahmedabad', 'Gujarat', '380015', 'CNC Machining, Turning', 'A', 'Active',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [20, 18, 14, 22, 18, 30, 14, 12, 8, 25, 12, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  XLSX.writeFile(wb, 'Vendor_Import_Template.xlsx');
}

export interface VendorImportResult {
  payloads: CreateVendorInput[];
  errors: string[];
}

export async function parseVendorImportFile(file: File): Promise<VendorImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return { payloads: [], errors: ['Workbook has no sheets'] };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const errors: string[] = [];
  const payloads: CreateVendorInput[] = [];
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    // Code is optional — the server auto-generates the next VND-### when it is
    // omitted. A file that still carries a Code column is honoured if present.
    const code = getCol(r, ['Code*', 'Code', 'code', 'Vendor Code']);
    const name = getCol(r, ['Name*', 'Name', 'name', 'Vendor Name']);
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
    const ratingRaw = getCol(r, ['Rating (A/B/C)', 'Rating', 'rating']);
    const statusRaw = getCol(r, ['Status (Active/Inactive)', 'Status', 'status']);
    const email = getCol(r, ['Email', 'email']);
    payloads.push({
      code: code || undefined,
      name,
      contactPerson: getCol(r, ['Contact Person', 'Contact', 'contact']) || undefined,
      phone: getCol(r, ['Phone', 'phone']) || undefined,
      email: email || '',
      gstNumber: getCol(r, ['GST No.', 'GST', 'gst', 'GST No']) || undefined,
      addressLine1: getCol(r, ['Address', 'address']) || undefined,
      city: getCol(r, ['City', 'city']) || undefined,
      state: getCol(r, ['State', 'state']) || undefined,
      pincode: getCol(r, ['PIN', 'Pincode', 'pincode', 'PinCode']) || undefined,
      materialsSupplied: getCol(r, ['Materials/Services', 'Materials', 'materials']) || undefined,
      rating: ratingRaw ? ratingRaw.toUpperCase().charAt(0) : undefined,
      isActive: !(statusRaw && statusRaw.toLowerCase().includes('inact')),
    });
  });

  return { payloads, errors };
}
