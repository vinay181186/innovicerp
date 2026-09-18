// Unit tests for the client-side JC write-payload builder — specifically the
// "no QC directly after an OSP op" routing rule (shared with the API) and its
// two caller-side exemptions (rework/repair children, grandfathered pairs).

import { describe, expect, it } from 'vitest';
import {
  buildJcWriteInput,
  grandfatheredOspQcPairs,
  opsSequenceError,
  type BuildJcOpValues,
  type BuildJcWriteInputArgs,
} from './build-jc-write-input';

function op(opType: BuildJcOpValues['opType'], id?: string): BuildJcOpValues {
  return {
    ...(id !== undefined ? { id } : {}),
    machineCode: opType === 'process' ? 'VMC-01' : '',
    operation: opType === 'outsource' ? '' : 'Step',
    opType,
    cycleTimeMin: 0,
    program: '',
    toolNo: '',
    toolDetails: '',
    qcRequired: false,
    outsourceVendorCode: opType === 'outsource' ? 'V001' : '',
    outsourceCost: null,
  };
}

function args(
  ops: BuildJcOpValues[],
  extra?: Partial<BuildJcWriteInputArgs>,
): BuildJcWriteInputArgs {
  return {
    isEdit: true,
    jcDate: '2026-09-17',
    sourceType: 'jw',
    sourceLineId: 'line-1',
    itemCode: 'ITM-001',
    orderQty: '10',
    priority: 'normal',
    dueDate: '',
    drawingFilePath: null,
    remarks: '',
    ops,
    docs: [],
    ...extra,
  };
}

describe('buildJcWriteInput — OSP → QC routing rule', () => {
  it('rejects a QC op placed directly after an OSP op', () => {
    const r = buildJcWriteInput(args([op('process'), op('outsource'), op('qc')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Op 30 \(QC\) cannot directly follow Op 20 \(OSP\)/);
  });

  it('allows OSP → Operation → QC', () => {
    const r = buildJcWriteInput(args([op('process'), op('outsource'), op('process'), op('qc')]));
    expect(r.ok).toBe(true);
  });

  it('does not block QC in general', () => {
    const r = buildJcWriteInput(args([op('process'), op('qc'), op('process'), op('qc')]));
    expect(r.ok).toBe(true);
  });

  it('skips the rule for rework/repair children', () => {
    const r = buildJcWriteInput(args([op('outsource'), op('qc')], { recoveryKind: 'rework' }));
    expect(r.ok).toBe(true);
  });

  it('grandfathers a pair that was already saved side by side', () => {
    const allowedPairs = grandfatheredOspQcPairs([
      { id: 'a', opSeq: 1, opType: 'process' },
      { id: 'b', opSeq: 2, opType: 'outsource' },
      { id: 'c', opSeq: 3, opType: 'qc' },
    ]);
    expect(allowedPairs.size).toBe(1);
    const saved = [op('process', 'a'), op('outsource', 'b'), op('qc', 'c')];
    expect(buildJcWriteInput(args(saved, { allowedPairs })).ok).toBe(true);
    // A NEW QC (no id) dropped after the same OSP is still refused.
    const withNew = [op('process', 'a'), op('outsource', 'b'), op('qc'), op('qc', 'c')];
    expect(buildJcWriteInput(args(withNew, { allowedPairs })).ok).toBe(false);
  });

  it('drops the system-added terminal "Final Inspection" once the op before it is retyped to OSP', () => {
    // Saved as [Turning (process), Final Inspection (generated)]; the person
    // retypes Turning to OSP. The generated op is stale, not a violation.
    const gen = { ...op('qc', 'gen-1'), operation: 'Final Inspection' };
    const ops = [op('outsource', 'op-1'), gen];
    expect(opsSequenceError(ops)).toBeNull();
    const r = buildJcWriteInput(args(ops));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.ops.map((o) => o.opType)).toEqual(['outsource']);
    // …but not when that op already has logged work — the lock guards own it.
    expect(opsSequenceError(ops, { startedIds: new Set(['gen-1']) })).toMatch(/^Op 20 \(QC\)/);
    // …and a user-picked QC name is never treated as generated.
    const mir = { ...op('qc', 'qc-2'), operation: 'MIR' };
    expect(opsSequenceError([op('outsource', 'op-1'), mir])).toMatch(/^Op 20 \(QC\)/);
  });

  it('grandfatheredOspQcPairs sorts by opSeq before pairing', () => {
    const pairs = grandfatheredOspQcPairs([
      { id: 'c', opSeq: 3, opType: 'qc' },
      { id: 'b', opSeq: 2, opType: 'outsource' },
    ]);
    expect(pairs.has('b>c')).toBe(true);
  });
});
