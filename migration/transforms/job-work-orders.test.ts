import { describe, expect, it } from 'vitest';
import { transformJobWorkOrders } from './job-work-orders';
import type { TransformContext } from './types';

function ctxWith(
  items: Array<[string, string]> = [],
  clients: Array<[string, string]> = [],
): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: { items: new Map(items), clients: new Map(clients) },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformJobWorkOrders', () => {
  it('produces 2 result tables (headers + lines)', () => {
    const result = transformJobWorkOrders(
      [
        {
          id: 'jw1',
          jwNo: 'JW-001',
          jwDate: '2026-03-18',
          customer: 'Gujarati Fabricators',
          lineNo: 1,
          partName: 'FLANGE-75',
          orderQty: 25,
          itemCode: 'ITM-003',
        },
      ],
      ctxWith(),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.table).toBe('job_work_orders');
    expect(result[1]?.table).toBe('job_work_order_lines');
  });

  it('itemCode unresolved → item_id null + text fallback (the legacy ITM-003 case)', () => {
    const result = transformJobWorkOrders(
      [
        {
          id: 'jw1',
          jwNo: 'JW-001',
          jwDate: '2026-03-18',
          lineNo: 1,
          partName: 'FLANGE-75',
          orderQty: 25,
          itemCode: 'ITM-003',
        },
      ],
      ctxWith([]),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['itemId']).toBeNull();
    expect(line['itemCodeText']).toBe('ITM-003');
  });

  it('preserves client material fields (the JW-specific data)', () => {
    const result = transformJobWorkOrders(
      [
        {
          id: 'jw1',
          jwNo: 'JW-001',
          jwDate: '2026-03-18',
          lineNo: 1,
          partName: 'FLANGE-75',
          orderQty: 25,
          clientMaterial: 'SS 304 Round Bar 80mm',
          clientMaterialQty: 30,
          materialReceivedDate: '2026-03-19',
          materialReceivedQty: 30,
        },
      ],
      ctxWith(),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['clientMaterial']).toBe('SS 304 Round Bar 80mm');
    expect(line['clientMaterialQty']).toBe('30.00');
    expect(line['materialReceivedDate']).toBe('2026-03-19');
    expect(line['materialReceivedQty']).toBe('30.00');
  });

  it('materialReceivedQty=0 stored as null (not "0.00") — distinguishes "not received" from "received zero"', () => {
    const result = transformJobWorkOrders(
      [
        {
          id: 'jw2',
          jwNo: 'JW-002',
          jwDate: '2026-03-22',
          lineNo: 1,
          partName: 'SHAFT-50',
          orderQty: 20,
          materialReceivedQty: 0,
          materialReceivedDate: '',
        },
      ],
      ctxWith(),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['materialReceivedQty']).toBeNull();
    expect(line['materialReceivedDate']).toBeNull();
  });

  it('skips header when jwNo missing', () => {
    const result = transformJobWorkOrders(
      [{ id: 'd1', lineNo: 1, partName: 'X', orderQty: 5 }],
      ctxWith(),
    );
    expect(result[0]?.rows).toHaveLength(0);
    expect(result[0]?.anomalies[0]?.type).toBe('jwNo_missing');
  });

  it('preserves _legacyJwNo on line rows', () => {
    const result = transformJobWorkOrders(
      [
        {
          id: 'd1',
          jwNo: 'JW-99',
          jwDate: '2026-03-18',
          lineNo: 1,
          partName: 'X',
          orderQty: 1,
        },
      ],
      ctxWith(),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['_legacyJwNo']).toBe('JW-99');
  });
});
