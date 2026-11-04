import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbookBuffer, type ExcelColumn, type ExcelRow } from './excel';

async function dataSheet(columns: ExcelColumn[], rows: ExcelRow[]): Promise<ExcelJS.Worksheet> {
  const buf = await buildWorkbookBuffer({
    id: 'x',
    title: 'X',
    columns,
    rows,
    generatedAt: '2026-11-03T06:30:00.000Z',
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet('Report Data');
  if (!sheet) throw new Error('no Report Data sheet');
  return sheet;
}

const DATE: ExcelColumn = { key: 'd', label: 'GRN Date', type: 'date' };
const STAMP: ExcelColumn = { key: 'd', label: 'Closed Date', type: 'datetime' };

describe('Excel date text outside the data sheet', () => {
  it('summary groups and filters read DD-MM-YYYY, other words are untouched', async () => {
    const buf = await buildWorkbookBuffer({
      id: 'x',
      title: 'X',
      columns: [DATE],
      rows: [{ d: '2026-11-03' }],
      summary: [
        { group: '2026-11-03', count: 1, aggregate: null },
        { group: 'Open', count: 2, aggregate: null },
      ],
      filters: { fromDate: '2026-11-01' },
      generatedAt: '2026-11-03T06:30:00.000Z',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const summary = wb.getWorksheet('Summary');
    expect(summary?.getCell('A2').value).toBe('03-11-2026');
    expect(summary?.getCell('A3').value).toBe('Open');
    const info: unknown[] = [];
    wb.getWorksheet('Report Info')?.eachRow((r) => info.push(r.getCell(2).value));
    expect(info).toContain('01-11-2026');
  });
});

describe('Excel date cells (owner 2026-11-03)', () => {
  it('a bare date is a real date cell shown DD-MM-YYYY, the same day', async () => {
    const cell = (await dataSheet([DATE], [{ d: '2026-11-03' }])).getCell('A2');
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 10, 3)));
    expect(cell.numFmt).toBe('dd-mm-yyyy');
  });

  it('an India wall-clock report value keeps its clock', async () => {
    const cell = (await dataSheet([STAMP], [{ d: '2026-11-03 14:35' }])).getCell('A2');
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 10, 3, 14, 35)));
    expect(cell.numFmt).toBe('dd-mm-yyyy hh:mm AM/PM');
  });

  it('a UTC timestamp lands on the India day and clock', async () => {
    const cell = (await dataSheet([STAMP], [{ d: '2026-11-03T19:00:00.000Z' }])).getCell('A2');
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 10, 4, 0, 30)));
  });

  it('a date column drops the clock of a timestamp and uses the India day', async () => {
    const cell = (await dataSheet([DATE], [{ d: '2026-11-03T19:00:00+00' }])).getCell('A2');
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 10, 4)));
  });

  it('blank, non-date and impossible values stay as they are', async () => {
    const sheet = await dataSheet(
      [DATE],
      [{ d: null }, { d: 'Not set' }, { d: '2026-02-31' }, { d: '0001-01-01' }],
    );
    expect(sheet.getCell('A2').value).toBeNull();
    expect(sheet.getCell('A3').value).toBe('Not set');
    expect(sheet.getCell('A4').value).toBe('2026-02-31');
    expect(sheet.getCell('A5').value).toBe('0001-01-01');
  });

  it('the totals tag still sits in the first text column', async () => {
    const sheet = await dataSheet([DATE], [{ d: '2026-11-03' }]);
    expect(sheet.getCell('A3').value).toBe('TOTAL (1)');
  });
});
