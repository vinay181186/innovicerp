import { describe, expect, it } from 'vitest';

import {
  internalSoNoDigits,
  internalSoNoError,
  internalSoNoOfCode,
  internalSoNoTakenMessage,
  soNoFromInternal,
} from './internal-so-no';
import { createSalesOrderInputSchema } from '../schemas/sales-order';

// ADR-306 — the typed Internal SO No. is digits only and gives SO No. SO-<digits>.
describe('Internal SO No. (ADR-306)', () => {
  it('digits give SO-<digits>; a pasted "SO-433" and leading zeros are cleaned', () => {
    expect(soNoFromInternal('433')).toBe('SO-433');
    expect(soNoFromInternal(' so-433 ')).toBe('SO-433');
    expect(internalSoNoDigits('00433')).toBe('433');
  });

  it('refuses letters, 0 and more than 9 digits; blank is not an error here', () => {
    expect(internalSoNoError('433')).toBeNull();
    expect(internalSoNoError('')).toBeNull();
    expect(internalSoNoError('433A')).toMatch(/digits only/);
    expect(internalSoNoError('2401/A')).toMatch(/digits only/);
    expect(internalSoNoError('000')).toMatch(/cannot be 0/);
    expect(internalSoNoError('1234567890')).toMatch(/at most 9 digits/);
  });

  it('fills the edit box only from a typed number, never from a system number', () => {
    expect(internalSoNoOfCode('SO-433')).toBe('433');
    expect(internalSoNoOfCode('IN-SO-00014')).toBe('');
    expect(internalSoNoOfCode(null)).toBe('');
  });

  it('names the order that already holds the number', () => {
    expect(internalSoNoTakenMessage('SO-433', 'IN-SO-00013')).toMatch(
      /SO-433 is already used \(order IN-SO-00013\)/,
    );
  });

  it('the create schema cleans the digits and refuses 0 with its own message', () => {
    const base = {
      header: { soDate: '2026-11-17', clientId: '00000000-0000-4000-8000-000000000001' },
      lines: [],
    };
    const ok = createSalesOrderInputSchema.safeParse({
      ...base,
      header: { ...base.header, type: 'equipment', internalSoNo: '0433' },
    });
    expect(ok.success && ok.data.header.internalSoNo).toBe('433');
    const zero = createSalesOrderInputSchema.safeParse({
      ...base,
      header: { ...base.header, type: 'equipment', internalSoNo: '0' },
    });
    expect(zero.success).toBe(false);
    expect(JSON.stringify(zero.error?.issues)).toMatch(/cannot be 0/);
  });
});
