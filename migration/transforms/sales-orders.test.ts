import { describe, expect, it } from 'vitest';
import { transformSalesOrders } from './sales-orders';
import type { TransformContext } from './types';

function ctxWith(
  items: Array<[string, string]> = [],
  clients: Array<[string, string]> = [],
): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: {
        items: new Map(items),
        clients: new Map(clients),
      },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformSalesOrders', () => {
  it('produces 2 result tables (headers + lines)', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'doc1',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          customer: 'Acme',
          type: 'Component Manufacturing',
          status: 'Open',
          gstPercent: 18,
          lineNo: 1,
          partName: 'WIDGET',
          orderQty: 10,
          itemCode: 'ITM-A',
        },
      ],
      ctxWith([['ITM-A', 'item-uuid-a']]),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.table).toBe('sales_orders');
    expect(result[1]?.table).toBe('sales_order_lines');
  });

  it('groups multiple line docs sharing the same soNo into one header', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-436',
          soDate: '2026-04-18',
          customer: 'L&T',
          type: 'Component Manufacturing',
          gstPercent: 18,
          lineNo: 1,
          partName: 'STEM',
          orderQty: 60,
          itemCode: 'X1',
        },
        {
          id: 'd2',
          soNo: 'SO-436',
          soDate: '2026-04-18',
          customer: 'L&T',
          type: 'Component Manufacturing',
          gstPercent: 18,
          lineNo: 2,
          partName: 'PAWL',
          orderQty: 60,
          itemCode: 'X2',
        },
      ],
      ctxWith([['X1', 'uuid-x1']]),
    );
    expect(result[0]?.rows).toHaveLength(1);
    expect(result[1]?.rows).toHaveLength(2);
    const headers = result[0]?.rows as Array<Record<string, unknown>>;
    expect(headers[0]?.['code']).toBe('SO-436');
  });

  it('lines whose itemCode is unresolved load with item_id=null + item_code_text preserved', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          type: 'Equipment',
          gstPercent: 18,
          lineNo: 1,
          partName: 'PRESS',
          orderQty: 1,
          itemCode: 'NOT-IN-MASTER',
        },
      ],
      ctxWith([]),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['itemId']).toBeNull();
    expect(line['itemCodeText']).toBe('NOT-IN-MASTER');
    // No anomaly — by design (ADR-012 #10)
    expect(result[1]?.anomalies).toHaveLength(0);
  });

  it('falls back to customer_name when clientCode is empty/unresolved (demo SO)', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-DEMO',
          soDate: '2026-04-18',
          customer: 'Demo Customer',
          // no clientId / clientCode
          type: 'Equipment',
          gstPercent: 18,
          lineNo: 1,
          partName: 'PRESS',
          orderQty: 1,
        },
      ],
      ctxWith([], []),
    );
    const header = result[0]?.rows[0] as Record<string, unknown>;
    expect(header['clientId']).toBeNull();
    expect(header['customerName']).toBe('Demo Customer');
  });

  it('normalises type and status to lowercase enum values', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          type: 'With Material',
          status: 'Closed',
          gstPercent: 18,
          lineNo: 1,
          partName: 'X',
          orderQty: 1,
        },
      ],
      ctxWith(),
    );
    const header = result[0]?.rows[0] as Record<string, unknown>;
    expect(header['type']).toBe('with_material');
    expect(header['status']).toBe('closed');
  });

  it('skips lines with invalid lineNo or orderQty<=0 with anomalies', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          type: 'Component Manufacturing',
          lineNo: 1,
          partName: 'A',
          orderQty: 5,
        }, // valid
        {
          id: 'd2',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          type: 'Component Manufacturing',
          lineNo: 'bad' as unknown as number,
          partName: 'B',
          orderQty: 5,
        },
        {
          id: 'd3',
          soNo: 'SO-1',
          soDate: '2026-04-18',
          type: 'Component Manufacturing',
          lineNo: 3,
          partName: 'C',
          orderQty: 0,
        },
      ],
      ctxWith(),
    );
    expect(result[1]?.rows).toHaveLength(1);
    expect(result[1]?.anomalies.map((a) => a.type)).toEqual(['lineNo_invalid', 'orderQty_invalid']);
  });

  it('preserves _legacySoNo on line rows for downstream lookup', () => {
    const result = transformSalesOrders(
      [
        {
          id: 'd1',
          soNo: 'SO-99',
          soDate: '2026-04-18',
          type: 'Component Manufacturing',
          lineNo: 1,
          partName: 'X',
          orderQty: 5,
        },
      ],
      ctxWith(),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['_legacySoNo']).toBe('SO-99');
  });
});
