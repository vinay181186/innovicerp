// ADR-310 — the pure parts of the shared list Export.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

vi.mock('@/lib/api', () => ({ ApiError: class {}, apiFetch: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/session', () => ({ useSession: vi.fn() }));

import type { DataTableColumn } from './data-table-types';
import {
  buildMainSheet,
  capMessage,
  dedupeRows,
  exportCell,
  linesForDocs,
  selectExportColumns,
  withAlwaysExported,
} from './list-export';

interface Row {
  id: string;
  code: string;
  name: string;
  qty: number;
  amount: number;
  createdAt: string;
}

const COLS: DataTableColumn<Row>[] = [
  { id: 'sr_no', kind: 'num', header: 'Sr No', render: (_r, i) => 51 + i },
  { id: 'code', key: 'code', kind: 'code', header: 'Code' },
  {
    id: 'name',
    header: createElement('span', null, 'Item ', createElement('br'), 'Name'),
    label: 'Item Name',
    render: (r) => createElement('b', null, r.name),
  },
  {
    id: 'qty',
    kind: 'num',
    header: 'Order Qty',
    render: (r) => createElement('span', null, r.qty),
  },
  { id: 'amount', kind: 'num', money: true, header: 'Amount', render: (r) => `₹ ${r.amount}` },
  { id: 'created', kind: 'date', header: 'Created On', filterValue: (r) => r.createdAt },
  { id: 'act', kind: 'actions', header: '' },
  { id: 'pick', kind: 'control', header: 'Vendor' },
];

const ROW: Row = {
  id: 'a',
  code: 'IN-JW-00001',
  name: 'Shaft 50mm',
  qty: 12,
  amount: 1250,
  createdAt: '2026-11-18',
};

describe('selectExportColumns', () => {
  const all = COLS.map((c) => c.id ?? '');

  it('keeps the visible order and drops actions / controls', () => {
    const cols = selectExportColumns(COLS, ['code', 'sr_no', 'qty', 'act', 'pick']);
    expect(cols.map((c) => c.id)).toEqual(['code', 'sr_no', 'qty']);
  });

  it('drops money (flagged or listed) only for a no-price user', () => {
    expect(selectExportColumns(COLS, all).map((c) => c.id)).toContain('amount');
    const hidden = selectExportColumns(COLS, all, { hideMoney: true, moneyColumns: ['qty'] });
    expect(hidden.map((c) => c.id)).toEqual(['sr_no', 'code', 'name', 'created']);
  });

  it('uses the label, else the header text', () => {
    const h = selectExportColumns(COLS, ['name', 'qty']).map((c) => c.header);
    expect(h).toEqual(['Item Name', 'Order Qty']);
  });
});

describe('exportCell', () => {
  const [sr, code, name, qty, amount, created] = selectExportColumns(COLS, [
    'sr_no',
    'code',
    'name',
    'qty',
    'amount',
    'created',
  ]);

  it('reads what the cell shows; numbers stay numbers', () => {
    expect(exportCell(code!, ROW, 0)).toBe('IN-JW-00001');
    expect(exportCell(name!, ROW, 0)).toBe('Shaft 50mm');
    expect(exportCell(qty!, ROW, 0)).toBe(12);
    expect(exportCell(amount!, ROW, 0)).toBe(1250);
  });

  it('numbers Sr No down the whole file, not the page', () => {
    expect(exportCell(sr!, ROW, 0)).toBe(1);
    expect(exportCell(sr!, ROW, 9)).toBe(10);
  });

  it('writes a raw ISO date as DD-MM-YYYY', () => {
    expect(exportCell(created!, ROW, 0)).toBe('18-11-2026');
  });

  it('prefers exportValue', () => {
    const c = selectExportColumns<Row>(
      [{ id: 'x', header: 'X', render: () => '', exportValue: (r) => `${r.code}!` }],
      ['x'],
    )[0]!;
    expect(exportCell(c, ROW, 0)).toBe('IN-JW-00001!');
  });
});

describe('rows', () => {
  it('de-duplicates by row key, first wins', () => {
    const rows = [ROW, { ...ROW, name: 'dup' }, { ...ROW, id: 'b' }];
    expect(dedupeRows(rows, (r) => r.id).map((r) => r.name)).toEqual(['Shaft 50mm', 'Shaft 50mm']);
  });

  it('builds the main sheet from the default layout when nothing is saved', () => {
    const sheet = buildMainSheet(
      { fileName: 'JWSO Master', columns: COLS, defaultHidden: ['amount'] },
      [ROW],
      undefined,
    );
    expect(sheet.header).toEqual(['Sr No', 'Code', 'Item Name', 'Order Qty', 'Created On']);
    expect(sheet.rows[0]).toEqual([1, 'IN-JW-00001', 'Shaft 50mm', 12, '18-11-2026']);
  });

  it('writes always-exported hidden columns beside their neighbour', () => {
    const ids = ['sr_no', 'code', 'name', 'qty', 'amount', 'created_on'];
    expect(withAlwaysExported(['sr_no', 'code', 'created_on'], ids, ['qty', 'amount'])).toEqual([
      'sr_no',
      'code',
      'qty',
      'amount',
      'created_on',
    ]);
    expect(withAlwaysExported(['sr_no'], ids, undefined)).toEqual(['sr_no']);
    expect(withAlwaysExported(['qty', 'code'], ids, ['sr_no'])).toEqual(['sr_no', 'qty', 'code']);
  });

  it('puts group-heading columns right after the lead block', () => {
    const lead: DataTableColumn<Row>[] = [
      { ...COLS[0]!, lead: true },
      { ...COLS[1]!, lead: true },
      ...COLS.slice(2),
    ];
    const sheet = buildMainSheet(
      {
        fileName: 'Job Queue',
        columns: lead,
        defaultHidden: ['amount', 'qty'],
        alwaysExport: ['qty'],
        groupColumns: [{ id: 'm', header: 'Planned Machine', exportValue: () => 'VMC-1' }],
      },
      [ROW],
      undefined,
    );
    expect(sheet.header).toEqual([
      'Sr No',
      'Code',
      'Planned Machine',
      'Item Name',
      'Order Qty',
      'Created On',
    ]);
    expect(sheet.rows[0]?.[2]).toBe('VMC-1');
  });

  it('names the limit, with the sheet when it is a lines sheet', () => {
    expect(capMessage(10_000, 12_345)).toBe(
      'Exported the first 10,000 of 12,345 rows. Narrow the filter to export the rest.',
    );
    expect(capMessage(10_000, 12_345, 'JWSO Lines')).toContain('on “JWSO Lines”');
  });
});

describe('linesForDocs', () => {
  it('keeps only main-sheet documents, in main-sheet order then line no.', () => {
    const lines = [
      { doc: 'b', no: 2 },
      { doc: 'x', no: 1 },
      { doc: 'a', no: 2 },
      { doc: 'b', no: 1 },
      { doc: 'a', no: 1 },
    ];
    const order = new Map([
      ['b', 0],
      ['a', 1],
    ]);
    const out = linesForDocs(
      lines,
      order,
      (l) => l.doc,
      (l) => l.no,
    );
    expect(out).toEqual([
      { doc: 'b', no: 1 },
      { doc: 'b', no: 2 },
      { doc: 'a', no: 1 },
      { doc: 'a', no: 2 },
    ]);
  });
});
