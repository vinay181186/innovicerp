// Unit test for the Production Order close guard (ADR-170, partial close in
// ADR-179). Pure function, no database. Runnable on its own with
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
  creditedQty: 0,
};

describe('closeBlockedReason (ADR-170 + partial close ADR-179)', () => {
  // ADR-182 — a short-closed order is dead: nothing more may be closed on it,
  // and the sentence says when it was stopped so the screen can explain itself.
  it('blocks Close on a short-closed order and names the date', () => {
    expect(
      closeBlockedReason({
        ...base,
        status: 'short_closed',
        shortClosedAt: '2026-09-24T06:15:00.000Z',
      }),
    ).toBe('No further close — this order was short closed on 2026-09-24');
  });

  it('never prints the word "null" when a short-closed row has no date', () => {
    const reason = closeBlockedReason({ ...base, status: 'short_closed', shortClosedAt: null });
    expect(reason).toContain('No further close');
    expect(reason).not.toContain('null');
  });

  it('allows Close when the JC is complete', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'complete' })).toBeNull();
  });

  it('allows Close when the JC is already closed (sales cascade closed it first)', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: 'closed' })).toBeNull();
  });

  // ADR-179: partial close no longer needs the JC to be complete — finished
  // pieces can be credited as they clear. An open JC with 48 finished / 0
  // credited has 48 available to close now.
  it('allows a partial close of an in-progress JC that has finished pieces', () => {
    expect(closeBlockedReason(base)).toBeNull();
  });

  it('allows Close for an open JC that is settled with losses (48 of 50, 2 scrapped)', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithLosses: true })).toBeNull();
  });

  it('allows Close for a settled-with-losses JC that lost every piece (finished 0)', () => {
    expect(closeBlockedReason({ ...base, jcSettledWithLosses: true, jcFinishedQty: 0 })).toBeNull();
  });

  // ADR-179: a partially-closed PO with more finished pieces to credit.
  it('allows another close when finished > credited (48 finished, 20 credited)', () => {
    expect(closeBlockedReason({ ...base, status: 'partially_closed', creditedQty: 20 })).toBeNull();
  });

  it('blocks when nothing new is available and the JC is not done (all finished credited)', () => {
    expect(
      closeBlockedReason({
        ...base,
        status: 'partially_closed',
        jcFinishedQty: 20,
        creditedQty: 20,
      }),
    ).toBe(
      'No finished pieces to close yet for Job Card IN-JC-26-00055 (open) — credit pieces as its operations clear, or finish the order once it is complete',
    );
  });

  it('blocks an in-progress JC with nothing finished yet', () => {
    expect(closeBlockedReason({ ...base, jcFinishedQty: 0 })).toBe(
      'No finished pieces to close yet for Job Card IN-JC-26-00055 (open) — credit pieces as its operations clear, or finish the order once it is complete',
    );
  });

  it('allows finishing a complete JC even when everything finished is already credited', () => {
    // available 0 but jcDone (complete) → finish/close-short is possible.
    expect(
      closeBlockedReason({
        ...base,
        jcComputedStatus: 'complete',
        jcFinishedQty: 48,
        creditedQty: 48,
      }),
    ).toBeNull();
  });

  it('blocks a PO that is already fully closed, before looking at the JC', () => {
    expect(closeBlockedReason({ ...base, status: 'closed', jcComputedStatus: 'complete' })).toBe(
      'Production Order is already fully closed',
    );
  });

  it('reads a missing JC row (null status) with nothing finished as no_ops and blocks', () => {
    expect(closeBlockedReason({ ...base, jcComputedStatus: null, jcFinishedQty: 0 })).toBe(
      'No finished pieces to close yet for Job Card IN-JC-26-00055 (no_ops) — credit pieces as its operations clear, or finish the order once it is complete',
    );
  });
});
