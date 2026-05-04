import { describe, expect, it } from 'vitest';
import { transformNcRegister } from './nc-register';
import type { TransformContext } from './types';

function ctxWith({
  items = [],
  jobCards = [],
  jcOps = [],
}: {
  items?: Array<[string, string]>;
  jobCards?: Array<[string, string]>;
  jcOps?: Array<[string, string]>;
} = {}): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: {
        items: new Map(items),
        job_cards: new Map(jobCards),
      },
      byName: {},
      byCompositeKey: {
        jc_ops: new Map(jcOps),
      },
    },
  };
}

describe('transformNcRegister', () => {
  it('maps the 3 real legacy records (NC-0001/0002/0003 against IN-JC-00002)', () => {
    const result = transformNcRegister(
      [
        {
          id: 'w7sklle6',
          ncNo: 'NC-0001',
          date: '2026-04-18',
          jcNo: 'IN-JC-00002',
          opSeq: 4,
          operation: 'DIR',
          qcOperation: 'DIR',
          itemCode: '554117302000',
          itemName: 'JOINT',
          soNo: 'SO-436',
          machineId: 'QC',
          rejectedQty: 5,
          reasonCategory: 'Dimensional',
          reason: '',
          disposition: 'Rework',
          dispositionDate: '2026-04-18',
          dispositionBy: 'Japan',
          dispositionRemarks: 's1 error',
          reworkJcNo: '',
          reworkOpSeq: 3,
          scrapCost: 0,
          status: 'Closed',
          reworkDoneQty: 35,
        },
        {
          id: 'sy2vzokg',
          ncNo: 'NC-0002',
          date: '2026-04-18',
          jcNo: 'IN-JC-00002',
          opSeq: 4,
          operation: 'DIR',
          qcOperation: 'DIR',
          itemCode: '554117302000',
          itemName: 'JOINT',
          soNo: 'SO-436',
          machineId: 'QC',
          rejectedQty: 5,
          reasonCategory: 'Dimensional',
          reason: '',
          disposition: 'Use As Is',
          dispositionDate: '2026-04-18',
          dispositionBy: 'Japan',
          dispositionRemarks: '',
          reworkJcNo: '',
          reworkOpSeq: '',
          scrapCost: 0,
          status: 'Closed',
        },
        {
          id: '7zzae736',
          ncNo: 'NC-0003',
          date: '2026-04-18',
          jcNo: 'IN-JC-00002',
          opSeq: 6,
          operation: 'DIR',
          qcOperation: 'DIR',
          itemCode: '554117302000',
          itemName: 'JOINT',
          soNo: 'SO-436',
          machineId: 'QC',
          rejectedQty: 5,
          reasonCategory: 'Dimensional',
          reason: '',
          disposition: 'Use As Is',
          dispositionDate: '2026-04-18',
          dispositionBy: 'Japan',
          dispositionRemarks: '',
          reworkJcNo: '',
          reworkOpSeq: '',
          scrapCost: 0,
          status: 'Closed',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid-joint']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
        jcOps: [
          ['IN-JC-00002::4', 'jc-op-uuid-4'],
          ['IN-JC-00002::6', 'jc-op-uuid-6'],
        ],
      }),
    );

    expect(result.table).toBe('nc_register');
    expect(result.rows).toHaveLength(3);
    expect(result.anomalies).toHaveLength(0);

    expect(result.rows[0]?.code).toBe('NC-0001');
    expect(result.rows[0]?.jobCardId).toBe('jc-uuid-2');
    expect(result.rows[0]?.jcOpId).toBe('jc-op-uuid-4');
    expect(result.rows[0]?.itemId).toBe('item-uuid-joint');
    expect(result.rows[0]?.disposition).toBe('rework');
    expect(result.rows[0]?.reasonCategory).toBe('dimensional');
    expect(result.rows[0]?.status).toBe('closed');
    expect(result.rows[0]?.rejectedQty).toBe('5.00');
    expect(result.rows[0]?.reworkDoneQty).toBe('35.00');
    expect(result.rows[0]?.reworkOpSeq).toBe(3);
    expect(result.rows[0]?.soCodeText).toBe('SO-436');
    expect(result.rows[0]?.machineCodeText).toBe('QC');
    expect(result.rows[0]?.opSeq).toBe(4);

    expect(result.rows[1]?.disposition).toBe('use_as_is');
    expect(result.rows[1]?.reworkOpSeq).toBeNull(); // legacy '' → null
    expect(result.rows[1]?.reworkDoneQty).toBeNull();

    expect(result.rows[2]?.code).toBe('NC-0003');
    expect(result.rows[2]?.jcOpId).toBe('jc-op-uuid-6');
  });

  it('skips when ncNo, date, or jcNo are missing', () => {
    const result = transformNcRegister(
      [
        { id: 'a' /* no ncNo */ },
        { id: 'b', ncNo: 'NC-0010' /* no date */ },
        { id: 'c', ncNo: 'NC-0011', date: '2026-04-01' /* no jcNo */ },
      ],
      ctxWith(),
    );
    expect(result.rows).toHaveLength(0);
    const types = result.anomalies.map((a) => a.type).sort();
    expect(types).toEqual(['date_missing', 'jcNo_missing', 'ncNo_missing']);
  });

  it('skips when jcNo is unresolved (no matching job_cards row)', () => {
    const result = transformNcRegister(
      [
        {
          id: 'x',
          ncNo: 'NC-0010',
          date: '2026-04-01',
          jcNo: 'IN-JC-99999',
          opSeq: 1,
          itemCode: '554117302000',
          rejectedQty: 1,
          status: 'Pending',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid']],
      }),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('jc_unresolved');
  });

  it('logs jc_op_unresolved (not skip) when jcNo resolves but opSeq does not', () => {
    const result = transformNcRegister(
      [
        {
          id: 'x',
          ncNo: 'NC-0020',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          opSeq: 99,
          itemCode: '554117302000',
          rejectedQty: 2,
          status: 'Pending',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
        jcOps: [['IN-JC-00002::1', 'jc-op-uuid-1']],
      }),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.jcOpId).toBeNull();
    expect(result.rows[0]?.opSeq).toBe(99);
    expect(result.anomalies[0]?.type).toBe('jc_op_unresolved');
  });

  it('skips when itemCode missing or unresolved', () => {
    const result = transformNcRegister(
      [
        {
          id: 'a',
          ncNo: 'NC-0030',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          /* no itemCode */
          rejectedQty: 1,
          status: 'Pending',
        },
        {
          id: 'b',
          ncNo: 'NC-0031',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: 'NOPE',
          rejectedQty: 1,
          status: 'Pending',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
      }),
    );
    expect(result.rows).toHaveLength(0);
    const types = result.anomalies.map((a) => a.type).sort();
    expect(types).toEqual(['itemCode_missing', 'item_unresolved']);
  });

  it('rejects rejectedQty <= 0 (CHECK enforces > 0)', () => {
    const result = transformNcRegister(
      [
        {
          id: 'a',
          ncNo: 'NC-0040',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 0,
        },
        {
          id: 'b',
          ncNo: 'NC-0041',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: -3,
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
      }),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies.every((a) => a.type === 'rejectedQty_invalid')).toBe(true);
  });

  it('normalises reason_category enum values + falls back to "other"', () => {
    const result = transformNcRegister(
      [
        {
          id: 'a',
          ncNo: 'NC-0050',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 1,
          reasonCategory: 'Operator Error',
        },
        {
          id: 'b',
          ncNo: 'NC-0051',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 1,
          reasonCategory: 'Quantum Mishap',
        },
        {
          id: 'c',
          ncNo: 'NC-0052',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 1,
          /* reasonCategory absent */
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
      }),
    );
    expect(result.rows[0]?.reasonCategory).toBe('operator_error');
    expect(result.rows[1]?.reasonCategory).toBe('other');
    expect(result.rows[2]?.reasonCategory).toBe('other');
    expect(result.anomalies.find((a) => a.type === 'reasonCategory_unrecognised')).toBeDefined();
  });

  it('maps "Rework Complete" status → rework_done (legacy filter dropdown value)', () => {
    const result = transformNcRegister(
      [
        {
          id: 'a',
          ncNo: 'NC-0060',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 1,
          status: 'Rework Complete',
        },
        {
          id: 'b',
          ncNo: 'NC-0061',
          date: '2026-04-01',
          jcNo: 'IN-JC-00002',
          itemCode: '554117302000',
          rejectedQty: 1,
          status: 'Rework Done',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        jobCards: [['IN-JC-00002', 'jc-uuid-2']],
      }),
    );
    expect(result.rows[0]?.status).toBe('rework_done');
    expect(result.rows[1]?.status).toBe('rework_done');
  });

  it('produces deterministic UUIDv5 ids stable across re-runs', () => {
    const args: Parameters<typeof transformNcRegister>[0] = [
      {
        id: 'w7sklle6',
        ncNo: 'NC-0001',
        date: '2026-04-18',
        jcNo: 'IN-JC-00002',
        opSeq: 4,
        itemCode: '554117302000',
        rejectedQty: 5,
        reasonCategory: 'Dimensional',
        status: 'Closed',
      },
    ];
    const ctx = ctxWith({
      items: [['554117302000', 'item-uuid']],
      jobCards: [['IN-JC-00002', 'jc-uuid-2']],
      jcOps: [['IN-JC-00002::4', 'jc-op-uuid-4']],
    });
    const a = transformNcRegister(args, ctx);
    const b = transformNcRegister(args, ctx);
    expect(a.rows[0]?.id).toBe(b.rows[0]?.id);
  });
});
