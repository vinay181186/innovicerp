import { describe, expect, it } from 'vitest';
import { transformJobCards } from './job-cards';
import type { TransformContext } from './types';

function ctxWithItems(items: Array<[string, string]>): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: { items: new Map(items) },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformJobCards', () => {
  it('maps a fully-populated record', () => {
    const result = transformJobCards(
      [
        {
          id: 'jc1',
          jcNo: 'IN-JC-00001',
          date: '2026-04-16',
          itemCode: 'ITM-001',
          orderQty: 20,
          priority: 'Normal',
          dueDate: '2026-04-30',
          soNo: 'JW-002',
          soRefId: 'jw2',
          soLineNo: '1',
          soPartName: 'SHAFT-50',
        },
      ],
      ctxWithItems([['ITM-001', 'item-uuid-1']]),
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.code).toBe('IN-JC-00001');
    expect(row.itemId).toBe('item-uuid-1');
    expect(row.orderQty).toBe(20);
    expect(row.priority).toBe('normal');
    expect(JSON.parse(row.sourceLegacyRef)).toMatchObject({
      soNo: 'JW-002',
      soRefId: 'jw2',
      soLineNo: '1',
      soPartName: 'SHAFT-50',
    });
  });

  it('lowercases priority and accepts High', () => {
    const result = transformJobCards(
      [
        {
          id: 'jc1',
          jcNo: 'IN-JC-00001',
          date: '2026-04-16',
          itemCode: 'ITM-001',
          orderQty: 5,
          priority: 'High',
        },
      ],
      ctxWithItems([['ITM-001', 'item-uuid-1']]),
    );
    expect(result.rows[0]?.priority).toBe('high');
    expect(result.anomalies).toEqual([]);
  });

  it('defaults unknown priority to normal with anomaly', () => {
    const result = transformJobCards(
      [
        {
          id: 'jc1',
          jcNo: 'IN-JC-00001',
          date: '2026-04-16',
          itemCode: 'ITM-001',
          orderQty: 5,
          priority: 'Critical',
        },
      ],
      ctxWithItems([['ITM-001', 'item-uuid-1']]),
    );
    expect(result.rows[0]?.priority).toBe('normal');
    expect(result.anomalies[0]?.type).toBe('priority_unrecognised');
  });

  it('skips when itemCode is unresolved', () => {
    const result = transformJobCards(
      [{ id: 'jc1', jcNo: 'IN-JC-00001', date: '2026-04-16', itemCode: 'UNKNOWN', orderQty: 5 }],
      ctxWithItems([]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies[0]?.type).toBe('itemCode_unresolved');
  });

  it('skips when orderQty is missing or zero', () => {
    const result = transformJobCards(
      [
        { id: 'a', jcNo: 'IN-JC-1', date: '2026-04-16', itemCode: 'ITM-001' },
        { id: 'b', jcNo: 'IN-JC-2', date: '2026-04-16', itemCode: 'ITM-001', orderQty: 0 },
      ],
      ctxWithItems([['ITM-001', 'item-uuid-1']]),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies.every((a) => a.type === 'orderQty_invalid')).toBe(true);
  });

  it('treats empty dueDate and drawingFile as null', () => {
    const result = transformJobCards(
      [
        {
          id: 'jc1',
          jcNo: 'IN-JC-1',
          date: '2026-04-16',
          itemCode: 'ITM-001',
          orderQty: 5,
          dueDate: '',
          drawingFile: '',
        },
      ],
      ctxWithItems([['ITM-001', 'item-uuid-1']]),
    );
    expect(result.rows[0]?.dueDate).toBeNull();
    expect(result.rows[0]?.drawingFilePath).toBeNull();
  });
});
