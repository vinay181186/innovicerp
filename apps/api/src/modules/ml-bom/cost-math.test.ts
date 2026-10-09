// Pure tests for the Multi-Level BOM cost roll-up (ADR-225 phase 6). No DB.

import { describe, expect, it } from 'vitest';
import type { MlBomTreeNode } from './schema';
import {
  computeMlBomCost,
  money,
  parseDecimal,
  type ItemRate,
  type RouteCardCost,
} from './cost-math';

const node = (
  key: string,
  itemId: string,
  bomType: MlBomTreeNode['bomType'],
  qtyPerSet: string | null,
  explodedQty = '0',
): MlBomTreeNode => ({
  key,
  depth: key === '' ? 0 : key.split('/').length,
  itemId,
  itemCode: itemId.toUpperCase(),
  itemName: null,
  uom: 'Nos',
  bomType,
  qtyPerSet,
  explodedQty,
  mlBomId: null,
  mlBomCode: null,
  rawMaterialGradeText: null,
  rawMaterialSizeText: null,
});

// TOP ── a (buy, 2/set, GRN rate 10.50)
//     ├─ s (manufacture sub-assembly, 1/set, own ops)
//     │   ├─ p (manufacture leaf, 3/set, RM r × 0.25, ops)
//     │   └─ b (outsource, 1/set, PO rate 7)
//     └─ x (buy, 4/set, NO rate)
const nodes: MlBomTreeNode[] = [
  node('', 'top', null, null),
  node('a', 'a', 'purchase', '2'),
  node('s', 's', 'manufacture', '1'),
  node('s/p', 'p', 'manufacture', '3'),
  node('s/b', 'b', 'outsource', '1'),
  node('x', 'x', 'purchase', '4'),
];
const rates = new Map<string, ItemRate>([
  ['a', { rate: '10.50', source: 'grn', ref: 'IN-GRN-00001' }],
  ['b', { rate: '7', source: 'po', ref: 'IN-PO-00009' }],
  ['r', { rate: '200', source: 'grn', ref: 'IN-GRN-00002' }],
]);
const routeCards = new Map<string, RouteCardCost>([
  // top: 30 min × ₹600/h = 18000 → /60 = ₹300
  [
    'top',
    { rawMaterialItemId: null, rmQtyPerPiece: null, opMinuteRate: '18000', opRateMissing: false },
  ],
  // s: 10 min × ₹120/h → 1200/60 = ₹20
  [
    's',
    { rawMaterialItemId: null, rmQtyPerPiece: null, opMinuteRate: '1200', opRateMissing: false },
  ],
  // p: RM 200 × 0.25 = 50; ops 6 min × ₹100/h → 600/60 = ₹10
  [
    'p',
    { rawMaterialItemId: 'r', rmQtyPerPiece: '0.25', opMinuteRate: '600', opRateMissing: false },
  ],
]);

describe('computeMlBomCost', () => {
  const res = computeMlBomCost({ qty: 2, nodes, routeCards, rates });
  const row = (k: string) => res.rows.find((r) => r.key === k)!;

  it('prices a bought row at its GRN / PO rate', () => {
    expect(row('a')).toMatchObject({
      materialRate: '10.50',
      operationRate: '0.00',
      unitCost: '10.50',
      amount: '42.00', // 10.50 × (2 × 2)
      rateSource: 'grn',
      rateRef: 'IN-GRN-00001',
    });
    // Outsource = processing charge: operations, not material.
    expect(row('s/b')).toMatchObject({
      materialRate: null,
      operationRate: '7.00',
      unitCost: '7.00',
      amount: '14.00',
      rateSource: 'po',
      rateRef: 'IN-PO-00009',
    });
  });

  it('prices a manufacture leaf from its Route Card RM + operations', () => {
    expect(row('s/p')).toMatchObject({
      materialRate: '50.00',
      operationRate: '10.00',
      unitCost: '60.00',
      amount: '360.00', // 60 × (2 × 1 × 3)
      rateSource: 'route_card',
      rateRef: 'IN-GRN-00002',
    });
  });

  it('rolls a sub-assembly and the top up from their children + own operations', () => {
    // s = 60 × 3 + 7 × 1 + 20 = 207
    expect(row('s')).toMatchObject({
      materialRate: null,
      operationRate: '20.00',
      unitCost: '207.00',
      amount: '414.00',
      rateSource: 'roll_up',
    });
    // top = 10.50 × 2 + 207 × 1 + 0 × 4 + 300 = 528
    expect(row('')).toMatchObject({ unitCost: '528.00', amount: '1056.00', rateSource: 'roll_up' });
    expect(res.totalCost).toBe('1056.00');
  });

  it('counts a row with no rate, adds 0, and leaves its unit cost blank', () => {
    expect(row('x')).toMatchObject({ unitCost: null, amount: '0.00', rateSource: 'none' });
    expect(res.noRateCount).toBe(1);
  });

  it('splits the total into material + operations that add up', () => {
    // material per set = 21 + 150 = 171; ops = 300 + 20 + 30 + 7 (outsource) = 357
    expect(res.materialCost).toBe('342.00');
    expect(res.operationCost).toBe('714.00');
    expect(res.currency).toBe('INR');
    expect(res.qty).toBe(2);
  });

  it('keeps minutes / 60 exact until the amount is rounded', () => {
    // 1 min × ₹1/h = 0.01666… per piece; 1000 pieces = 16.67 (not 0.02 × 1000).
    const r = computeMlBomCost({
      qty: 1000,
      nodes: [node('', 'top', null, null)],
      routeCards: new Map([
        [
          'top',
          { rawMaterialItemId: null, rmQtyPerPiece: null, opMinuteRate: '1', opRateMissing: false },
        ],
      ]),
      rates: new Map(),
    });
    expect(r.rows[0]).toMatchObject({ operationRate: '0.02', unitCost: '0.02', amount: '16.67' });
    expect(r.totalCost).toBe('16.67');
    expect(r.materialCost).toBe('0.00');
    expect(r.operationCost).toBe('16.67');
    // A Manufacture leaf with no RM is a missing rate, even with operations.
    expect(r.noRateCount).toBe(1);
  });

  it('has no float drift (0.1 × 3 = 0.30, 0.7 × 0.1 qty)', () => {
    const r = computeMlBomCost({
      qty: 0.1,
      nodes: [node('', 'top', null, null), node('a', 'a', 'purchase', '3')],
      routeCards: new Map(),
      rates: new Map([['a', { rate: '0.7', source: 'po', ref: null }]]),
    });
    expect(r.rows[1]!.amount).toBe('0.21');
    expect(r.totalCost).toBe('0.21');
  });

  it('a manufacture leaf without a Route Card and no ops is a missing rate', () => {
    const r = computeMlBomCost({
      qty: 1,
      nodes: [node('', 'top', null, null), node('m', 'm', 'manufacture', '5')],
      routeCards: new Map([
        [
          'm',
          { rawMaterialItemId: 'r', rmQtyPerPiece: null, opMinuteRate: '0', opRateMissing: false },
        ],
      ]),
      rates: new Map([['r', { rate: '9', source: 'grn', ref: 'G' }]]),
    });
    expect(r.rows[1]).toMatchObject({ materialRate: null, unitCost: null, rateSource: 'none' });
    expect(r.noRateCount).toBe(1);
    expect(r.totalCost).toBe('0.00');
  });
});

