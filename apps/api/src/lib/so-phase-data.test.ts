// Unit tests for the pure phase-data compute helpers (no DB). The SQL loader
// is exercised via the report services against the seeded DB.

import type { SoPhaseTimestamps } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { computeDurations, diffDays } from './so-phase-data';

const emptyPhases = (): SoPhaseTimestamps => ({
  soCreated: null,
  designAssigned: null,
  designApproved: null,
  bomLinked: null,
  planCreated: null,
  jcCreated: null,
  prRaised: null,
  grnReceived: null,
  firstOpStart: null,
  lastOpEnd: null,
  firstQcStart: null,
  lastQcEnd: null,
  assemblyStarted: null,
  assemblyDone: null,
  dispatched: null,
  invoiced: null,
});

describe('diffDays', () => {
  it('returns whole-day gaps', () => {
    expect(diffDays('2026-01-01', '2026-01-11')).toBe(10);
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('ignores the time component', () => {
    expect(diffDays('2026-01-01T23:59:00Z', '2026-01-03T00:01:00Z')).toBe(2);
  });

  it('returns null when either end is missing or unparseable', () => {
    expect(diffDays(null, '2026-01-01')).toBeNull();
    expect(diffDays('2026-01-01', null)).toBeNull();
    expect(diffDays('not-a-date', '2026-01-01')).toBeNull();
  });
});

describe('computeDurations', () => {
  it('derives each phase gap and falls back bom→plan / dispatched→invoiced', () => {
    const p = emptyPhases();
    p.soCreated = '2026-01-01';
    p.designAssigned = '2026-01-02';
    p.designApproved = '2026-01-09'; // design = 7
    p.bomLinked = '2026-01-10';
    p.planCreated = '2026-01-12'; // designToPlan from designApproved = 3
    p.jcCreated = '2026-01-14'; // planToJc = 2
    p.prRaised = '2026-01-03';
    p.grnReceived = '2026-01-13'; // materialProc = 10
    p.firstOpStart = '2026-01-15';
    p.lastOpEnd = '2026-01-20'; // production = 5
    p.firstQcStart = '2026-01-20';
    p.lastQcEnd = '2026-01-22'; // qc = 2
    p.assemblyStarted = '2026-01-23';
    p.assemblyDone = '2026-01-25'; // assembly = 2
    p.dispatched = '2026-01-27'; // assemblyToDispatch = 2, total = 26

    const d = computeDurations(p);
    expect(d.design).toBe(7);
    expect(d.designToPlan).toBe(3);
    expect(d.planToJc).toBe(2);
    expect(d.materialProc).toBe(10);
    expect(d.production).toBe(5);
    expect(d.qc).toBe(2);
    expect(d.assembly).toBe(2);
    expect(d.assemblyToDispatch).toBe(2);
    expect(d.total).toBe(26);
  });

  it('uses bomLinked for designToPlan when designApproved is missing', () => {
    const p = emptyPhases();
    p.bomLinked = '2026-02-01';
    p.planCreated = '2026-02-05';
    expect(computeDurations(p).designToPlan).toBe(4);
  });

  it('uses invoiced for total when dispatched is missing', () => {
    const p = emptyPhases();
    p.soCreated = '2026-03-01';
    p.invoiced = '2026-03-31';
    expect(computeDurations(p).total).toBe(30);
  });

  it('returns null for gaps with unreached phases', () => {
    const d = computeDurations(emptyPhases());
    expect(d.design).toBeNull();
    expect(d.total).toBeNull();
  });
});
