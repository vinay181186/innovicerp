import { describe, expect, it } from 'vitest';
import {
  PR_BALANCE_CLOSED_REASON,
  prCancelNote,
  prHeaderLinkBlockReason,
  prJcOpReleaseText,
  prOrderedBlockReason,
  prStatusWord,
} from './cancel-text';

describe('PR cancel wording (ADR-235)', () => {
  it('names a live PO line and the two ways out', () => {
    expect(prOrderedBlockReason(2, 40, false)).toBe(
      'Ln 2 ordered 40 — cancel that PO first, or use Close Balance',
    );
  });
  it('a short-closed PO is named with what it received', () => {
    expect(prOrderedBlockReason(1, 10, true)).toBe(
      'Ln 1 received 10 before the PO was short closed — use Close Balance',
    );
  });
  it('older header-only link and closed balance', () => {
    expect(prHeaderLinkBlockReason(5)).toContain('ordered 5');
    expect(PR_BALANCE_CLOSED_REASON).toContain('Short Closed');
  });
  it('effects and status words', () => {
    expect(prJcOpReleaseText('IN-JC-00007', 30, 'Plating')).toBe(
      'IN-JC-00007 Op 30 Plating — freed from this PR; it can take a fresh PR or be changed',
    );
    expect(prJcOpReleaseText('IN-JC-00007', 30, null)).toMatch(/^IN-JC-00007 Op 30 — /);
    expect(prCancelNote('IN-PR-00001')).toContain('IN-PR-00001 becomes Cancelled');
    expect(prStatusWord('po_created')).toBe('PO Created');
    expect(prStatusWord('odd')).toBe('odd');
  });
});
