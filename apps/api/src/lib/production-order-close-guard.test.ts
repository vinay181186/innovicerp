// Unit test for the ADR-170 Production Order close guard. Pure function, no
// database. Runnable on its own with
// `npx vitest run src/lib/production-order-close-guard.test.ts` — vitest's
// globalSetup is a no-op without DATABASE_URL in the environment.

import { describe, expect, it } from 'vitest';
import { closeBlockedReason, type CloseGuardInput } from './production-order-close-guard';

const base: CloseGuardInput = {
  status: 'open',
  jcCodeText: 'IN-JC-26-00055',
  jcComputedStatus: 'open',
  jcFinishedQty: 48,
  jcSettledWithLosses: false,
};

describe('closeBlockedReason (ADR-170)', () => {
  it('allows Close when the JC is complete', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'complete' })).toBeNull();
  });

  it('allows Close when the JC is already closed (sales cascade closed it first)', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'closed' })).toBeNull();
  });

  it('blocks an open JC with nothing lost, naming the JC and its status', () => {
    expect(closeBlockedReason(base)).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (open) — finish all operations before closing',
    );
  });

  // TEST run 2026-09-17, flow-po.spec.ts S1-d: 50 ordered, 2 scrapped at DIR,
  // 48 finished — v_jc_status says 'open' for good, yet nothing is left to do.
  it('allows Close for an open JC that is settled with losses (48 of 50, 2 scrapped)', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithLosses: true })).toBeNull();
  });

  // Total loss: every piece scrapped / failed / made fresh. The service closes
  // it with credited_qty 0 and no stock row — the guard must let it through.
  it('allows Close for a settled-with-losses JC that lost every piece (finished 0)', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithLosses: true, jcFinishedQty: 0 })).toBeNull();
  });

  it('blocks a complete JC whose last op accepted nothing (not settled — inconsistent data)', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'complete', jcFinishedQty: 0 })).toBe(
      'Job Card IN-JC-26-00055 reads complete but has no finished quantity to credit — nothing was accepted at its last operation; check its QC entries before closing',
    );
  });

  it('blocks a closed JC whose last op accepted nothing, naming the status it reads', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'closed', jcFinishedQty: 0 })).toBe(
      'Job Card IN-JC-26-00055 reads closed but has no finished quantity to credit — nothing was accepted at its last operation; check its QC entries before closing',
    );
  });

  it('blocks a PO that is already closed, before looking at the JC', () => {
    expect(closeBlockedReason({ ...base, status: 'closed', jcComputedStatus: 'complete' })).toBe(
      'Production Order is already closed',
    );
  });

  it('blocks a PO that is already closed even when the JC is settled with losses', () => {
    expect(closeBlockedReason({ ...base, status: 'closed', jcSettledWithLosses: true })).toBe(
      'Production Order is already closed',
    );
  });

  it('reads a missing JC row (null status) as no_ops and blocks', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: null })).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (no_ops) — finish all operations before closing',
    );
  });

  it('blocks qc_pending even when pieces were lost but the JC is not settled', () => {
    expect(
      closeBlockedReason({ ...base, jcComputedStatus: 'qc_pending', jcSettledWithLosses: false }),
    ).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (qc_pending) — finish all operations before closing',
    );
  });

  it('blocks an open JC with 0 finished when it is not settled (nothing lost, nothing done)', () => {
    expect(closeBlockedReason({ ...base, jcFinishedQty: 0 })).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (open) — finish all operations before closing',
    );
  });
});
