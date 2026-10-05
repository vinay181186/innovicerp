// Import-template workbook builder — ONE builder for every "Excel Template"
// button in the app (NAMING.md: the button is `Excel Template`).
//
// Why this lives on the SERVER while the master templates are still built in
// the browser (apps/web/src/modules/<master>/lib/import-export.ts): SheetJS,
// the browser library, silently DROPS data validation, so a dropdown cannot be
// written there — verified against xlsx 0.18.5. ExcelJS can, and it is already
// a dependency here (lib/excel.ts, report exports). A screen that wants
// dropdowns therefore asks the API for its template; the rest keep SheetJS
// until they are moved over, one column list at a time.
//
// The dropdown GUIDES, it does not enforce: a paste or an older saved template
// bypasses Excel validation entirely. Every importer still checks each value
// against the master when the file comes back in — that check is the rule, this
// file is the convenience.
//
// Sheet 2 is named "Lists", matching the tab the browser-built templates
// already write (apps/web/src/lib/master-import.ts appendListsSheet), so the
// two generations of template read the same way.

import ExcelJS from 'exceljs';

/** ExcelJS carries a worksheet-level validation collection at runtime but does
 *  not declare it — its .d.ts types only the per-CELL `.dataValidation`
 *  (index.d.ts:455, and the worksheet's own `dataValidations` line is commented
 *  out at :987). Per cell is exactly what must not be used here: ExcelJS merges
 *  those keys with a string sort, so "C10" lands before "C2" and each column
 *  comes out as two overlapping sqrefs, which Excel treats as corrupt content
 *  and repairs by deleting every dropdown. Hence this narrow view of the real
 *  object rather than `any`. */
interface RangedDataValidations {
  add(range: string, validation: ExcelJS.DataValidation): void;
}
function rangedValidations(sheet: ExcelJS.Worksheet): RangedDataValidations {
  return (sheet as unknown as { dataValidations: RangedDataValidations }).dataValidations;
}

/** Rows below the header that carry the dropdown. Beyond this a pasted row
 *  still imports — the importer, not Excel, is what validates it. */
const VALIDATED_ROWS = 1000;

const HEADER_FILL = 'FFEFF4FA';

export interface ImportTemplateColumn {
  /** Header cell text. House convention marks a required column with "*". */
  label: string;
  /** Value for each example row under the header. Blank where omitted. */
  samples?: ReadonlyArray<string | number>;
  /** Present = this column gets an Excel dropdown of exactly these values,
   *  listed on the "Lists" tab. Sorted and de-duplicated here, so callers can
   *  pass a master list straight through. */
  options?: readonly string[];
  /** Column width in characters. Derived from the header when omitted. */
  width?: number;
}

export interface BuildImportTemplateInput {
  /** Tab 1's name — what the importer reads (it always reads the FIRST sheet). */
  sheetName: string;
  columns: readonly ImportTemplateColumn[];
  /** How many example rows to write. Default 2. */
  sampleRows?: number;
}

/** Excel column letter for a 1-based index (1 → A, 27 → AA). */
function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Build an import template: a header row, a couple of example rows, a "Lists"
 * tab holding every allowed value, and a real Excel dropdown on each column
 * that has one.
 */
export async function buildImportTemplateBuffer(input: BuildImportTemplateInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Innovic ERP';
  const sheet = wb.addWorksheet(input.sheetName);

  sheet.columns = input.columns.map((c) => ({
    header: c.label,
    width: c.width ?? Math.max(14, c.label.length + 4),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const sampleRows = input.sampleRows ?? 2;
  for (let r = 0; r < sampleRows; r++) {
    sheet.addRow(input.columns.map((c) => c.samples?.[r] ?? ''));
  }

  // The "Lists" tab: one column per dropdown, so the values can also be read,
  // searched and filtered by hand — which is how an Excel build without the
  // searchable dropdown (it arrived in a 2024 Microsoft 365 update) finds a
  // value in a long list.
  const withOptions = input.columns
    .map((c, i) => ({ column: c, index: i + 1 }))
    .filter(
      (x): x is { column: ImportTemplateColumn & { options: readonly string[] }; index: number } =>
        Array.isArray(x.column.options),
    );

  if (withOptions.length > 0) {
    const lists = wb.addWorksheet('Lists');
    lists.getRow(1).font = { bold: true };

    withOptions.forEach((x, listIdx) => {
      const values = [...new Set(x.column.options)].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );
      const letter = columnLetter(listIdx + 1);
      const header = x.column.label.replace(/\*$/, '').trim();
      lists.getCell(`${letter}1`).value = header;
      values.forEach((v, i) => {
        lists.getCell(`${letter}${i + 2}`).value = v;
      });
      lists.getColumn(listIdx + 1).width = Math.max(
        header.length + 2,
        ...values.map((v) => v.length + 2),
      );

      // An empty master would make `Lists!$A$2:$A$1` — an invalid range Excel
      // refuses to open the file over. No values, no dropdown.
      if (values.length === 0) return;
      // NO leading "=" : OOXML's formula1 holds the formula TEXT, and Excel
      // writes `Lists!$A$2:$A$4`. An "=" here makes Excel repair the file and
      // throw the validation away.
      const range = `Lists!$${letter}$2:$${letter}$${values.length + 1}`;
      const targetLetter = columnLetter(x.index);
      // ONE ranged validation, not one per cell. Setting `.dataValidation` on
      // each cell puts 1000 keys in the model, and ExcelJS sorts those keys as
      // STRINGS when it merges them — "C10" before "C2" — so each column came
      // out as two OVERLAPPING sqrefs (C10:C1001 and C2:C1001). A cell may
      // carry only one validation, so Excel calls the file corrupt and drops
      // every dropdown. This also keeps the sheet dimension at the real data
      // instead of stretching it to row 1001.
      rangedValidations(sheet).add(`${targetLetter}2:${targetLetter}${VALIDATED_ROWS + 1}`, {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: `${header} not in the list`,
        error: `Pick a ${header} from the dropdown, or add it in the master first.`,
      });
    });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
