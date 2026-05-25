import { describe, expect, it } from 'vitest';
import {
  isPrintTemplateKey,
  PRINT_TEMPLATE_DEFAULTS,
  PRINT_TEMPLATE_KEYS,
  PRINT_TEMPLATE_META,
  printTemplateDocType,
  substituteTemplateVars,
  unknownTemplateVars,
} from './print-template';

describe('print-template helpers', () => {
  it('exposes exactly 15 keys (3 docs × 5 blocks) with a default each', () => {
    expect(PRINT_TEMPLATE_KEYS).toHaveLength(15);
    expect(PRINT_TEMPLATE_META).toHaveLength(15);
    for (const key of PRINT_TEMPLATE_KEYS) {
      expect(PRINT_TEMPLATE_DEFAULTS).toHaveProperty(key);
    }
  });

  it('maps keys to doc types', () => {
    expect(printTemplateDocType('po_terms')).toBe('PO');
    expect(printTemplateDocType('ospdc_footer')).toBe('OSP DC');
    expect(printTemplateDocType('jwdc_signature')).toBe('JW DC');
    expect(printTemplateDocType('nonsense')).toBeNull();
  });

  it('validates known keys', () => {
    expect(isPrintTemplateKey('po_header_note')).toBe(true);
    expect(isPrintTemplateKey('po_unknown')).toBe(false);
  });

  it('substitutes known variables and blanks unknown ones (not the literal token)', () => {
    expect(substituteTemplateVars('PO {poNo} dated {poDate}', { poNo: 'IN-PO-1', poDate: '01-01' })).toBe(
      'PO IN-PO-1 dated 01-01',
    );
    // unknown var → blank
    expect(substituteTemplateVars('Hello {missing} world', {})).toBe('Hello  world');
    // null value → blank
    expect(substituteTemplateVars('x {v} y', { v: null })).toBe('x  y');
    // empty input → empty
    expect(substituteTemplateVars('', { v: '1' })).toBe('');
    expect(substituteTemplateVars(null, {})).toBe('');
  });

  it('reports unknown variables against the allowed set', () => {
    expect(unknownTemplateVars('uses {poNo} and {bogus} and {alsoBad}', ['poNo'])).toEqual([
      'bogus',
      'alsoBad',
    ]);
    expect(unknownTemplateVars('all {poNo} good', ['poNo'])).toEqual([]);
    // dedupes repeats
    expect(unknownTemplateVars('{x} {x} {x}', [])).toEqual(['x']);
  });
});
