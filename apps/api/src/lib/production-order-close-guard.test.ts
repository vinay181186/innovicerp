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
  jcSettledWithScrap: false,
};

describe('closeBlockedReason (ADR-170)', () => {
  it('allows Close when the JC is complete', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'complete' })).toBeNull();
  });

  it('allows Close when the JC is already closed (sales cascade closed it first)', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'closed' })).toBeNull();
  });

  it('blocks an open JC with nothing scrapped, naming the JC and its status', () => {
    expect(closeBlockedReason(base)).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (open) — finish all operations before closing',
    );
  });

  // TEST run 2026-09-17, flow-po.spec.ts S1-d: 50 ordered, 2 scrapped at DIR,
  // 48 finished — v_jc_status says 'open' for good, yet nothing is left to do.
  it('allows Close for an open JC that is settled with scrap (48 of 50, 2 scrapped)', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithScrap: true })).toBeNull();
  });

  it('settled-with-scrap still needs a finished qty to credit', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithScrap: true, jcFinishedQty: 0 })).toBe(
      'Job Card IN-JC-26-00055 has no finished quantity to credit — nothing was accepted at its last operation',
    );
  });

  it('blocks a complete JC whose last op accepted nothing', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'complete', jcFinishedQty: 0 })).toBe(
      'Job Card IN-JC-26-00055 has no finished quantity to credit — nothing was accepted at its last operation',
    );
  });

  it('blocks a PO that is already closed, before looking at the JC', () => {
    expect(closeBlockedReason({ ...base, status: 'closed', jcComputedStatus: 'complete' })).toBe(
      'Production Order is already closed',
    );
  });

  it('reads a missing JC row (null status) as no_ops and blocks', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: null })).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (no_ops) — finish all operations before closing',
    );
  });

  it('blocks qc_pending even when scrap exists but the JC is not settled', () => {
    expect(
      closeBlockedReason({ ...base, jcComputedStatus: 'qc_pending', jcSettledWithScrap: false }),
    ).toBe(
      'Job Card IN-JC-26-00055 is not complete yet (qc_pending) — finish all operations before closing',
    );
  });
});
