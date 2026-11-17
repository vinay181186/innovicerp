// ADR-302 — the line import reads 'Unit Value (Basic)' and still reads an old 'Rate' sheet.
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { parseJwLineFile } from '@/modules/job-work-orders/lib/import-export';
import { parseSoLineFile } from './import-export';

vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

function sheet(head: string[], row: unknown[]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, row]), 'Lines');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  // jsdom's File has no arrayBuffer(); the parsers only call that.
  return { name: 'lines.xlsx', arrayBuffer: () => Promise.resolve(buf) } as unknown as File;
}
const base = ['Item Code', 'POL', 'Order Qty'];
const vals = ['ITM-001', '1', 2];

describe.each([
  ['SO', parseSoLineFile],
  ['JW', parseJwLineFile],
] as const)('%s line import — rate heading', (_name, parse) => {
  it('reads Unit Value (Basic)', async () => {
    const { rows } = await parse(sheet([...base, 'Unit Value (Basic)'], [...vals, 90000]));
    expect(rows[0]?.rate).toBe(90000);
  });
  it('still reads an old Rate sheet', async () => {
    const { rows } = await parse(sheet([...base, 'Rate'], [...vals, 250]));
    expect(rows[0]?.rate).toBe(250);
  });
  it('prefers Unit Value (Basic) when both are there', async () => {
    const { rows } = await parse(sheet([...base, 'Rate', 'Unit Value (Basic)'], [...vals, 1, 2]));
    expect(rows[0]?.rate).toBe(2);
  });
  it('blank value imports as 0', async () => {
    const { rows } = await parse(sheet([...base, 'Unit Value (Basic)'], [...vals, '']));
    expect(rows[0]?.rate).toBe(0);
  });
});
