// Customer Master — Excel template + import parsing (ERPNext Data Import
// behaviour, see packages/shared/src/schemas/master-import.ts). Uses SheetJS.
//
// The template carries EVERY customer master field, plus a "Lists" tab with
// the allowed GST Category and State values. The parser only does the
// structural checks (blank name, Code repeated in the file, a GST Category or
// Payment Days that cannot be read); every field rule is the server's, answered
// per row by the preview (dryRun), so there is ONE rule set.
//
// Insert new: Code is optional (the server gives the next CLI-### when blank).
// Update existing: Code is required and is how the row finds its customer; a
// BLANK cell is left out of the payload, so it keeps the current value.

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
  'Customer Name*',
  'GST Category',
  'GSTIN',
  'Address',
  'City',
  'State',
  'Pincode',
  'Contact Person',
  'Phone',
  'Email',
  'Payment Days',
  'Status (Active/Inactive)',
] as const;

export function downloadClientTemplate(): void {
  const sample = [
    '',
    'ABC Industries',
    'Registered Regular',
    '24AABCU9603R1ZN',
    '12 MG Road',
    'Ahmedabad',
    'Gujarat',
    '380001',
    'Mr. Shah',
    '9876543210',
    'abc@email.com',
    '30',
    'Active',
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNS as unknown as string[], sample]);
  ws['!cols'] = [12, 22, 22, 18, 30, 14, 16, 8, 18, 14, 22, 12, 18].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  appendListsSheet(wb, [
    { header: 'GST Category', values: GST_CATEGORIES.map((c) => GST_CATEGORY_LABEL[c]) },
    { header: 'State', values: INDIAN_STATES.map((s) => s.name) },
    { header: 'State Code', values: INDIAN_STATES.map((s) => s.code) },
    { header: 'Status (Active/Inactive)', values: ['Active', 'Inactive'] },
  ]);
  XLSX.writeFile(wb, 'Customer Import Template.xlsx');
}

export async function parseClientImportFile(
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
    const code = getCol(r, ['Code*', 'Code', 'code', 'Customer Code', 'Client Code']);
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
    const skip = (reason: string): void => {
      skipped.push({ rowNum, code: code || null, name, reason });
    };
    if (isUpdate && !code) return skip('Code is required to update a customer');
    if (!isUpdate && !name) return skip('Customer Name is required');
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
      getCol(r, ['Payment Days', 'Credit Days', 'payment_days']),
      'Payment Days',
    );
    if (days.error) return skip(days.error);
    if (days.value !== undefined) payload.paymentDays = days.value;

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
