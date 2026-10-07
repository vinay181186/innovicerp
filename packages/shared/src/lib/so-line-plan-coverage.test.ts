import { describe, expect, it } from 'vitest';
import { completeSets, isBomPartPlan, soLinePlanCoverage } from './so-line-plan-coverage';

const BOM = 'bom-1';
const part = (code: string, planQty: number) => ({ planQty, bomMasterId: BOM, bomChildCode: code });
const own = (planQty: number) => ({ planQty, bomMasterId: null, bomChildCode: null });
const P1P2 = [
  { code: 'P1', qtyPerSet: 1 },
  { code: 'P2', qtyPerSet: 1 },
];

describe('soLinePlanCoverage (ADR-221)', () => {
  it('IN-SO-00793: equipment, P1 10 + P2 10 at 1/set → 10, not 20', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [part('P1', 10), part('P2', 10)],
      bomLines: P1P2,
      buyPrQty: 0,
    });
    expect(r).toEqual({ ownPlanned: 0, sets: 10, planned: 10 });
  });

  it('the weakest part decides: P1 10, P2 4 → 4 sets', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [part('P1', 10), part('P2', 4)],
      bomLines: P1P2,
      buyPrQty: 0,
    });
    expect(r.planned).toBe(4);
  });

  it('V3B-SO-679917: P1 5 at 2/set, P2 3 at 1/set → 2 sets (1 pending of 3)', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [part('P1', 5), part('P2', 3)],
      bomLines: [
        { code: 'P1', qtyPerSet: 2 },
        { code: 'P2', qtyPerSet: 1 },
      ],
      buyPrQty: 0,
    });
    expect(r.planned).toBe(2);
  });

  it('fractional qty per set: 2 planned at 0.5/set → 4 sets', () => {
    expect(completeSets([{ code: 'P1', qtyPerSet: 0.5 }], new Map([['P1', 2]]))).toBe(4);
  });

  it('a part with no plan at all → 0 sets', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [part('P1', 10)],
      bomLines: P1P2,
      buyPrQty: 0,
    });
    expect(r.planned).toBe(0);
  });

  it('a part planned twice is summed: 6 + 4 → 10', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [part('P1', 6), part('P1', 4), part('P2', 10)],
      bomLines: P1P2,
      buyPrQty: 0,
    });
    expect(r.planned).toBe(10);
  });

  it('equipment line with a legacy own plan: the larger figure, never lower', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 1000,
      plans: [own(7), part('P1', 3), part('P2', 3)],
      bomLines: P1P2,
      buyPrQty: 0,
    });
    expect(r).toEqual({ ownPlanned: 7, sets: 3, planned: 7 });
  });

  it('assembly line: parts planned, no Final Assembly → 0 (stays in Needs Planning)', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: false,
      orderQty: 1000,
      plans: [part('PLATE', 10), part('BOLT', 10)],
      bomLines: [],
      buyPrQty: 0,
    });
    expect(r.planned).toBe(0);
  });

  it('assembly line: with its Final Assembly plan of 10 → 10', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: false,
      orderQty: 1000,
      plans: [part('PLATE', 10), part('BOLT', 10), own(10)],
      bomLines: [],
      buyPrQty: 0,
    });
    expect(r.planned).toBe(10);
  });

  it('ordinary line: unchanged — Σ plans + a Buy line PRs', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: false,
      orderQty: 1000,
      plans: [own(4), own(3)],
      bomLines: [],
      buyPrQty: 2.5,
    });
    expect(r).toEqual({ ownPlanned: 9.5, sets: 0, planned: 9.5 });
  });

  it('a plan with a child code but no BOM is the line own plan (ADR-107 test)', () => {
    expect(isBomPartPlan({ bomMasterId: null, bomChildCode: 'P1' })).toBe(false);
    expect(isBomPartPlan({ bomMasterId: BOM, bomChildCode: null })).toBe(false);
  });

  it('an empty BOM (parts deleted) gives 0 sets, never Infinity', () => {
    expect(completeSets([], new Map([['P1', 10]]))).toBe(0);
    expect(completeSets([{ code: 'P1', qtyPerSet: 0 }], new Map([['P1', 10]]))).toBe(0);
  });

  it('7 planned at 0.07/set is 100 sets, as Postgres says — not 99', () => {
    expect(completeSets([{ code: 'P1', qtyPerSet: 0.07 }], new Map([['P1', 7]]))).toBe(100);
  });

  it('a part on two BOM lines needs both: bolt 1+1 per set, 10 planned → 5 sets', () => {
    expect(
      completeSets(
        [
          { code: 'B', qtyPerSet: 1 },
          { code: 'B', qtyPerSet: 1 },
        ],
        new Map([['B', 10]]),
      ),
    ).toBe(5);
  });

  it('sets never count above the order: order 5, 3 planned at 0.5/set → 5, not 6', () => {
    const r = soLinePlanCoverage({
      isEquipmentLine: true,
      orderQty: 5,
      plans: [part('P1', 3)],
      bomLines: [{ code: 'P1', qtyPerSet: 0.5 }],
      buyPrQty: 0,
    });
    expect(r.planned).toBe(5);
  });
});
