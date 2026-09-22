import { describe, expect, it } from 'vitest';
import {
  isGeneratedTerminalQcOp,
  isTpiOp,
  stripStaleGeneratedTerminalQc,
  findQcDirectlyAfterOutsource,
  opPairKey,
  qcAfterOutsourceError,
  qcAfterOutsourceMessage,
} from './jc-op-sequence';

const p = { opType: 'process' };
const q = { opType: 'qc' };
const o = { opType: 'outsource' };

describe('findQcDirectlyAfterOutsource (OSP → QC rule)', () => {
  it('refuses a QC op directly after an OSP op', () => {
    expect(findQcDirectlyAfterOutsource([p, o, q])).toBe(2);
    expect(findQcDirectlyAfterOutsource([o, q])).toBe(1);
  });

  it('allows OSP → Operation → QC', () => {
    expect(findQcDirectlyAfterOutsource([p, o, p, q])).toBeNull();
  });

  it('does not block QC in general', () => {
    expect(findQcDirectlyAfterOutsource([p, q, p, q])).toBeNull();
    expect(findQcDirectlyAfterOutsource([q, p, o])).toBeNull();
    expect(findQcDirectlyAfterOutsource([o])).toBeNull();
    expect(findQcDirectlyAfterOutsource([])).toBeNull();
  });

  it('reports the FIRST violation only', () => {
    expect(findQcDirectlyAfterOutsource([o, q, p, o, q])).toBe(1);
  });

  it('grandfathers a pair that was already saved that way', () => {
    const ops = [
      { opType: 'process', id: 'a' },
      { opType: 'outsource', id: 'b' },
      { opType: 'qc', id: 'c' },
    ];
    expect(findQcDirectlyAfterOutsource(ops, new Set([opPairKey('b', 'c')]))).toBeNull();
    // a different QC op slotted in after the same OSP op is still refused
    expect(
      findQcDirectlyAfterOutsource(
        [ops[0]!, ops[1]!, { opType: 'qc', id: 'z' }],
        new Set([opPairKey('b', 'c')]),
      ),
    ).toBe(2);
    // a new (unsaved) QC op has no id and is never grandfathered
    expect(
      findQcDirectlyAfterOutsource(
        [ops[0]!, ops[1]!, { opType: 'qc' }],
        new Set([opPairKey('b', 'c')]),
      ),
    ).toBe(2);
  });

  it('names the ops the way people see them (10, 20, 30 …)', () => {
    expect(qcAfterOutsourceMessage(2)).toMatch(
      /^Op 30 \(QC\) cannot directly follow Op 20 \(OSP\)/,
    );
    expect(qcAfterOutsourceError([p, o, q])).toMatch(/^Op 30 \(QC\)/);
    expect(qcAfterOutsourceError([p, o, p, q])).toBeNull();
  });
});

describe('TPI is allowed directly after OSP (ADR-179)', () => {
  const osp = { opType: 'outsource' };
  it('exempts a TPI QC op right after OSP, still blocks other QC', () => {
    expect(findQcDirectlyAfterOutsource([osp, { opType: 'qc', operation: 'TPI' }])).toBeNull();
    expect(
      findQcDirectlyAfterOutsource([osp, { opType: 'qc', operation: 'TPI Final Inspection' }]),
    ).toBeNull();
    // a non-TPI QC directly after OSP is still refused
    expect(findQcDirectlyAfterOutsource([osp, { opType: 'qc', operation: 'MIR' }])).toBe(1);
    // a QC op with no name is treated as non-TPI (the safe default)
    expect(findQcDirectlyAfterOutsource([osp, { opType: 'qc' }])).toBe(1);
  });

  it('isTpiOp recognises TPI by name, case-insensitively, only for QC ops', () => {
    expect(isTpiOp({ opType: 'qc', operation: 'TPI' })).toBe(true);
    expect(isTpiOp({ opType: 'qc', operation: ' third-party tpi ' })).toBe(true);
    expect(isTpiOp({ opType: 'qc', operation: 'MIR' })).toBe(false);
    expect(isTpiOp({ opType: 'qc' })).toBe(false);
    // a process/outsource op is never a TPI op even if named "TPI"
    expect(isTpiOp({ opType: 'process', operation: 'TPI' })).toBe(false);
  });
});

describe('qcAfterOutsourceMessage with stored op numbers (plans keep gaps)', () => {
  it('names the REAL stored sequence when the caller supplies opSeq', () => {
    const ops = [
      { opType: 'outsource', opSeq: 1 },
      { opType: 'qc', opSeq: 3 },
    ];
    expect(qcAfterOutsourceError(ops)).toMatch(
      /^Op 30 \(QC\) cannot directly follow Op 10 \(OSP\)/,
    );
  });
});

describe('stripStaleGeneratedTerminalQc (edit: generated op after an OSP retype)', () => {
  const gen = { opType: 'qc', operation: 'Final Inspection', id: 'g' };
  it('drops the generated terminal QC once the routing holds an outsource op', () => {
    expect(
      stripStaleGeneratedTerminalQc([{ opType: 'outsource', operation: 'Plating' }, gen]),
    ).toEqual([{ opType: 'outsource', operation: 'Plating' }]);
    expect(isGeneratedTerminalQcOp({ opType: 'qc', operation: ' final inspection ' })).toBe(true);
  });
  it('keeps it when the routing is still pure in-house (it would be re-appended anyway)', () => {
    const ops = [{ opType: 'process', operation: 'Turning' }, gen];
    expect(stripStaleGeneratedTerminalQc(ops)).toEqual(ops);
  });
  it('keeps it when a mid-route OSP is followed by a machining op (ADR-179)', () => {
    // Turning → OSP → Milling → Final Inspection: the op before the generated
    // QC is a machining step, not a terminal OSP, so the QC is NOT stale.
    const ops = [
      { opType: 'process', operation: 'Turning' },
      { opType: 'outsource', operation: 'Plating' },
      { opType: 'process', operation: 'Milling' },
      gen,
    ];
    expect(stripStaleGeneratedTerminalQc(ops)).toEqual(ops);
  });
  it('never touches a user-named QC, a non-terminal op, a started op, or a recovery child', () => {
    const user = [
      { opType: 'outsource', operation: 'Plating' },
      { opType: 'qc', operation: 'MIR' },
    ];
    expect(stripStaleGeneratedTerminalQc(user)).toEqual(user);
    const mid = [gen, { opType: 'outsource', operation: 'Plating' }];
    expect(stripStaleGeneratedTerminalQc(mid)).toEqual(mid);
    const osp = [{ opType: 'outsource', operation: 'Plating', id: 'o' }, gen];
    expect(stripStaleGeneratedTerminalQc(osp, { isStarted: (o) => o.id === 'g' })).toEqual(osp);
    expect(stripStaleGeneratedTerminalQc(osp, { recoveryKind: 'rework' })).toEqual(osp);
  });
});
