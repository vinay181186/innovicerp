import { describe, expect, it } from 'vitest';
import { transformRouteCards } from './route-cards';
import type { TransformContext } from './types';

function ctxWith(items: Array<[string, string]>, machines: Array<[string, string]> = []): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: {
        items: new Map(items),
        machines: new Map(machines),
      },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformRouteCards', () => {
  it('produces 3 result tables (cards, ops, revisions)', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', rcNo: 'IN-RC-00001', itemCode: 'ITM-001', ops: [{ machineId: 'CNC-01', operation: 'turn' }] }],
      ctxWith([['ITM-001', 'item-uuid-1']], [['CNC-01', 'mach-uuid-1']]),
    );
    expect(results).toHaveLength(3);
    expect(results[0]?.table).toBe('route_cards');
    expect(results[1]?.table).toBe('route_card_ops');
    expect(results[2]?.table).toBe('route_card_revisions');
  });

  it('resolves itemCode to item_id and machineId to machine_id', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', rcNo: 'IN-RC-00001', itemCode: 'ITM-001', ops: [{ machineId: 'CNC-01', operation: 'turn' }] }],
      ctxWith([['ITM-001', 'item-uuid-1']], [['CNC-01', 'mach-uuid-1']]),
    );
    expect((results[0]!.rows[0] as Record<string, unknown>)['itemId']).toBe('item-uuid-1');
    expect((results[1]!.rows[0] as Record<string, unknown>)['machineId']).toBe('mach-uuid-1');
    expect((results[1]!.rows[0] as Record<string, unknown>)['machineCodeText']).toBeNull();
  });

  it('falls back to machineCodeText when machineId is QC sentinel', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', rcNo: 'IN-RC-00001', itemCode: 'ITM-001', ops: [{ machineId: 'QC', operation: 'DIR' }] }],
      ctxWith([['ITM-001', 'item-uuid-1']]),
    );
    const op = results[1]!.rows[0] as Record<string, unknown>;
    expect(op['machineId']).toBeNull();
    expect(op['machineCodeText']).toBe('QC');
    expect(op['opType']).toBe('qc');
    expect(op['qcRequired']).toBe(true);
  });

  it('skips card when itemCode is unresolved (anomaly captured)', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', rcNo: 'IN-RC-00001', itemCode: 'NOT-IN-MASTER', ops: [{ machineId: 'CNC-01', operation: 'turn' }] }],
      ctxWith([], []),
    );
    expect(results[0]!.rows).toHaveLength(0);
    expect(results[0]!.anomalies[0]?.type).toBe('itemCode_unresolved');
    // Ops/revisions not produced for skipped card
    expect(results[1]!.rows).toHaveLength(0);
  });

  it('skips card when rcNo missing', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', itemCode: 'ITM-001' }],
      ctxWith([['ITM-001', 'item-uuid-1']]),
    );
    expect(results[0]!.rows).toHaveLength(0);
    expect(results[0]!.anomalies[0]?.type).toBe('rcNo_missing');
  });

  it('produces revision rows from non-empty revisionLog with jsonb opsSnapshot', () => {
    const results = transformRouteCards(
      [
        {
          id: 'rc1',
          rcNo: 'IN-RC-00001',
          itemCode: 'ITM-001',
          revision: 2,
          ops: [{ machineId: 'CNC-01', operation: 'turn' }],
          revisionLog: [
            {
              rev: 1,
              changedBy: 'Admin',
              notes: 'Updated',
              opsSnapshot: [{ machineId: 'CNC-02', operation: 'old turn' }],
            },
          ],
        },
      ],
      ctxWith([['ITM-001', 'item-uuid-1']]),
    );
    expect(results[2]!.rows).toHaveLength(1);
    const rev = results[2]!.rows[0] as Record<string, unknown>;
    expect(rev['revisionNo']).toBe(1);
    expect(rev['notes']).toBe('Updated');
    expect(rev['opsSnapshot']).toEqual([{ machineId: 'CNC-02', operation: 'old turn' }]);
  });

  it('infers opType=outsource for COATING operations', () => {
    const results = transformRouteCards(
      [{ id: 'rc1', rcNo: 'IN-RC-00008', itemCode: 'ITM-001', ops: [{ machineId: '', operation: 'COATING' }] }],
      ctxWith([['ITM-001', 'item-uuid-1']]),
    );
    expect((results[1]!.rows[0] as Record<string, unknown>)['opType']).toBe('outsource');
  });
});
