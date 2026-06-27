// Pure unit tests for the doc-number shared config (format, padding, contract).
// The exists/next-code DB behaviour is covered by the API route test.

import { describe, expect, it } from 'vitest';
import {
  DOC_NUMBER_FORMATS,
  DOC_NUMBER_TYPES,
  checkDocNumberQuerySchema,
  docNumberError,
  docNumberPattern,
  evaluateDocNumber,
  padDocNumber,
} from './doc-number';

describe('doc-number config', () => {
  it('defines all three Phase-1 types', () => {
    expect([...DOC_NUMBER_TYPES]).toEqual(['sales_order', 'purchase_order', 'grn']);
    expect(DOC_NUMBER_FORMATS.sales_order).toEqual({ prefix: 'IN-SO-', digits: 5, label: 'SO No.' });
    expect(DOC_NUMBER_FORMATS.purchase_order.prefix).toBe('IN-PO-');
    expect(DOC_NUMBER_FORMATS.grn.prefix).toBe('IN-GRN-');
  });

  describe('docNumberPattern', () => {
    it('accepts the strict canonical form', () => {
      expect(docNumberPattern('sales_order').test('IN-SO-00001')).toBe(true);
      expect(docNumberPattern('purchase_order').test('IN-PO-00042')).toBe(true);
      expect(docNumberPattern('grn').test('IN-GRN-00007')).toBe(true);
    });
    it('rejects wrong prefix / digit count', () => {
      expect(docNumberPattern('sales_order').test('SO-00001')).toBe(false); // spec's SO- shape
      expect(docNumberPattern('sales_order').test('IN-SO-1')).toBe(false); // too few digits
      expect(docNumberPattern('sales_order').test('IN-SO-000001')).toBe(false); // too many
      expect(docNumberPattern('sales_order').test('IN-SO-0001A')).toBe(false); // non-digit
      expect(docNumberPattern('purchase_order').test('IN-SO-00001')).toBe(false); // wrong type
    });
  });

  describe('padDocNumber', () => {
    it('zero-pads a short value, keeping/adding the prefix', () => {
      expect(padDocNumber('sales_order', 'IN-SO-126')).toBe('IN-SO-00126');
      expect(padDocNumber('sales_order', '126')).toBe('IN-SO-00126');
      expect(padDocNumber('purchase_order', 'IN-PO-7')).toBe('IN-PO-00007');
    });
    it('leaves a canonical value unchanged and passes through blanks', () => {
      expect(padDocNumber('sales_order', 'IN-SO-00126')).toBe('IN-SO-00126');
      expect(padDocNumber('sales_order', '')).toBe('');
      expect(padDocNumber('sales_order', '   ')).toBe('');
    });
  });

  describe('evaluateDocNumber', () => {
    it('empty value → use auto-generated, no check', () => {
      const r = evaluateDocNumber('sales_order', '   ');
      expect(r.isEmpty).toBe(true);
      expect(r.shouldCheck).toBe(false);
      expect(r.formatInvalid).toBe(false);
    });
    it('valid format → should check the backend', () => {
      const r = evaluateDocNumber('sales_order', 'IN-SO-00010');
      expect(r.shouldCheck).toBe(true);
      expect(r.formatInvalid).toBe(false);
      expect(r.padded).toBe('IN-SO-00010');
    });
    it('invalid format → flagged, NO backend check', () => {
      const r = evaluateDocNumber('sales_order', 'SO-1');
      expect(r.formatInvalid).toBe(true);
      expect(r.shouldCheck).toBe(false);
      expect(r.padded).toBe('IN-SO-00001'); // pad still suggests the canonical form
    });
  });

  describe('docNumberError', () => {
    it('returns exact spec messages', () => {
      expect(docNumberError('sales_order', { formatInvalid: true, duplicate: false })).toBe(
        'Invalid format — expected IN-SO-NNNNN',
      );
      expect(docNumberError('sales_order', { formatInvalid: false, duplicate: true })).toBe(
        'Duplicate — this number already exists',
      );
      expect(docNumberError('sales_order', { formatInvalid: false, duplicate: false })).toBeNull();
    });
  });

  describe('checkDocNumberQuerySchema', () => {
    it('accepts a valid type with/without a code', () => {
      expect(checkDocNumberQuerySchema.safeParse({ type: 'sales_order' }).success).toBe(true);
      expect(checkDocNumberQuerySchema.safeParse({ type: 'grn', code: 'IN-GRN-00001' }).success).toBe(true);
    });
    it('rejects an unknown type and over-long code', () => {
      expect(checkDocNumberQuerySchema.safeParse({ type: 'bogus' }).success).toBe(false);
      expect(checkDocNumberQuerySchema.safeParse({}).success).toBe(false);
      expect(
        checkDocNumberQuerySchema.safeParse({ type: 'sales_order', code: 'x'.repeat(65) }).success,
      ).toBe(false);
    });
  });
});
