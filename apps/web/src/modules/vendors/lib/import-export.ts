// Vendor Master — Excel template + import parsing (ERPNext Data Import
// behaviour, see packages/shared/src/schemas/master-import.ts). Uses SheetJS.
//
// The template carries EVERY vendor master field, plus a "Lists" tab with the
// allowed GST Category, State and Rating values. The parser only does the
// structural checks (blank name, Code repeated in the file, a GST Category or
// Payment Terms (days) that cannot be read); every field rule — the email
// included — is the server's, answered per row by the preview (dryRun). One
// bad email no longer rejects the whole sheet (audit finding 35).
//
// Insert new: Code is optional (the server gives the next VND-### when blank).
// Update existing: Code is required and is how the row finds its vendor; a
// BLANK cell is left out of the payload, so it keeps the current value.
//
// DELTA vs legacy: legacy concatenated Address+City+State+PIN into one field;
// our schema keeps them separate, so each column maps to its own field.

import {
  GST_CATEGORIES,
  GST_CATEGORY_LABEL,
  INDIAN_STATES,
  resolveGstCategory,
  type MasterImportMode,
} from '@innovic/shared';
import * as XLSX from 'xlsx';

import {
  appendListsSheet,
  parseWholeDays,
  putIfFilled,
  type MasterImportParse,
  type ParsedImportRow,
  type ParsedImportSkip,
} from '@/lib/master-import';
import { getCol, parseActiveStatus, readSheetRows } from '@/lib/xlsx-import';

const COLUMNS = [
  'Code',
  'Vendor Name*',
  'GST Category',
  'GSTIN',
  'Address',
  'City',
  'State',
  'Pincode',
  'Contact Person',
  'Phone',
  'Email',
  'Payment Terms (days)',
  'Materials/Services',
  'Rating (A/B/C)',
  'Status (Active/Inactive)',
] as const;

export function downloadVendorTemplate(): void {
  const sample = [
    '',
    'ABC Engineering',
    'Registered Regular',
    '24AABCU9603R1ZN',
    '123 Industrial Area',
    'Ahmedabad',
    'Gujarat',
    '380015',
    'Mr. Patel',
    '9876543210',
    'abc@email.com',
    '45',
    'CNC Machining, Turning',
    'A',
    'Active',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [12, 20, 22, 18, 30, 14, 16, 8, 18, 14, 22, 20, 25, 14, 18].map((wch) => ({
    wch,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  appendListsSheet(wb, [
    { header: 'GST Category', values: GST_CATEGORIES.map((c) => GST_CATEGORY_LABEL[c]) },
    { header: 'State', values: INDIAN_STATES.map((s) => s.name) },
    { header: 'State Code', values: INDIAN_STATES.map((s) => s.code) },
    { header: 'Rating (A/B/C)', values: ['A', 'B', 'C'] },
    { header: 'Status (Active/Inactive)', values: ['Active', 'Inactive'] },
  ]);
  XLSX.writeFile(wb, 'Vendor Import Template.xlsx');
}

export async function parseVendorImportFile(
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
    const code = getCol(r, ['Code*', 'Code', 'code', 'Vendor Code']);
    // Headers renamed 2026-09-26 (Name → Vendor Name, GST No. → GSTIN, PIN →
    // Pincode); the old names stay in each alias list so older sheets import.
    const name = getCol(r, ['Vendor Name*', 'Vendor Name', 'Name*', 'Name', 'name']);
    if (!code && !name) return;
    const skip = (reason: string): void => {
      skipped.push({ rowNum, code: code || null, name, reason });
    };
    if (isUpdate && !code) return skip('Code is required to update a vendor');
    if (!isUpdate && !name) return skip('Vendor Name is required');
    const codeKey = code.toLowerCase();
    if (code && seen.has(codeKey)) return skip(`Code "${code}" is repeated in the file`);
    if (code) seen.add(codeKey);

    const payload: Record<string, unknown> = {};
    const warnings: string[] = [];
    putIfFilled(payload, 'code', code);
    putIfFilled(payload, 'name', name);

    const gstRaw = getCol(r, ['GST Category', 'GST Type', 'gst_category']);
    if (gstRaw) {
      const cat = resolveGstCategory(gstRaw);
      if (!cat) {
        return skip(
          `GST Category "${gstRaw}" is not one of ${GST_CATEGORIES.map((c) => GST_CATEGORY_LABEL[c]).join(' / ')}`,
        );
      }
      payload.gstCategory = cat;
    }
    putIfFilled(payload, 'gstNumber', getCol(r, ['GSTIN', 'GST No.', 'GST', 'gst', 'GST No']));
    putIfFilled(payload, 'addressLine1', getCol(r, ['Address', 'address']));
    putIfFilled(payload, 'city', getCol(r, ['City', 'city']));
    // Free text / "24" / "Gujarat" — the server resolves it to a State Code.
    putIfFilled(payload, 'state', getCol(r, ['State', 'state']));
    putIfFilled(payload, 'pincode', getCol(r, ['Pincode', 'PIN', 'pincode', 'PinCode']));
    putIfFilled(payload, 'contactPerson', getCol(r, ['Contact Person', 'Contact', 'contact']));
    putIfFilled(payload, 'phone', getCol(r, ['Phone', 'phone']));
    putIfFilled(payload, 'email', getCol(r, ['Email', 'email']));

    const days = parseWholeDays(
      getCol(r, ['Payment Terms (days)', 'Payment Terms', 'Payment Days', 'Credit Days']),
      'Payment Terms (days)',
    );
    if (days.error) return skip(days.error);
    if (days.value !== undefined) payload.paymentTermsDays = days.value;

    putIfFilled(
      payload,
      'materialsSupplied',
      getCol(r, ['Materials/Services', 'Materials', 'materials']),
    );

    // Legacy behaviour: the first letter, upper-cased. A longer value is
    // shortened — said out loud as a warning, never silently.
    const ratingRaw = getCol(r, ['Rating (A/B/C)', 'Rating', 'rating']);
    if (ratingRaw) {
      const rating = ratingRaw.toUpperCase().charAt(0);
      if (ratingRaw.length > 1) warnings.push(`Rating "${ratingRaw}" stored as "${rating}"`);
      payload.rating = rating;
    }

    const statusRaw = getCol(r, ['Status (Active/Inactive)', 'Status', 'status']);
    if (statusRaw) {
      const status = parseActiveStatus(statusRaw);
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
