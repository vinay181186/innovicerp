import { describe, expect, it } from 'vitest';
import { transformRunningOps } from './running-ops';
import type { TransformContext } from './types';

function ctxWith(
  jcOps: Array<[string, string]>,
  machines: Array<[string, string]> = [],
  operatorsByName: Array<[string, string]> = [],
): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: { machines: new Map(machines), operators: new Map() },
      byName: { operators: new Map(operatorsByName) },
      byCompositeKey: { jc_ops: new Map(jcOps) },
    },
  };
}

describe('transformRunningOps', () => {
  it('resolves jcNo+opSeq, machine, and operator', () => {
    const result = transformRunningOps(
      [
        {
          id: 'r1',
          jcNo: 'IN-JC-00002',
          opSeq: 5,
          machineId: 'CNC-02',
          operator: 'Japan',
          startDate: '2026-04-18',
          startTime: '17:47',
          shift: 'Day',
          status: 'Running',
        },
      ],
      ctxWith([['IN-JC-00002::5', 'jc-op-uuid-5']], [['CNC-02', 'mach-uuid-2']], [['japan', 'op-uuid-japan']]),
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.jcOpId).toBe('jc-op-uuid-5');
    expect(row.machineId).toBe('mach-uuid-2');
    expect(row.operatorId).toBe('op-uuid-japan');
    expect(row.status).toBe('running');
    expect(row.shift).toBe('day');
    expect(row.isOsp).toBe(false);
  });

  it('flags is_osp and clears machine_id when machineId is OSP sentinel', () => {
    const result = transformRunningOps(
      [
        {
          id: 'r1',
          jcNo: 'IN-JC-00002',
          opSeq: 7,
          machineId: 'OSP',
          operator: 'OSP-VendorX',
          startDate: '2026-04-18',
          startTime: '10:00',
          shift: 'Day',
          status: 'Running',
        },
      ],
      ctxWith([['IN-JC-00002::7', 'jc-op-uuid-7']]),
    );
    expect(result.rows[0]?.isOsp).toBe(true);
    expect(result.rows[0]?.machineId).toBeNull();
  });

  it('maps Completed → done', () => {
    const result = transformRunningOps(
      [
        {
          id: 'r1',
          jcNo: 'IN-JC-00002',
          opSeq: 3,
          machineId: 'CNC-01',
          operator: 'Op',
          startDate: '2026-04-18',
          startTime: '17:32',
          shift: 'Day',
          status: 'Done',
        },
      ],
      ctxWith([['IN-JC-00002::3', 'jc-op-uuid-3']], [['CNC-01', 'mach-uuid-1']]),
    );
    expect(result.rows[0]?.status).toBe('done');
  });

  it('skips when jcNo+opSeq unresolved', () => {
    const result = transformRunningOps(
      [
        {
          id: 'r1',
          jcNo: 'JC-MS-999',
          opSeq: 1,
          startDate: '2026-04-18',
          startTime: '10:00',
          shift: 'Day',
          status: 'Running',
        },
      ],
      ctxWith([]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('jc_op_unresolved');
  });

  it('skips when status not in lowered set', () => {
    const result = transformRunningOps(
      [
        {
          id: 'r1',
          jcNo: 'IN-JC-00002',
          opSeq: 5,
          startDate: '2026-04-18',
          startTime: '10:00',
          shift: 'Day',
          status: 'Paused',
        },
      ],
      ctxWith([['IN-JC-00002::5', 'jc-op-uuid-5']]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('status_unrecognised');
  });
});
