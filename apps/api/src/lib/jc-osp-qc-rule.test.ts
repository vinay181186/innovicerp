import { describe, expect, it } from 'vitest';
import { opPairKey } from '@innovic/shared';
import { ValidationError } from './errors';
import { assertNoQcDirectlyAfterOutsource, grandfatheredOspQcPairs } from './jc-osp-qc-rule';

const op = (opType: string, id?: string) => ({ opType, id });

describe('assertNoQcDirectlyAfterOutsource (OSP → QC routing rule)', () => {
  it('refuses a QC op directly after an outsource op', () => {
    expect(() => assertNoQcDirectlyAfterOutsource([op('outsource'), op('qc')])).toThrow(
      ValidationError,
    );
    expect(() =>
      assertNoQcDirectlyAfterOutsource([op('process'), op('outsource'), op('qc'), op('process')]),
    ).toThrow(/Op 30 \(QC\) cannot directly follow Op 20 \(OSP\)/);
  });

  it('allows OSP → process → QC and QC anywhere else', () => {
    expect(() =>
      assertNoQcDirectlyAfterOutsource([op('outsource'), op('process'), op('qc')]),
    ).not.toThrow();
    expect(() => assertNoQcDirectlyAfterOutsource([op('qc'), op('outsource')])).not.toThrow();
    expect(() => assertNoQcDirectlyAfterOutsource([op('process'), op('qc')])).not.toThrow();
    expect(() => assertNoQcDirectlyAfterOutsource([])).not.toThrow();
  });

  // ADR-179: TPI (third-party inspection) IS allowed directly after OSP.
  it('allows a TPI QC op directly after OSP, still refuses a non-TPI QC', () => {
    expect(() =>
      assertNoQcDirectlyAfterOutsource([
        { opType: 'outsource', id: undefined, operation: 'Plating' },
        { opType: 'qc', id: undefined, operation: 'TPI' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertNoQcDirectlyAfterOutsource([
        { opType: 'outsource', id: undefined, operation: 'Plating' },
        { opType: 'qc', id: undefined, operation: 'MIR' },
      ]),
    ).toThrow(ValidationError);
  });

  it('lets a grandfathered pair through but still refuses a new one', () => {
    const allowed = new Set([opPairKey('osp-1', 'qc-1')]);
    expect(() =>
      assertNoQcDirectlyAfterOutsource([op('outsource', 'osp-1'), op('qc', 'qc-1')], allowed),
    ).not.toThrow();
    // Same ops, new (id-less) QC inserted right after the OSP → not exempt.
    expect(() =>
      assertNoQcDirectlyAfterOutsource(
        [op('outsource', 'osp-1'), op('qc'), op('qc', 'qc-1')],
        allowed,
      ),
    ).toThrow(ValidationError);
    // The pair re-ordered so a different QC follows the OSP → not exempt.
    expect(() =>
      assertNoQcDirectlyAfterOutsource(
        [op('outsource', 'osp-1'), op('qc', 'qc-2'), op('qc', 'qc-1')],
        allowed,
      ),
    ).toThrow(ValidationError);
  });
});

describe('grandfatheredOspQcPairs', () => {
  it('collects only consecutive (outsource, qc) pairs, ordered by op_seq', () => {
    const pairs = grandfatheredOspQcPairs([
      { id: 'c', opSeq: 3, opType: 'qc' },
      { id: 'a', opSeq: 1, opType: 'process' },
      { id: 'b', opSeq: 2, opType: 'outsource' },
      { id: 'd', opSeq: 4, opType: 'outsource' },
      { id: 'e', opSeq: 5, opType: 'process' },
      { id: 'f', opSeq: 6, opType: 'qc' },
    ]);
    expect([...pairs]).toEqual([opPairKey('b', 'c')]);
  });

  it('returns an empty set for a clean routing', () => {
    expect(
      grandfatheredOspQcPairs([
        { id: 'a', opSeq: 1, opType: 'outsource' },
        { id: 'b', opSeq: 2, opType: 'process' },
        { id: 'c', opSeq: 3, opType: 'qc' },
      ]).size,
    ).toBe(0);
    expect(grandfatheredOspQcPairs([]).size).toBe(0);
  });
});
