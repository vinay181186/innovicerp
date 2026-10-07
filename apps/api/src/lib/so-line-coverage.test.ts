// ADR-221 — parity guard between the SQL coverage expressions here and the
// TypeScript rule in packages/shared (soLinePlanCoverage). No database: the
// SQL cannot be executed here, so these are string-level checks that the
// pieces of the rule are present, plus a source check that SO Planning's
// detail pane reads the shared rule rather than a hand-rolled sum.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { soLinePlanCoverage } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import {
  isBomPartPlanRaw,
  soLineCoveredRaw,
  soLineEquipmentSetsRaw,
  soLineOwnCoveredRaw,
  soLineOwnPlannedRaw,
  soLinePlannedRaw,
} from './so-line-coverage';

const squash = (s: string): string => s.replace(/\s+/g, ' ');

describe('ADR-221 SO line coverage SQL', () => {
  it('part-plan test is ADR-107: both bom_master_id and bom_child_code', () => {
    const t = squash(isBomPartPlanRaw('p'));
    expect(t).toContain('p.bom_master_id IS NOT NULL');
    expect(t).toContain("NULLIF(p.bom_child_code, '') IS NOT NULL");
  });

  it('own planned excludes part plans and keeps the Buy PR term', () => {
    const t = squash(soLineOwnPlannedRaw('sol'));
    expect(t).toContain(`AND NOT ${squash(isBomPartPlanRaw('p_c'))}`);
    expect(t).toContain("= 'buy'");
    expect(t).toContain('public.purchase_requests pr_c');
    expect(t).toContain('::numeric');
  });

  it('sets term = MIN of FLOOR(part planned / qty_per_set), equipment SO only', () => {
    const t = squash(soLineEquipmentSetsRaw('sol'));
    expect(t).toContain('MIN(FLOOR(');
    expect(t).toContain('/ bml_c.qty_per_set');
    expect(t).toContain('bml_c.qty_per_set > 0');
    expect(t).toContain('bml_c.deleted_at IS NULL');
    expect(t).toContain('bml_c.bom_master_id = so_c.bom_master_id');
    expect(t).toContain("so_c.type = 'equipment'");
    expect(t).toContain('so_c.bom_master_id IS NOT NULL');
    expect(t).toContain('so_c.id = sol.sales_order_id');
    expect(t).toContain(squash(isBomPartPlanRaw('ps_c')));
    expect(t).toContain('ps_c.bom_child_code = ib_c.code');
    // No usable BOM line → MIN over nothing is NULL → 0, as completeSets.
    expect(t.startsWith('COALESCE((')).toBe(true);
  });

  it('planned = GREATEST(own, sets); covered adds direct cards', () => {
    const planned = squash(soLinePlannedRaw('sol'));
    expect(planned).toBe(
      squash(`GREATEST(${soLineOwnPlannedRaw('sol')}, ${soLineEquipmentSetsRaw('sol')})::numeric`),
    );
    expect(squash(soLineCoveredRaw('sol'))).toContain(planned);
    const ownCovered = squash(soLineOwnCoveredRaw('sol'));
    expect(ownCovered).toContain(squash(soLineOwnPlannedRaw('sol')));
    expect(ownCovered).not.toContain('MIN(FLOOR(');
  });

  it('the shared rule gives the figures the SQL is built to give', () => {
    const bom = [
      { code: 'P1', qtyPerSet: 1 },
      { code: 'P2', qtyPerSet: 1 },
    ];
    const part = (code: string, planQty: number) => ({
      planQty,
      bomMasterId: 'b',
      bomChildCode: code,
    });
    // IN-SO-00793: order 10, P1 10 + P2 10 → 10, not 20.
    expect(
      soLinePlanCoverage({
        isEquipmentLine: true,
        plans: [part('P1', 10), part('P2', 10)],
        bomLines: bom,
        buyPrQty: 0,
      }).planned,
    ).toBe(10);
    // Weakest part decides.
    expect(
      soLinePlanCoverage({
        isEquipmentLine: true,
        plans: [part('P1', 10), part('P2', 4)],
        bomLines: bom,
        buyPrQty: 0,
      }).planned,
    ).toBe(4);
    // Assembly / ordinary line: part plans never count.
    expect(
      soLinePlanCoverage({
        isEquipmentLine: false,
        plans: [part('P1', 10), { planQty: 3, bomMasterId: 'b', bomChildCode: null }],
        bomLines: bom,
        buyPrQty: 0,
      }).planned,
    ).toBe(3);
  });
});

describe('ADR-221 SO Planning detail reads the shared rule', () => {
  it('getPlanningSoDetail computes totalPlanned with soLinePlanCoverage', () => {
    const src = readFileSync(resolve(__dirname, '../modules/so-planning/service.ts'), 'utf8');
    expect(src).toMatch(/const totalPlanned = soLinePlanCoverage\(\{/);
    // The old SO-line sum (plans + a Buy line's PRs) is gone. The JW pane
    // (getJwPlanningDetail) keeps its own plain sum on purpose — a JW line
    // has no BOM parts.
    expect(src).not.toMatch(/linePlans\.reduce\(\(s, p\) => s \+ p\.planQty, 0\) \+/);
  });

  it('own-plan cap and Raise PR cap use the OWN-covered expression', () => {
    const plans = readFileSync(resolve(__dirname, '../modules/plans/service.ts'), 'utf8');
    expect(plans).toContain('${sql.raw(soLineOwnCoveredRaw(\'sol\'))} AS "covered"');
    const soPlanning = readFileSync(
      resolve(__dirname, '../modules/so-planning/service.ts'),
      'utf8',
    );
    expect(soPlanning).toContain(
      "GREATEST(sol.order_qty - ${sql.raw(soLineOwnCoveredRaw('sol'))}, 0)::numeric AS to_plan",
    );
  });
});
