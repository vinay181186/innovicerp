// Multi-Level BOM — Excel Template (ADR-225 phase 2).
//
// SheetJS community (the xlsx build this app ships) can write cell values and
// number formats, but NOT data validation (dropdown lists, number limits) and
// NOT fonts. So the .xlsx is assembled here from its OOXML parts and zipped
// with the zip writer SheetJS itself uses (`XLSX.CFB`). That gives:
//   - BOM Item Code / Child Item Code / RM Grade / RM Size columns formatted
//     as Text (column style, so cells typed later keep 00451 and 1-10);
//   - a Line Type list (Manufacture, Buy, Outsource) and Qty per Set > 0
//     validation on every data row the importer accepts;
//   - the example block in blue, the header bold and frozen;
//   - a "Read Me" sheet with the rules.
// xlsx is dynamic-imported so the list page does not load it.

import {
  BOM_LINE_TYPE_LABEL,
  ML_BOM_IMPORT_HEADERS,
  ML_BOM_IMPORT_MAX_ROWS,
} from '@innovic/shared';

export const ML_BOM_TEMPLATE_FILE = 'Multi-Level-BOM-Import.xlsx';
export const ML_BOM_TEMPLATE_SHEET = 'BOM Lines';

/** The parts of XLSX.CFB this file uses (typed `any` by SheetJS). */
interface CfbZip {
  utils: {
    cfb_new: () => unknown;
    cfb_add: (cfb: unknown, name: string, content: Uint8Array) => unknown;
  };
  write: (
    cfb: unknown,
    opts: { fileType: 'zip'; type: 'array'; compression: boolean },
  ) => Uint8Array;
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// cellXfs indexes (see STYLES_XML).
const S_TEXT = 1; // Text number format — the code columns
const S_HEAD = 2; // bold header
const S_EX_TEXT = 3; // example row, Text format, blue
const S_EX = 4; // example row, General, blue
const S_WRAP = 5; // Read Me rule text

/** Excel needs ARGB in the file itself — this is not a screen colour. */
const EXAMPLE_FONT_ARGB = 'FF1F4E9E';

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  `<font><sz val="11"/><color rgb="${EXAMPLE_FONT_ARGB}"/><name val="Calibri"/><family val="2"/></font>` +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COL_LETTERS = 'ABCDEFG';

type Cell = string | number | null;

function cellXml(ref: string, v: Cell, style: number): string {
  if (v === null || v === '') return '';
  if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function rowXml(r: number, cells: Cell[], styleOf: (col: number) => number): string {
  const inner = cells.map((v, i) => cellXml(`${COL_LETTERS[i]}${r}`, v, styleOf(i))).join('');
  return `<row r="${r}">${inner}</row>`;
}

// Columns: A BOM Item Code · B Child Item Code · C Qty per Set · D Line Type ·
// E RM Grade · F RM Size · G Line Remarks.
const TEXT_COLS = new Set([0, 1, 4, 5]);

const EXAMPLE: Cell[][] = [
  ['PS-100', 'MA-10', 1, BOM_LINE_TYPE_LABEL.manufacture, null, null, null],
  ['PS-100', 'BP-200', 1, BOM_LINE_TYPE_LABEL.manufacture, null, null, null],
  ['PS-100', 'CPL-25', 2, BOM_LINE_TYPE_LABEL.purchase, null, null, null],
  ['MA-10', 'HSG-10', 1, BOM_LINE_TYPE_LABEL.manufacture, null, null, null],
  ['MA-10', 'BLT-M8x25', 4, BOM_LINE_TYPE_LABEL.purchase, null, null, null],
];

function linesSheetXml(): string {
  const lastRow = ML_BOM_IMPORT_MAX_ROWS + 1; // header is row 1
  const lineTypes = [
    BOM_LINE_TYPE_LABEL.manufacture,
    BOM_LINE_TYPE_LABEL.purchase,
    BOM_LINE_TYPE_LABEL.outsource,
  ].join(',');
  const rows = [
    rowXml(1, [...ML_BOM_IMPORT_HEADERS], () => S_HEAD),
    ...EXAMPLE.map((cells, i) =>
      rowXml(i + 2, cells, (col) => (TEXT_COLS.has(col) ? S_EX_TEXT : S_EX)),
    ),
  ].join('');
  const widths = [20, 20, 12, 14, 16, 16, 32];
  const cols = widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${TEXT_COLS.has(i) ? ` style="${S_TEXT}"` : ''}/>`,
    )
    .join('');
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    '<dataValidations count="2">' +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Line Type" error="Choose ${esc(lineTypes.replace(/,/g, ', '))}." sqref="D2:D${lastRow}">` +
    `<formula1>"${esc(lineTypes)}"</formula1></dataValidation>` +
    `<dataValidation type="decimal" operator="greaterThan" allowBlank="1" showErrorMessage="1" errorTitle="Qty per Set" error="Qty per Set must be a number above 0." sqref="C2:C${lastRow}">` +
    '<formula1>0</formula1></dataValidation>' +
    '</dataValidations>' +
    '</worksheet>'
  );
}

/** "Read Me" — the rules, one per row. Exported so the count is testable. */
export const ML_BOM_TEMPLATE_RULES: readonly string[] = [
  'One row = one parent → child link.',
  'BOM Item Code and Child Item Code must exist in Item Master.',
  'A Child Item Code that is also a BOM Item Code (in this file, or with a Default Multi-Level BOM) becomes a sub-assembly.',
  'Levels are not typed.',
  `Line Type: ${BOM_LINE_TYPE_LABEL.manufacture}, ${BOM_LINE_TYPE_LABEL.purchase} or ${BOM_LINE_TYPE_LABEL.outsource}.`,
  `${BOM_LINE_TYPE_LABEL.purchase} and ${BOM_LINE_TYPE_LABEL.outsource} ignore the child's BOM.`,
  'Qty per Set: a number above 0, for one parent.',
  'An item that already has a Default Multi-Level BOM gets a new BOM Rev.',
  `At most ${ML_BOM_IMPORT_MAX_ROWS} rows.`,
  'The whole file saves or nothing does.',
  'Blue rows are an example — replace them.',
];

function readMeSheetXml(): string {
  const rows = [
    rowXml(1, ['Rules'], () => S_HEAD),
    ...ML_BOM_TEMPLATE_RULES.map((t, i) => rowXml(i + 2, [t], () => S_WRAP)),
  ].join('');
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<cols><col min="1" max="1" width="100" customWidth="1"/></cols>' +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  );
}

const CONTENT_TYPES_XML =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_XML =
  `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
  '<bookViews><workbookView activeTab="0"/></bookViews>' +
  '<sheets>' +
  `<sheet name="${ML_BOM_TEMPLATE_SHEET}" sheetId="1" r:id="rId1"/>` +
  '<sheet name="Read Me" sheetId="2" r:id="rId2"/>' +
  '</sheets></workbook>';

const WORKBOOK_RELS_XML =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
  `<Relationship Id="rId3" Type="${NS_REL}/styles" Target="styles.xml"/>` +
  '</Relationships>';

/** The template's bytes (an .xlsx zip). Pure — no DOM — so it can be tested. */
export async function buildMlBomTemplate(): Promise<Uint8Array<ArrayBuffer>> {
  const xlsx = await import('xlsx');
  const cfbApi = xlsx.CFB as CfbZip;
  const enc = new TextEncoder();
  const zip = cfbApi.utils.cfb_new();
  const parts: [string, string][] = [
    ['[Content_Types].xml', CONTENT_TYPES_XML],
    ['_rels/.rels', ROOT_RELS_XML],
    ['xl/workbook.xml', WORKBOOK_XML],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS_XML],
    ['xl/styles.xml', STYLES_XML],
    ['xl/worksheets/sheet1.xml', linesSheetXml()],
    ['xl/worksheets/sheet2.xml', readMeSheetXml()],
  ];
  for (const [name, xml] of parts) cfbApi.utils.cfb_add(zip, name, enc.encode(xml));
  const written = cfbApi.write(zip, { fileType: 'zip', type: 'array', compression: true });
  // A plain ArrayBuffer-backed copy — what Blob accepts.
  const out = new Uint8Array(written.length);
  out.set(written);
  return out;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadMlBomTemplate(): Promise<void> {
  const bytes = await buildMlBomTemplate();
  saveBlob(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    ML_BOM_TEMPLATE_FILE,
  );
}
