// Import templates — ONE registry for every "Excel Template" button
// (docs/NAMING.md). A template is a list of columns plus the permission its
// screen needs; lib/excel-template.ts turns that into the workbook, and any
// column with `options` gets a REAL Excel dropdown fed from the live master.
//
// Why the server builds these at all: SheetJS, the browser library the old
// per-module builders used, silently drops Excel data validation, so a dropdown
// cannot be written there (verified — writing one and parsing the output back
// gives null). ExcelJS can, and it is already a dependency here.
//
// Adding a template = one entry below. No new route, no new file.
//
// A dropdown GUIDES only: a paste, or an older saved template, bypasses Excel
// validation entirely. Every importer still checks each value against the
// master when the file comes back in — that check is the rule.

import {
  GST_CATEGORIES,
  GST_CATEGORY_LABEL,
  INDIAN_STATES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_PROCUREMENT_TYPES,
  ITEM_TYPES,
  itemTypeLabel,
  UOMS,
} from '@innovic/shared';
import { type AuthContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { NotFoundError } from '../../lib/errors';
import { buildImportTemplateBuffer, type ImportTemplateColumn } from '../../lib/excel-template';
import { listItems } from '../items/service';

/** Active / Inactive, spelled the way every master importer reads it. */
const STATUS_VALUES = ['Active', 'Inactive'];

/** The page cap listItems enforces (listItemsQuerySchema: limit max 1000). */
const ITEM_PAGE = 1000;
/** Above this an Excel dropdown stops being a help, so the column goes back to
 *  free text — the importer checks every code against Item Master either way. */
const ITEM_DROPDOWN_MAX = 3000;

/**
 * Every item code, paged. A single 1000-row read would silently drop the
 * dropdown the day Item Master passes 1000. Returns [] when the master is
 * larger than a dropdown can usefully hold.
 */
export async function listAllItemCodes(user: AuthContext): Promise<string[]> {
  const codes: string[] = [];
  for (let offset = 0; offset < ITEM_DROPDOWN_MAX; offset += ITEM_PAGE) {
    // sortBy code: paging without an explicit order can repeat or skip a row
    // when the master changes between pages.
    const page = await listItems(
      { limit: ITEM_PAGE, offset, sortBy: 'code', sortDir: 'asc', sf: undefined },
      user,
    );
    if (page.total > ITEM_DROPDOWN_MAX) return [];
    codes.push(...page.items.map((i) => i.code));
    if (codes.length >= page.total || page.items.length === 0) break;
  }
  return codes;
}

/** Item Code column with the live master behind it, or free text when the
 *  master is too big to list. Shared by every line-level template. */
async function itemCodeColumn(
  user: AuthContext,
  label: string,
  samples: string[],
): Promise<ImportTemplateColumn> {
  const codes = await listAllItemCodes(user);
  return {
    label,
    samples,
    width: 24,
    ...(codes.length > 0 ? { options: codes } : {}),
  };
}

export interface ImportTemplateSpec {
  /** Downloaded file name, and the label the screen's button carries. */
  fileName: string;
  /** Tab 1 — the sheet every importer reads. */
  sheetName: string;
  /** The form whose "view" right this template's data belongs to. */
  form: Parameters<typeof requireFormAccess>[1];
  columns: (user: AuthContext) => Promise<ImportTemplateColumn[]>;
}

/** Registry key → spec. The key is what the URL carries. */
export const IMPORT_TEMPLATES: Record<string, ImportTemplateSpec> = {
  // ── Line-level templates: a live Item Code dropdown ────────────────────
  'so-lines': {
    fileName: 'SO Lines Import Template.xlsx',
    sheetName: 'SO Lines',
    form: 'so_create',
    columns: async (user) => [
      await itemCodeColumn(user, 'Item Code', ['ITM-001']),
      // Material stays free text: a customer's drawing may name a material
      // that is not in the Grade master, and this column has never been
      // master-backed (owner's call 2026-10-05).
      { label: 'Material', samples: ['EN8'] },
      { label: 'Drawing No.', samples: ['DRG-001'] },
      { label: 'Drawing Rev', samples: ['A'], width: 12 },
      { label: 'POL', samples: ['1'], width: 10 },
      { label: 'Order Qty', samples: ['100'], width: 12 },
      { label: 'Rate', samples: ['250'], width: 12 },
      { label: 'Due Date', samples: ['2026-07-01'], width: 14 },
    ],
  },
  'jw-lines': {
    fileName: 'JW Lines Import Template.xlsx',
    sheetName: 'JW Lines',
    form: 'jw_create',
    columns: async (user) => [
      await itemCodeColumn(user, 'Item Code', ['ITM-001']),
      { label: 'Material', samples: ['EN8'] },
      { label: 'Drawing No.', samples: ['DRG-001'] },
      { label: 'Drawing Rev', samples: ['A'], width: 12 },
      { label: 'Order Qty', samples: ['10'], width: 12 },
      { label: 'Rate', samples: ['35.50'], width: 12 },
      { label: 'Due Date', samples: ['2026-07-01'], width: 14 },
    ],
  },
  'stock-count': {
    fileName: 'Stock Count Import Template.xlsx',
    sheetName: 'Stock Count',
    form: 'stockcount_create',
    columns: async (user) => [
      await itemCodeColumn(user, 'Item Code*', ['ITM-001']),
      { label: 'Counted Qty*', samples: ['25'], width: 14 },
      { label: 'Reason', samples: ['Cycle count'], width: 28 },
    ],
  },

  // ── Master templates: fixed-list dropdowns. These four already shipped a
  // "Lists" tab with exactly these values — it just had no dropdown on it.
  items: {
    fileName: 'Item Master Import Template.xlsx',
    sheetName: 'Items',
    form: 'item_create',
    // No Item Code dropdown: this template CREATES items.
    columns: async () => [
      { label: 'Item Code*', samples: ['ITM-001'], width: 20 },
      { label: 'Item Name*', samples: ['Shaft 50mm'], width: 28 },
      { label: 'Description', samples: ['Main drive shaft'], width: 30 },
      // ADR-217 — no Material column: the Item Master form no longer offers the
      // field, so the blank sheet must not invite a grade either. (The SO-line
      // and JW-line templates above keep theirs — a different fact, and the
      // owner's 2026-10-05 call is that it stays free text.)
      { label: 'UOM', samples: ['NOS'], options: [...UOMS], width: 12 },
      {
        label: 'Item Type*',
        samples: ['Component'],
        options: ITEM_TYPES.map((t) => itemTypeLabel(t)),
        width: 22,
      },
      {
        label: 'Source',
        samples: ['Make'],
        options: ITEM_PROCUREMENT_TYPES.map((p) => ITEM_PROCUREMENT_TYPE_LABEL[p]),
        width: 14,
      },
      { label: 'HSN Code', samples: ['73269099'], width: 14 },
    ],
  },
  clients: {
    fileName: 'Customer Import Template.xlsx',
    sheetName: 'Customers',
    form: 'client_create',
    columns: async () => [
      { label: 'Code', samples: ['CL-001'], width: 14 },
      { label: 'Customer Name*', samples: ['Alstom Bharat Forge'], width: 30 },
      {
        label: 'GST Category',
        samples: [GST_CATEGORY_LABEL[GST_CATEGORIES[0]]],
        options: GST_CATEGORIES.map((c) => GST_CATEGORY_LABEL[c]),
        width: 22,
      },
      { label: 'GSTIN', samples: ['24AAACC1234A1Z5'], width: 20 },
      { label: 'Address', samples: ['Plot 42, GIDC'], width: 30 },
      { label: 'City', samples: ['Ahmedabad'], width: 16 },
      {
        label: 'State',
        samples: ['Gujarat'],
        options: INDIAN_STATES.map((s) => s.name),
        width: 22,
      },
      { label: 'Pincode', samples: ['382330'], width: 12 },
      { label: 'Contact Person', samples: ['R. Shah'], width: 20 },
      { label: 'Phone', samples: ['9876543210'], width: 16 },
      { label: 'Email', samples: ['purchase@example.com'], width: 24 },
      { label: 'Payment Days', samples: ['30'], width: 14 },
      {
        label: 'Status (Active/Inactive)',
        samples: ['Active'],
        options: STATUS_VALUES,
        width: 22,
      },
    ],
  },
  vendors: {
    fileName: 'Vendor Import Template.xlsx',
    sheetName: 'Vendors',
    form: 'vendor_create',
    columns: async () => [
      { label: 'Code', samples: ['VN-001'], width: 14 },
      { label: 'Vendor Name*', samples: ['Precision Heat Treat'], width: 30 },
      {
        label: 'GST Category',
        samples: [GST_CATEGORY_LABEL[GST_CATEGORIES[0]]],
        options: GST_CATEGORIES.map((c) => GST_CATEGORY_LABEL[c]),
        width: 22,
      },
      { label: 'GSTIN', samples: ['24AAACC1234A1Z5'], width: 20 },
      { label: 'Address', samples: ['Plot 42, GIDC'], width: 30 },
      { label: 'City', samples: ['Ahmedabad'], width: 16 },
      {
        label: 'State',
        samples: ['Gujarat'],
        options: INDIAN_STATES.map((s) => s.name),
        width: 22,
      },
      { label: 'Pincode', samples: ['382330'], width: 12 },
      { label: 'Contact Person', samples: ['R. Shah'], width: 20 },
      { label: 'Phone', samples: ['9876543210'], width: 16 },
      { label: 'Email', samples: ['sales@example.com'], width: 24 },
      { label: 'Payment Terms (days)', samples: ['30'], width: 20 },
      { label: 'Materials/Services', samples: ['Heat treatment'], width: 24 },
      { label: 'Rating (A/B/C)', samples: ['A'], options: ['A', 'B', 'C'], width: 16 },
      {
        label: 'Status (Active/Inactive)',
        samples: ['Active'],
        options: STATUS_VALUES,
        width: 22,
      },
    ],
  },
  operators: {
    fileName: 'Operator Import Template.xlsx',
    sheetName: 'Operators',
    form: 'operator_create',
    columns: async () => [
      { label: 'Code', samples: ['OP-001'], width: 14 },
      { label: 'Operator Name*', samples: ['Ramesh Patel'], width: 28 },
      // Department stays free text: the only department list this system has
      // belongs to Cost Centres, which is a different vocabulary (owner's
      // call 2026-10-05).
      { label: 'Department', samples: ['Machine Shop'], width: 20 },
      { label: 'Skills', samples: ['CNC turning, VMC'], width: 28 },
      {
        label: 'Status (Active/Inactive)',
        samples: ['Active'],
        options: STATUS_VALUES,
        width: 22,
      },
    ],
  },
};

export async function buildImportTemplate(name: string, user: AuthContext): Promise<Buffer> {
  const spec = IMPORT_TEMPLATES[name];
  if (!spec) throw new NotFoundError(`No import template named "${name}".`);
  await requireFormAccess(user, spec.form, 'view');
  return buildImportTemplateBuffer({
    sheetName: spec.sheetName,
    columns: await spec.columns(user),
  });
}

export function importTemplateFileName(name: string): string {
  return IMPORT_TEMPLATES[name]?.fileName ?? 'Import Template.xlsx';
}
