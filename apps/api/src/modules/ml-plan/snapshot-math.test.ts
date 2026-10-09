// Multi-Level Plan figures (ADR-225 phase 3) — pure maths, no database.

import { describe, expect, it } from 'vitest';
import { type WalkNode, computePlanFigures, milliToText, toMilli } from './snapshot-math';

const node = (
  key: string,
  parentKey: string | null,
  itemId: string,
  over: Partial<WalkNode> = {},
): WalkNode => ({
  key,
  parentKey,
  depth: parentKey === null ? 0 : key.split('/').length,
  itemId,
  uom: 'NOS',
  bomType: parentKey === null ? null : 'manufacture',
  isSubAssembly: false,
  mlBomId: null,
  mlBomRevision: null,
  qtyPerSet: parentKey === null ? null : '1.000',
  rawMaterialGradeText: null,
  rawMaterialSizeText: null,
  ...over,
});

const byKey = (rows: ReturnType<typeof computePlanFigures>) => new Map(rows.map((r) => [r.key, r]));

describe('toMilli / milliToText', () => {
  it('round-trips 3 decimals and rounds half-up past them', () => {
    expect(milliToText(toMilli('12.5'))).toBe('12.500');
    expect(milliToText(toMilli(0.1 + 0.2))).toBe('0.300');
    expect(milliToText(toMilli('1.2345'))).toBe('1.235');
    expect(milliToText(toMilli(null))).toBe('0.000');
  });
});

describe('computePlanFigures', () => {
  // PS-100 = 1 × MA-10 (manufacture, sub-assembly) ; MA-10 = 4 × BLT-M8x25 (Buy)
  const ps100 = [
    node('', null, 'PS-100', { isSubAssembly: true }),
    node('a', '', 'MA-10', { isSubAssembly: true, qtyPerSet: '1.000' }),
    node('a/b', 'a', 'BLT-M8x25', { bomType: 'purchase', qtyPerSet: '4.000' }),
  ];

  it('PS-100 example: 3 MA-10 in stock, plan 5 → MA-10 net 2, bolts gross 8', () => {
    const rows = byKey(computePlanFigures(ps100, 5, new Map([['MA-10', '3']]), new Map()));
    expect(rows.get('')!.grossNeedQty).toBe('5.000');
    expect(rows.get('')!.netNeedQty).toBe('5.000');
    expect(rows.get('')!.fromStockQty).toBe('0.000');
    const ma = rows.get('a')!;
    expect([ma.grossNeedQty, ma.fromStockQty, ma.onPoPrQty, ma.netNeedQty]).toEqual([
      '5.000',
      '3.000',
      '0.000',
      '2.000',
    ]);
    expect(rows.get('a/b')!.grossNeedQty).toBe('8.000');
    expect(rows.get('a/b')!.netNeedQty).toBe('8.000');
  });

  it('On PO / PR only reduces Buy / Outsource rows, never Manufacture', () => {
    const rows = byKey(
      computePlanFigures(
        ps100,
        5,
        new Map(),
        new Map([
          ['MA-10', '10'],
          ['BLT-M8x25', '6'],
        ]),
      ),
    );
    expect(rows.get('a')!.onPoPrQty).toBe('0.000');
    expect(rows.get('a')!.netNeedQty).toBe('5.000');
    expect(rows.get('a/b')!.grossNeedQty).toBe('20.000');
    expect(rows.get('a/b')!.onPoPrQty).toBe('6.000');
    expect(rows.get('a/b')!.netNeedQty).toBe('14.000');
  });

  it('the same item on two rows shares ONE pool (stock given once)', () => {
    const walk = [
      node('', null, 'TOP'),
      node('x', '', 'BRG', { bomType: 'purchase', qtyPerSet: '2.000' }),
      node('y', '', 'HSG', { isSubAssembly: true }),
      node('y/z', 'y', 'BRG', { bomType: 'purchase', qtyPerSet: '3.000' }),
    ];
    const rows = byKey(computePlanFigures(walk, 2, new Map([['BRG', '5']]), new Map()));
    // first BRG row: gross 4, takes 4 of 5
    expect(rows.get('x')!.fromStockQty).toBe('4.000');
    expect(rows.get('x')!.netNeedQty).toBe('0.000');
    // second BRG row: gross 6, only 1 left
    expect(rows.get('y/z')!.grossNeedQty).toBe('6.000');
    expect(rows.get('y/z')!.fromStockQty).toBe('1.000');
    expect(rows.get('y/z')!.netNeedQty).toBe('5.000');
  });

  it('rounds Net Need UP to a whole piece for a whole-number UOM, not for KGS', () => {
    const walk = [
      node('', null, 'TOP', { uom: 'KGS' }),
      node('p', '', 'PIN', { bomType: 'purchase', qtyPerSet: '3.000', uom: 'NOS' }),
      node('k', '', 'OIL', { bomType: 'purchase', qtyPerSet: '0.125', uom: 'KGS' }),
    ];
    // plan 1 set; PIN: gross 3, 0.5 on order (KG-style PR left on an NOS item) → 2.5 → 3
    const rows = byKey(computePlanFigures(walk, 1, new Map(), new Map([['PIN', '0.5']])));
    expect(rows.get('p')!.netNeedQty).toBe('3.000');
    expect(rows.get('k')!.netNeedQty).toBe('0.125');
  });

  it('a fully stocked sub-assembly needs no children', () => {
    const rows = byKey(computePlanFigures(ps100, 5, new Map([['MA-10', '9']]), new Map()));
    expect(rows.get('a')!.netNeedQty).toBe('0.000');
    expect(rows.get('a/b')!.grossNeedQty).toBe('0.000');
  });

  it('negative free stock is treated as none', () => {
    const rows = byKey(computePlanFigures(ps100, 5, new Map([['MA-10', '-2']]), new Map()));
    expect(rows.get('a')!.fromStockQty).toBe('0.000');
  });

  it('numbers rows 0..n in walk order and leaves the input pools untouched', () => {
    const stock = new Map([['MA-10', '3']]);
    const rows = computePlanFigures(ps100, 5, stock, new Map());
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(stock.get('MA-10')).toBe('3');
  });
});
