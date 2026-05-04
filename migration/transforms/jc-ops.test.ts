import { describe, expect, it } from 'vitest';
import { transformJcOps } from './jc-ops';
import type { TransformContext } from './types';

function ctxWith(
  jobCards: Array<[string, string]>,
  machines: Array<[string, string]> = [],
  vendors: Array<[string, string]> = [],
): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: {
        job_cards: new Map(jobCards),
        machines: new Map(machines),
        vendors: new Map(vendors),
      },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformJcOps', () => {
  it('resolves jcNo to job_card_id and machineId to machine_id', () => {
    const result = transformJcOps(
      [
        {
          id: 'op1',
          jcNo: 'IN-JC-00001',
          opSeq: 1,
          machineId: 'CNC-01',
          operation: 'turn',
          opType: 'process',
        },
      ],
      ctxWith([['IN-JC-00001', 'jc-uuid-1']], [['CNC-01', 'mach-uuid-1']]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.jobCardId).toBe('jc-uuid-1');
    expect(result.rows[0]?.machineId).toBe('mach-uuid-1');
    expect(result.rows[0]?.opType).toBe('process');
  });

  it('skips when jcNo unresolved (orphan)', () => {
    const result = transformJcOps(
      [{ id: 'op1', jcNo: 'JC-MS-002', opSeq: 1, machineId: 'CNC-01', operation: 'turn' }],
      ctxWith([]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('jcNo_unresolved');
  });

  it('falls back to machineCodeText for QC sentinel', () => {
    const result = transformJcOps(
      [
        {
          id: 'op1',
          jcNo: 'IN-JC-00001',
          opSeq: 1,
          machineId: 'QC',
          operation: 'DIR',
          opType: 'QC',
        },
      ],
      ctxWith([['IN-JC-00001', 'jc-uuid-1']]),
    );
    expect(result.rows[0]?.machineId).toBeNull();
    expect(result.rows[0]?.machineCodeText).toBe('QC');
    expect(result.rows[0]?.opType).toBe('qc');
  });

  it('resolves outsource vendor and normalises status', () => {
    const result = transformJcOps(
      [
        {
          id: 'op1',
          jcNo: 'IN-JC-00002',
          opSeq: 7,
          machineId: 'CNC-01',
          operation: 'COATING',
          opType: 'outsource',
          outsourceVendor: 'VND-001',
          outsourceCost: 50,
          outsourceStatus: 'Sent',
          sentQty: 50,
        },
      ],
      ctxWith(
        [['IN-JC-00002', 'jc-uuid-2']],
        [['CNC-01', 'mach-uuid-1']],
        [['VND-001', 'vend-uuid-1']],
      ),
    );
    expect(result.rows[0]?.outsourceVendorId).toBe('vend-uuid-1');
    expect(result.rows[0]?.outsourceStatus).toBe('sent');
    expect(result.rows[0]?.outsourceSentQty).toBe(50);
  });

  it('outsource_status is null for non-outsource ops', () => {
    const result = transformJcOps(
      [
        {
          id: 'op1',
          jcNo: 'IN-JC-00001',
          opSeq: 1,
          machineId: 'CNC-01',
          operation: 'turn',
          opType: 'process',
        },
      ],
      ctxWith([['IN-JC-00001', 'jc-uuid-1']]),
    );
    expect(result.rows[0]?.outsourceStatus).toBeNull();
  });

  it('preserves _legacyJcNo for downstream op_log composite-key lookup', () => {
    const result = transformJcOps(
      [{ id: 'op1', jcNo: 'IN-JC-00001', opSeq: 1, machineId: 'CNC-01', operation: 'turn' }],
      ctxWith([['IN-JC-00001', 'jc-uuid-1']]),
    );
    expect(result.rows[0]?._legacyJcNo).toBe('IN-JC-00001');
  });

  it('skips when operation is missing', () => {
    const result = transformJcOps(
      [{ id: 'op1', jcNo: 'IN-JC-00001', opSeq: 1, machineId: 'CNC-01', operation: '' }],
      ctxWith([['IN-JC-00001', 'jc-uuid-1']]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('operation_missing');
  });
});
