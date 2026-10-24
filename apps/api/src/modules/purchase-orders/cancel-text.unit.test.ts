import { describe, expect, it } from 'vitest';
import {
  PO_CLOSED_REASON,
  poCancelNote,
  poGrnBlockReason,
  poJcOpReleaseText,
  poPartReceivedReason,
  poPrReopenText,
  poSentBlockReason,
  poStatusWord,
} from './cancel-text';

describe('PO cancel wording (ADR-235)', () => {
  it('blockers', () => {
    expect(poGrnBlockReason('1, 2', 15)).toBe(
      'received 15 on Ln 1, 2 — cancel that GRN first, or use Short Close',
    );
    expect(poGrnBlockReason(null, 0)).toBe('raised against this PO — cancel that GRN first');
    expect(poSentBlockReason('DC', '3', 8)).toBe(
      'sent 8 on Ln 3 to the vendor — cancel that DC first',
    );
    expect(poSentBlockReason('JW DC', null, 0)).toBe(
      'raised against this PO — cancel that JW DC first',
    );
    expect(poPartReceivedReason(10, 40)).toBe('Part received (10 of 40) — use Short Close');
    expect(PO_CLOSED_REASON).toContain('Closed');
  });
  it('effects', () => {
    expect(poPrReopenText('IN-PR-00012', 40, 2)).toBe(
      'IN-PR-00012: 40 back to Pending (was PO Ln 2)',
    );
    expect(poJcOpReleaseText('IN-JC-1', 30, 'Plating', { otherPo: true, prCode: 'X' })).toBe(
      'IN-JC-1 Op 30 Plating — stays on its other purchase order',
    );
    expect(poJcOpReleaseText('IN-JC-1', 30, null, { otherPo: false, prCode: 'IN-PR-9' })).toBe(
      'IN-JC-1 Op 30 — back to PR Raised (IN-PR-9), ready for a new PO',
    );
    expect(poJcOpReleaseText('IN-JC-1', 30, null, { otherPo: false, prCode: null })).toBe(
      'IN-JC-1 Op 30 — back to no PR; a fresh PR is needed',
    );
    expect(poCancelNote('IN-PO-1')).toContain('IN-PO-1 becomes Cancelled');
    expect(poStatusWord('partial')).toBe('Partly Received');
  });
});
