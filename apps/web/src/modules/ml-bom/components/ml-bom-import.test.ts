import { ML_BOM_IMPORT_HEADERS, ML_BOM_IMPORT_MAX_ROWS } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseMlBomWorkbook } from './ml-bom-import-parse';
import { buildMlBomTemplate } from './ml-bom-import-template';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function bookOf(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function zipText(bytes: Uint8Array, path: string): string {
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' });
  const entry = XLSX.CFB.find(cfb, `/${path}`);
  return new TextDecoder().decode(entry.content);
}

describe('Multi-Level BOM Excel Template', () => {
  it('has the two sheets, the exact headers and the example block', async () => {
    const bytes = await buildMlBomTemplate();
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['BOM Lines', 'Read Me']);
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['BOM Lines']!, { header: 1 });
    expect(aoa[0]).toEqual([...ML_BOM_IMPORT_HEADERS]);
    expect(aoa.slice(1).map((r) => r.slice(0, 4))).toEqual([
      ['PS-100', 'MA-10', 1, 'Manufacture'],
      ['PS-100', 'BP-200', 1, 'Manufacture'],
      ['PS-100', 'CPL-25', 2, 'Buy'],
      ['MA-10', 'HSG-10', 1, 'Manufacture'],
      ['MA-10', 'BLT-M8x25', 4, 'Buy'],
    ]);
  });

  it('carries the Line Type list, the Qty > 0 rule and Text code columns', async () => {
    const bytes = await buildMlBomTemplate();
    const sheet = zipText(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<formula1>"Manufacture,Buy,Outsource"</formula1>');
    expect(sheet).toContain(`sqref="D2:D${ML_BOM_IMPORT_MAX_ROWS + 1}"`);
    expect(sheet).toContain('type="decimal" operator="greaterThan"');
    expect(sheet).toContain('<col min="1" max="1" width="20" customWidth="1" style="1"/>');
    expect(sheet).toContain('<col min="2" max="2" width="20" customWidth="1" style="1"/>');
    expect(zipText(bytes, 'xl/styles.xml')).toContain('numFmtId="49"');
  });

  it('reads back through the importer as five rows from sheet row 2', async () => {
    const bytes = await buildMlBomTemplate();
    const p = await parseMlBomWorkbook(toArrayBuffer(bytes));
    expect(p.fatal).toBeUndefined();
    expect(p.rows.map((r) => [r.rowNum, r.bomItemCode, r.childItemCode, r.qtyPerSet])).toEqual([
      [2, 'PS-100', 'MA-10', '1'],
      [3, 'PS-100', 'BP-200', '1'],
      [4, 'PS-100', 'CPL-25', '2'],
      [5, 'MA-10', 'HSG-10', '1'],
      [6, 'MA-10', 'BLT-M8x25', '4'],
    ]);
  });
});

describe('Multi-Level BOM sheet reader', () => {
  it('prefers the "BOM Lines" sheet, keeps leading zeros, accepts Line Kind, skips blank rows', async () => {
    const buf = bookOf({
      Other: [['x']],
      'BOM Lines': [
        ['bom item code', 'CHILD ITEM CODE ', 'Qty per Set', 'Line Kind', 'Line Remarks'],
        ['00451', '1-10', 2.5, 'Buy', 'note'],
        ['', '', '', '', ''],
        ['00451', '0007', '1', 'Make', ''],
      ],
    });
    const p = await parseMlBomWorkbook(buf);
    expect(p.fatal).toBeUndefined();
    expect(p.rows).toEqual([
      {
        rowNum: 2,
        bomItemCode: '00451',
        childItemCode: '1-10',
        qtyPerSet: '2.5',
        lineType: 'Buy',
        rawMaterialGrade: null,
        rawMaterialSize: null,
        remarks: 'note',
      },
      {
        rowNum: 4,
        bomItemCode: '00451',
        childItemCode: '0007',
        qtyPerSet: '1',
        lineType: 'Make',
        rawMaterialGrade: null,
        rawMaterialSize: null,
        remarks: null,
      },
    ]);
  });

  it('stops on a missing required column, naming it', async () => {
    const p = await parseMlBomWorkbook(
      bookOf({
        Sheet1: [
          ['BOM Item Code', 'Qty per Set'],
          ['A', '1'],
        ],
      }),
    );
    expect(p.fatal).toBe('Missing columns: Child Item Code, Line Type.');
  });

  it(`stops above ${ML_BOM_IMPORT_MAX_ROWS} rows`, async () => {
    const aoa: unknown[][] = [[...ML_BOM_IMPORT_HEADERS]];
    for (let i = 0; i <= ML_BOM_IMPORT_MAX_ROWS; i++) aoa.push(['P', `C${i}`, 1, 'Buy']);
    const p = await parseMlBomWorkbook(bookOf({ 'BOM Lines': aoa }));
    expect(p.fatal).toBe(`More than ${ML_BOM_IMPORT_MAX_ROWS} rows. Split the file.`);
  });
});
