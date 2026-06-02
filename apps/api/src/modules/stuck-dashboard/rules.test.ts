// Unit tests for the pure stuck-rule helpers (no DB). The SQL loaders + RLS
// scoping are exercised via the route against the seeded DB.

import { DEFAULT_STUCK_THRESHOLDS } from '@innovic/shared';
import type { SoPhaseTimestamps } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import type { SoPhaseData } from '../../lib/so-phase-data';
import { computeDurations } from '../../lib/so-phase-data';
import { type OpStuckCandidate, classifyOpStuck, derivePhaseStuckItems } from './rules';

const TODAY = '2026-06-02';
const thr = DEFAULT_STUCK_THRESHOLDS;

const phases = (over: Partial<SoPhaseTimestamps>): SoPhaseTimestamps => ({
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
  ...over,
});

const so = (id: string, status: string, over: Partial<SoPhaseTimestamps>): SoPhaseData => {
  const p = phases(over);
  return {
    soId: id,
    soNo: `SO-${id}`,
    customer: 'Acme',
    type: 'equipment',
    status,
    orderQty: 10,
    dueDate: null,
    phases: p,
    durations: computeDurations(p),
  };
};

describe('derivePhaseStuckItems', () => {
  it('flags design assigned-but-unapproved past threshold', () => {
    const items = derivePhaseStuckItems([so('1', 'open', { designAssigned: '2026-05-01' })], thr, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]!.stage).toBe('Design');
    expect(items[0]!.days).toBe(32);
    expect(items[0]!.threshold).toBe(15);
  });

  it('does not flag design still within threshold', () => {
    const items = derivePhaseStuckItems([so('1', 'open', { designAssigned: '2026-05-30' })], thr, TODAY);
    expect(items).toHaveLength(0);
  });

  it('skips closed / cancelled / dispatched SOs', () => {
    const stale = { designAssigned: '2026-01-01' };
    const closed = so('1', 'closed', stale);
    const cancelled = so('2', 'cancelled', stale);
    const dispatched = so('3', 'open', { ...stale, dispatched: '2026-05-30' });
    expect(derivePhaseStuckItems([closed, cancelled, dispatched], thr, TODAY)).toHaveLength(0);
  });

  it('flags planning when design ready (or BOM linked) but no plan', () => {
    const byApproval = derivePhaseStuckItems([so('1', 'open', { designApproved: '2026-05-01' })], thr, TODAY);
    expect(byApproval.map((i) => i.stage)).toContain('Planning');
    const byBom = derivePhaseStuckItems([so('2', 'open', { bomLinked: '2026-05-01' })], thr, TODAY);
    expect(byBom.map((i) => i.stage)).toContain('Planning');
  });

  it('flags dispatch-pending when assembly done but not dispatched', () => {
    const items = derivePhaseStuckItems([so('1', 'open', { assemblyDone: '2026-05-20' })], thr, TODAY);
    expect(items.map((i) => i.stage)).toContain('Dispatch Pending');
  });
});

describe('classifyOpStuck', () => {
  const cand = (over: Partial<OpStuckCandidate>): OpStuckCandidate => ({
    soId: '1',
    soNo: 'SO-1',
    customer: 'Acme',
    jcNo: 'JC-1',
    opSeq: 2,
    operation: 'Milling',
    available: 0,
    qcPending: 0,
    lastEntry: '2026-05-01',
    jcDate: '2026-04-01',
    ...over,
  });

  it('classifies qc-pending qty as QC Pending past qc threshold', () => {
    const item = classifyOpStuck(cand({ qcPending: 4 }), thr, TODAY);
    expect(item?.stage).toBe('QC Pending');
    expect(item?.detail).toContain('4 pcs');
  });

  it('classifies available work as Production Op past productionOp threshold', () => {
    const item = classifyOpStuck(cand({ available: 6 }), thr, TODAY);
    expect(item?.stage).toBe('Production Op');
    expect(item?.detail).toContain('6 avail');
  });

  it('returns null when under threshold', () => {
    const item = classifyOpStuck(cand({ available: 6, lastEntry: '2026-06-01' }), thr, TODAY);
    expect(item).toBeNull();
  });

  it('falls back to jcDate when there is no last entry', () => {
    const item = classifyOpStuck(cand({ available: 6, lastEntry: null }), thr, TODAY);
    expect(item?.since).toBe('2026-04-01');
  });
});
