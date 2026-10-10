import { describe, expect, it } from 'vitest';
import { DEFAULT_FINAL_QC_OP, needsDefaultQcOp } from './jc-default-qc';

const op = (opType: string) => ({ opType });
/** An op with a NAME. Rule B deliberately does NOT read the name — these cases
 *  exist to prove that, because a "Final Inspection" a PERSON placed mid-route
 *  is indistinguishable by name from the one the system appends. */
const named = (opType: string, operation: string) => ({ opType, operation });
const finalInspection = () => named('qc', 'Final Inspection');

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

// ADR-227 — Rule B is NAME-BLIND, and it must stay that way.
//
// The system's own "Final Inspection" and one a PERSON placed mid-route are
// identical by name and by type; only the stored row id tells them apart, and
// this function never sees ids. An earlier attempt made it answer false as soon
// as ANY op in the routing was named "Final Inspection" — that stopped the
// terminal QC being appended to a card that genuinely ends on a machining step,
// so qc_accept never fired on the last op and the finished pieces were never
// credited to stock. The displaced routing is refused by the Job Card writer
// instead (assertTerminalQcUnchanged); this gate stays exactly as Rule B wrote
// it.
describe('needsDefaultQcOp — name-blind: a mid-route Final Inspection changes nothing', () => {
  it("STILL appends when a person's own mid-route Final Inspection is followed by machining", () => {
    // THE REGRESSION THIS FILE EXISTS TO CATCH. Turning → Final Inspection (the
    // person's own, mid-route) → Milling. The card ends on a machining step, so
    // without the appended terminal QC nothing ever credits the finished pieces
    // to stock — the exact defect Rule B was written for.
    expect(
      needsDefaultQcOp([
        named('process', 'Turning'),
        finalInspection(),
        named('process', 'Milling'),
      ]),
    ).toBe(true);
  });

  it('STILL appends when the routing opens with a Final Inspection and ends on machining', () => {
    expect(needsDefaultQcOp([finalInspection(), named('process', 'Turning')])).toBe(true);
  });

  it('STILL appends when the mid-route Final Inspection is written in any case or padding', () => {
    expect(
      needsDefaultQcOp([
        named('process', 'Turning'),
        named('qc', '  final inspection  '),
        named('process', 'Milling'),
      ]),
    ).toBe(true);
  });

  it('appends for a mid-route QC of any other kind too (MIR / TPI / DIR)', () => {
    expect(
      needsDefaultQcOp([
        named('process', 'Turning'),
        named('qc', 'MIR'),
        named('process', 'Milling'),
      ]),
    ).toBe(true);
    expect(
      needsDefaultQcOp([
        named('process', 'Turning'),
        named('qc', 'TPI'),
        named('process', 'Milling'),
      ]),
    ).toBe(true);
  });

  it('appends for a routing with no Final Inspection at all (ops carrying names)', () => {
    expect(needsDefaultQcOp([named('process', 'Turning'), named('process', 'Milling')])).toBe(true);
  });

  it('appends nothing when the routing already ENDS with the Final Inspection', () => {
    // The idempotent case: the op comes back last on edit and no second one is
    // added, because the last op is already QC.
    expect(needsDefaultQcOp([named('process', 'Turning'), finalInspection()])).toBe(false);
  });

  it('leaves the rework / repair child rule exactly as it was', () => {
    // Interlock 3 (docs/QC-NC-HANDLING-DESIGN.md §4.5): a recovery child ALWAYS
    // gets the terminal QC unless its last op is already QC.
    expect(needsDefaultQcOp([named('process', 'Rework Turning')], { recoveryKind: 'rework' })).toBe(
      true,
    );
    expect(needsDefaultQcOp([named('outsource', 'Re-plating')], { recoveryKind: 'rework' })).toBe(
      true,
    );
    expect(
      needsDefaultQcOp([named('process', 'Rework Turning'), finalInspection()], {
        recoveryKind: 'rework',
      }),
    ).toBe(false);
  });
});
