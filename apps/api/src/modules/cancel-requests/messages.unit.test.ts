import { describe, expect, it } from 'vitest';
import {
  alreadyDecidedMessage,
  alreadyPendingMessage,
  blockerRefusal,
  formatIst,
} from './messages';

describe('cancel-request messages (ADR-235)', () => {
  it('lists every blocker in order', () => {
    const msg = blockerRefusal('IN-CD-00012', [
      {
        docLabel: 'Invoice',
        docNo: 'IN-INV-00031',
        href: null,
        reason: 'Ln 2 is invoiced (40 pcs)',
      },
      {
        docLabel: 'Invoice',
        docNo: 'IN-INV-00032',
        href: '/invoices/x',
        reason: 'Ln 3 is invoiced (5 pcs)',
      },
    ]);
    expect(msg).toBe(
      "IN-CD-00012 can't be cancelled yet — cancel these first: Invoice IN-INV-00031 (Ln 2 is invoiced (40 pcs)); Invoice IN-INV-00032 (Ln 3 is invoiced (5 pcs)).",
    );
  });

  it('names the requester when known', () => {
    expect(alreadyPendingMessage('IN-INV-00001', 'Jinal')).toBe(
      'A cancel request for IN-INV-00001 is already pending (requested by Jinal).',
    );
    expect(alreadyPendingMessage('IN-INV-00001', null)).toBe(
      'A cancel request for IN-INV-00001 is already pending.',
    );
  });

  it('formats the decided time in IST', () => {
    expect(formatIst(new Date('2026-10-24T09:02:00Z'))).toBe('24-10-2026 14:32');
    expect(alreadyDecidedMessage('IN-INV-1', 'rejected', 'Rakesh', '2026-10-24T09:02:00Z')).toBe(
      'The cancel request for IN-INV-1 was already rejected by Rakesh at 24-10-2026 14:32 — reload the page.',
    );
    expect(alreadyDecidedMessage('IN-INV-1', 'approved', null, null)).toBe(
      'The cancel request for IN-INV-1 was already approved — reload the page.',
    );
  });
});
