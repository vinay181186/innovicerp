import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { assertCompanyStoragePath } from './storage-path';

describe('assertCompanyStoragePath', () => {
  const cid = '11111111-1111-1111-1111-111111111111';
  it('accepts a path in the company folder', () => {
    expect(() => assertCompanyStoragePath(`${cid}/qc/a.pdf`, cid)).not.toThrow();
  });
  it('accepts no path (nothing attached)', () => {
    expect(() => assertCompanyStoragePath(undefined, cid)).not.toThrow();
    expect(() => assertCompanyStoragePath(null, cid)).not.toThrow();
    expect(() => assertCompanyStoragePath('  ', cid)).not.toThrow();
  });
  it("refuses another company's folder, a bare prefix, and a relative escape", () => {
    for (const p of [
      '22222222-2222-2222-2222-222222222222/qc/a.pdf',
      cid,
      `x/${cid}/a.pdf`,
      `${cid}/../22222222-2222-2222-2222-222222222222/a.pdf`,
      `${cid}/./a.pdf`,
      `${cid}//a.pdf`,
      `${cid}/qc\\..\\a.pdf`,
    ]) {
      expect(() => assertCompanyStoragePath(p, cid)).toThrow(ValidationError);
    }
  });
});
