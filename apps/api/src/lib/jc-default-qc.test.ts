import { describe, expect, it } from 'vitest';
import { DEFAULT_FINAL_QC_OP, needsDefaultQcOp } from './jc-default-qc';

const op = (opType: string) => ({ opType });

describe('needsDefaultQcOp (Rule B — terminal QC gate)', () => {
  it('appends Final Inspection for a pure in-house routing with no QC (SPACER case)', () => {
    expect(needsDefaultQcOp([op('process'), op('process'), op('process')])).toBe(true);
  });

  it('appends Final Inspection when a mid-route QC is followed by a process op (still uncredited)', () => {
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

  // ADR-179: a mid-route OSP followed by a machining op DOES get a terminal QC.
  // The machined output was never inspected, and it cannot double-credit (a
  // mid-route OSP return is not credited — ADR-092 — and a PO-linked JC credits
  // only at Production Order close — ADR-170).
  it('appends Final Inspection for a mid-route OSP followed by a process op (Turning → OSP → Milling)', () => {
    expect(needsDefaultQcOp([op('process'), op('outsource'), op('process')])).toBe(true);
  });

  it('leaves an empty routing untouched', () => {
    expect(needsDefaultQcOp([])).toBe(false);
  });

  it('exposes Final Inspection as the default stage name', () => {
    expect(DEFAULT_FINAL_QC_OP).toBe('Final Inspection');
  });
});
