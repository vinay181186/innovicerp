// Unit tests for the pure print helpers ported from legacy printPO
// (number format + Indian amount-in-words, L25933/L25950). These feed
// vendor-facing PO totals, so a regression here mis-prints money.

import type { EffectivePrintTemplate } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { amountInWords, fmtDate, inrFormat, templatesToBlocks } from './doc-print';

describe('inrFormat', () => {
  it('groups in the Indian system with 2 decimals', () => {
    expect(inrFormat(500)).toBe('500.00');
    expect(inrFormat(100000)).toBe('1,00,000.00');
    expect(inrFormat(12345678.5)).toBe('1,23,45,678.50');
  });
});

describe('amountInWords', () => {
  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Indian Rupees Zero Only');
  });
  it('handles lakhs and thousands', () => {
    expect(amountInWords(100000)).toBe('Indian Rupees One Lakh Only');
    expect(amountInWords(118000)).toBe('Indian Rupees One Lakh Eighteen Thousand Only');
  });
  it('handles crores', () => {
    expect(amountInWords(12345678)).toBe(
      'Indian Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
  });
  it('appends paise when present', () => {
    expect(amountInWords(100.5)).toBe('Indian Rupees One Hundred and Fifty Paise Only');
  });
});

describe('fmtDate', () => {
  it('reformats YYYY-MM-DD to dd-MM-yyyy with no timezone shift', () => {
    expect(fmtDate('2026-05-27')).toBe('27-05-2026');
    expect(fmtDate('2026-05-27T10:00:00Z')).toBe('27-05-2026');
  });
  it('returns empty for nullish', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });
});

describe('templatesToBlocks', () => {
  it('filters to one doc and keys by block name', () => {
    const templates = [
      { doc: 'PO', block: 'terms', content: 'po terms' },
      { doc: 'PO', block: 'footer', content: 'po footer' },
      { doc: 'OSP DC', block: 'terms', content: 'osp terms' },
    ] as EffectivePrintTemplate[];
    expect(templatesToBlocks('PO', templates)).toEqual({
      terms: 'po terms',
      footer: 'po footer',
    });
  });
});
