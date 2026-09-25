// Unit test for the NC number series (ADR-183). Pure, no database — runnable
// on its own with `npx vitest run src/lib/nc-code.test.ts`.

import { describe, expect, it } from 'vitest';
import { highestNcNumber, nextNcCodeFrom } from './nc-code';

describe('NC number series', () => {
  it('starts at NC-00001 when the company has no NCs', () => {
    expect(nextNcCodeFrom([])).toBe('NC-00001');
  });

  it('continues from the highest strict code, not the last one seen', () => {
    expect(nextNcCodeFrom(['NC-00001', 'NC-00007', 'NC-00003'])).toBe('NC-00008');
  });

  // The whole point of the strict shape: the old auto codes and anything a
  // person typed by hand must not be able to move the series.
  it('ignores the legacy NC-AUTO-… codes', () => {
    expect(nextNcCodeFrom(['NC-AUTO-IN-JC-26-00018-Op10-143052123', 'NC-00004'])).toBe('NC-00005');
  });

  it('ignores hand-typed codes that only look like the series', () => {
    const odd = ['NC-12/A', 'NC-2026-0001', 'nc-00099', 'NC- 7', 'NC-', 'QC-00005', '00006'];
    expect(nextNcCodeFrom([...odd, 'NC-00002'])).toBe('NC-00003');
  });

  it('ignores a split sibling so a partial disposition never skips a number', () => {
    // disposeNcCascade codes siblings NC-00042/2, /3 … — not part of the series.
    expect(nextNcCodeFrom(['NC-00042', 'NC-00042/2', 'NC-00042/3'])).toBe('NC-00043');
  });

  it('tolerates nulls, blanks and surrounding whitespace', () => {
    expect(nextNcCodeFrom([null, undefined, '', '   ', '  NC-00010  '])).toBe('NC-00011');
  });

  it('keeps five digits, and grows past them rather than wrapping', () => {
    expect(nextNcCodeFrom(['NC-00099'])).toBe('NC-00100');
    expect(nextNcCodeFrom(['NC-99999'])).toBe('NC-100000');
  });

  it('reports the highest number on its own', () => {
    expect(highestNcNumber([])).toBe(0);
    expect(highestNcNumber(['NC-00001', 'NC-00025'])).toBe(25);
  });
});
