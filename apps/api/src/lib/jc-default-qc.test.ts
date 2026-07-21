import { describe, expect, it } from 'vitest';
import { DEFAULT_FINAL_QC_OP, needsDefaultQcOp } from './jc-default-qc';

const op = (opType: string) => ({ opType });

describe('needsDefaultQcOp (Rule B — terminal QC gate)', () => {
  it('appends DIR for a pure in-house routing with no QC (SPACER case)', () => {
    expect(needsDefaultQcOp([op('process'), op('process'), op('process')])).toBe(true);
  });

  it('appends DIR when a mid-route QC is followed by a process op (still uncredited)', () => {
    expect(needsDefaultQcOp([op('process'), op('qc'), op('process')])).toBe(true);
  });

  it('leaves a JC whose last op is already QC untouched', () => {
    expect(needsDefaultQcOp([op('process'), op('qc')])).toBe(false);
    expect(needsDefaultQcOp([op('qc')])).toBe(false);
  });

  it('leaves an outsource-last JC untouched (credited on OSP receive — SO-517)', () => {
    expect(needsDefaultQcOp([op('outsource')])).toBe(false);
    expect(needsDefaultQcOp([op('process'), op('outsource')])).toBe(false);
  });

  it('leaves any JC containing an outsource op untouched (avoids grn_qc + qc_accept double-credit)', () => {
    expect(needsDefaultQcOp([op('process'), op('outsource'), op('process')])).toBe(false);
  });

  it('leaves an empty routing untouched', () => {
    expect(needsDefaultQcOp([])).toBe(false);
  });

  it('exposes DIR as the default stage name', () => {
    expect(DEFAULT_FINAL_QC_OP).toBe('DIR');
  });
});