describe('operations with no rate', () => {
  const card = (opMinuteRate: string, opRateMissing: boolean, rm = false): RouteCardCost => ({
    rawMaterialItemId: rm ? 'r' : null,
    rmQtyPerPiece: rm ? '1' : null,
    opMinuteRate,
    opRateMissing,
  });
  const rmRate = new Map<string, ItemRate>([['r', { rate: '10', source: 'grn', ref: 'G' }]]);

  it('an OSP step / a step with no machine rate counts the leaf, which keeps its other costs', () => {
    const r = computeMlBomCost({
      qty: 1,
      nodes: [node('', 'top', null, null), node('m', 'm', 'manufacture', '2')],
      // in-house steps 600/60 = 10; another step (OSP or no machine) added 0
      routeCards: new Map([['m', card('600', true, true)]]),
      rates: rmRate,
    });
    expect(r.rows[1]).toMatchObject({
      materialRate: '10.00',
      operationRate: '10.00',
      unitCost: '20.00',
      rateSource: 'route_card',
    });
    expect(r.noRateCount).toBe(1);
    expect(r.totalCost).toBe('40.00');
  });

  it('a row missing BOTH material and an op rate counts once', () => {
    const r = computeMlBomCost({
      qty: 1,
      nodes: [node('', 'top', null, null), node('m', 'm', 'manufacture', '1')],
      routeCards: new Map([['m', card('0', true)]]),
      rates: new Map(),
    });
    expect(r.noRateCount).toBe(1);
  });

  it('a sub-assembly or the top with an un-rated step counts itself', () => {
    const r = computeMlBomCost({
      qty: 1,
      nodes: [node('', 'top', null, null), node('a', 'a', 'purchase', '1')],
      routeCards: new Map([['top', card('120', true)]]),
      rates: new Map([['a', { rate: '5', source: 'po', ref: 'P' }]]),
    });
    expect(r.rows[0]).toMatchObject({
      rateSource: 'roll_up',
      operationRate: '2.00',
      unitCost: '7.00',
    });
    expect(r.noRateCount).toBe(1);
  });

  it('a Buy or Outsource row ignores Route Card op flags', () => {
    const r = computeMlBomCost({
      qty: 1,
      nodes: [node('', 'top', null, null), node('o', 'o', 'outsource', '1')],
      routeCards: new Map([['o', card('600', true)]]),
      rates: new Map([['o', { rate: '3', source: 'grn', ref: 'G' }]]),
    });
    expect(r.rows[1]).toMatchObject({ operationRate: '3.00', materialRate: null });
    expect(r.noRateCount).toBe(0);
    expect(r.materialCost).toBe('0.00');
    expect(r.operationCost).toBe('3.00');
  });
});

describe('exact decimals', () => {
  it('parses plain and exponent numerals', () => {
    expect(parseDecimal('1e-7')).toEqual({ n: 1n, d: 10000000n });
    expect(parseDecimal('12.50')).toEqual({ n: 25n, d: 2n });
    expect(parseDecimal('-3')).toEqual({ n: -3n, d: 1n });
    expect(() => parseDecimal('abc')).toThrow();
  });
  it('rounds half away from zero to 2 places', () => {
    expect(money(parseDecimal('0.005'))).toBe('0.01');
    expect(money(parseDecimal('0.004999'))).toBe('0.00');
    expect(money(parseDecimal('1234.5'))).toBe('1234.50');
    expect(money(parseDecimal('-0.005'))).toBe('-0.01');
    expect(money(parseDecimal('0'))).toBe('0.00');
  });
});
