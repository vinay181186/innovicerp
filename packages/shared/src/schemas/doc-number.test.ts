// Pure unit tests for the doc-number shared config (format, padding, contract).
// The exists/next-code DB behaviour is covered by the API route test.

import { describe, expect, it } from 'vitest';
import {
  DOC_NUMBER_FORMATS,
  DOC_NUMBER_TYPES,
  bumpDocRevision,
  checkDocNumberQuerySchema,
  docNumberError,
  docNumberPattern,
  evaluateDocNumber,
  padDocNumber,
  parseDocRevision,
  poCodePrefix,
} from './doc-number';

describe('doc-number config', () => {
  it('defines the document-number types', () => {
    expect([...DOC_NUMBER_TYPES]).toEqual([
      'sales_order',
      'job_work_order',
      'purchase_order',
      'grn',
      'delivery_challan',
    ]);
    expect(DOC_NUMBER_FORMATS.sales_order).toEqual({ prefix: 'IN-SO-', digits: 5, label: 'SO No.' });
    expect(DOC_NUMBER_FORMATS.job_work_order).toEqual({
      prefix: 'IN-JW-',
      digits: 5,
      label: 'JWSO No.',
    });
    // `prefix` on the PO format is the FROZEN legacy series, kept as the
    // fallback for a bare typed number. A new PO is numbered from its type's
    // own series instead — see poCodePrefix below.
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

describe('PO series + document revisions (2026-09-11)', () => {
  it('numbers each PO type in its own series', () => {
    expect(poCodePrefix('standard')).toBe('IN-MPO-');
    expect(poCodePrefix('job_work')).toBe('IN-JWPO-');
    expect(poCodePrefix('service')).toBe('IN-SPO-');
    expect(poCodePrefix('outsource')).toBe('IN-OPO-');
  });

  it('reads a bare code as revision 1 and a /R code as its number', () => {
    expect(parseDocRevision('IN-MPO-00005')).toEqual({ base: 'IN-MPO-00005', revision: 1 });
    expect(parseDocRevision('IN-MPO-00005/R1')).toEqual({ base: 'IN-MPO-00005', revision: 1 });
    expect(parseDocRevision('IN-MPO-00005/R12')).toEqual({ base: 'IN-MPO-00005', revision: 12 });
    // Lower case, and the trailing space a paste can leave behind.
    expect(parseDocRevision('IN-PO-00005/r2 ')).toEqual({ base: 'IN-PO-00005', revision: 2 });
    expect(parseDocRevision(null)).toEqual({ base: '', revision: 1 });
  });

  it('bumps a revision, and takes a legacy bare code straight to /R2', () => {
    expect(bumpDocRevision('IN-PO-00005')).toBe('IN-PO-00005/R2');
    expect(bumpDocRevision('IN-MPO-00005/R1')).toBe('IN-MPO-00005/R2');
    expect(bumpDocRevision('IN-MPO-00005/R9')).toBe('IN-MPO-00005/R10');
    // The base never changes, however many times it is bumped.
    expect(parseDocRevision(bumpDocRevision(bumpDocRevision('IN-SPO-00007/R1'))).base).toBe(
      'IN-SPO-00007',
    );
  });

  it('accepts every PO series, with or without a revision', () => {
    const ok = docNumberPattern('purchase_order');
    expect(ok.test('IN-MPO-00005/R1')).toBe(true);
    expect(ok.test('IN-JWPO-00005/R2')).toBe(true);
    expect(ok.test('IN-SPO-00005')).toBe(true);
    expect(ok.test('IN-OPO-00005')).toBe(true);
    expect(ok.test('IN-PO-00042')).toBe(true); // the frozen legacy series
    expect(ok.test('IN-MPO-5/R1')).toBe(false); // digits still exact
    expect(ok.test('IN-XPO-00005')).toBe(false); // not a series
    expect(ok.test('IN-MPO-00005/R')).toBe(false); // /R needs a number
    expect(ok.test('IN-SO-00005')).toBe(false); // still not a sales order
  });

  it('puts a revision on the challan too, and on nothing else', () => {
    expect(docNumberPattern('delivery_challan').test('IN-DC-00005/R1')).toBe(true);
    expect(docNumberPattern('sales_order').test('IN-SO-00005/R1')).toBe(false);
    expect(docNumberPattern('grn').test('IN-GRN-00005/R1')).toBe(false);
  });

  it('pads without losing the typed series or the revision', () => {
    expect(padDocNumber('purchase_order', 'IN-JWPO-7')).toBe('IN-JWPO-00007');
    expect(padDocNumber('purchase_order', 'IN-MPO-7/R2')).toBe('IN-MPO-00007/R2');
    expect(padDocNumber('purchase_order', 'IN-PO-7')).toBe('IN-PO-00007');
    expect(padDocNumber('delivery_challan', 'IN-DC-9/R3')).toBe('IN-DC-00009/R3');
    // A bare number still falls back to the type's default series.
    expect(padDocNumber('purchase_order', '7')).toBe('IN-PO-00007');
  });
});
