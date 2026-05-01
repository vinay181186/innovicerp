import { describe, expect, it } from 'vitest';
import { transformOpLog } from './op-log';
import type { TransformContext } from './types';

function ctxWith(jcOps: Array<[string, string]>, operatorsByName: Array<[string, string]> = []): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: { operators: new Map() },
      byName: { operators: new Map(operatorsByName) },
      byCompositeKey: { jc_ops: new Map(jcOps) },
    },
  };
}

describe('transformOpLog', () => {
  it('resolves jcNo+opSeq to jc_op_id', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-001', jcNo: 'IN-JC-00001', opSeq: 1, date: '2026-03-07', shift: 'Day', qty: 5 }],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.jcOpId).toBe('jc-op-uuid-1');
    expect(result.rows[0]?.qty).toBe(5);
    expect(result.rows[0]?.shift).toBe('day');
  });

  it('captures orphan rows as jc_op_unresolved (the JC-MS-002/003/004 case)', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-002', jcNo: 'JC-MS-002', opSeq: 1, date: '2026-03-03', shift: 'Day', qty: 30 }],
      ctxWith([]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('jc_op_unresolved');
    expect(result.anomalies[0]?.details).toMatchObject({ jcNo: 'JC-MS-002', opSeq: 1, logNo: 'LOG-002' });
  });

  it('defaults missing log_type to "complete"', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-001', jcNo: 'IN-JC-00001', opSeq: 1, date: '2026-03-07', shift: 'Day', qty: 5 }],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']]),
    );
    expect(result.rows[0]?.logType).toBe('complete');
  });

  it('preserves "start" type and start_time', () => {
    const result = transformOpLog(
      [
        {
          id: 'l1',
          logNo: 'LOG-008',
          jcNo: 'IN-JC-00001',
          opSeq: 1,
          date: '2026-03-07',
          shift: 'Day',
          qty: 0,
          type: 'start',
          startTime: '01:59',
        },
      ],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']]),
    );
    expect(result.rows[0]?.logType).toBe('start');
    expect(result.rows[0]?.startTime).toBe('01:59');
  });

  it('does not set start_time for non-start log types', () => {
    const result = transformOpLog(
      [
        {
          id: 'l1',
          logNo: 'LOG-010',
          jcNo: 'IN-JC-00001',
          opSeq: 1,
          date: '2026-03-07',
          shift: 'Day',
          qty: 5,
          startTime: '14:00',
        },
      ],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']]),
    );
    expect(result.rows[0]?.startTime).toBeNull();
  });

  it('best-effort matches operator by name (case-insensitive)', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-001', jcNo: 'IN-JC-00001', opSeq: 1, date: '2026-03-07', shift: 'Day', qty: 5, operator: 'Vinay' }],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']], [['vinay', 'op-uuid-1']]),
    );
    expect(result.rows[0]?.operatorId).toBe('op-uuid-1');
    expect(result.rows[0]?.operatorName).toBe('Vinay');
  });

  it('falls back to text-only operator when no match', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-001', jcNo: 'IN-JC-00001', opSeq: 1, date: '2026-03-07', shift: 'Day', qty: 5, operator: 'Suresh P.' }],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']], []),
    );
    expect(result.rows[0]?.operatorId).toBeNull();
    expect(result.rows[0]?.operatorName).toBe('Suresh P.');
  });

  it('lowercases shift and captures unrecognised values as anomaly', () => {
    const result = transformOpLog(
      [{ id: 'l1', logNo: 'LOG-001', jcNo: 'IN-JC-00001', opSeq: 1, date: '2026-03-07', shift: 'Evening', qty: 5 }],
      ctxWith([['IN-JC-00001::1', 'jc-op-uuid-1']]),
    );
    expect(result.rows[0]?.shift).toBe('day');
    expect(result.anomalies[0]?.type).toBe('shift_unrecognised');
  });
});
