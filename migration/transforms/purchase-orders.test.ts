import { describe, expect, it } from 'vitest';
import { transformPurchaseOrders } from './purchase-orders';
import type { TransformContext } from './types';

function ctxWith(
  opts: {
    items?: Array<[string, string]>;
    vendors?: Array<[string, string]>;
    prToJcOp?: Array<[string, string]>; // prCode → jcOpId
    soLines?: Record<string, string>;
  } = {},
): TransformContext {
  return {
    idMap: { sales_order_lines: opts.soLines ?? {} },
    lookups: {
      byCode: {
        items: new Map(opts.items ?? []),
        vendors: new Map(opts.vendors ?? []),
      },
      byName: {},
      byCompositeKey: {
        purchase_requests_to_jc_op_id: new Map(opts.prToJcOp ?? []),
      },
    },
  };
}

describe('transformPurchaseOrders', () => {
  it('produces 2 result tables (headers + lines)', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'doc1',
          poNo: 'IN-JWPO-00001',
          lineNo: '1',
          poDate: '2026-04-18',
          poType: 'Job Work',
          vendorCode: 'VND-001',
          itemCode: '554117302000',
          itemName: 'JOINT',
          qty: 60,
          rate: 50,
          status: 'Open',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        vendors: [['VND-001', 'vendor-uuid']],
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.table).toBe('purchase_orders');
    expect(result[1]?.table).toBe('purchase_order_lines');
    expect(result[0]?.rows).toHaveLength(1);
    expect(result[1]?.rows).toHaveLength(1);
  });

  it('groups multiple line docs sharing the same poNo into one header', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-MULTI',
          lineNo: 1,
          poDate: '2026-04-18',
          poType: 'Standard',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'A',
          qty: 5,
          rate: 100,
        },
        {
          id: 'd2',
          poNo: 'PO-MULTI',
          lineNo: 2,
          poDate: '2026-04-18',
          poType: 'Standard',
          vendorCode: 'V1',
          itemCode: 'I2',
          itemName: 'B',
          qty: 3,
          rate: 200,
        },
      ],
      ctxWith({
        items: [
          ['I1', 'iu1'],
          ['I2', 'iu2'],
        ],
        vendors: [['V1', 'vu']],
      }),
    );
    expect(result[0]?.rows).toHaveLength(1);
    expect(result[1]?.rows).toHaveLength(2);
  });

  it('falls back to vendor_code_text / item_code_text when lookups miss (ADR-012 #10)', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-X',
          lineNo: 1,
          poDate: '2026-04-18',
          vendorCode: 'NOT-A-VENDOR',
          itemCode: 'NOT-AN-ITEM',
          itemName: 'X',
          qty: 1,
          rate: 0,
        },
      ],
      ctxWith(),
    );
    const header = result[0]?.rows[0] as Record<string, unknown>;
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(header['vendorId']).toBeNull();
    expect(header['vendorCodeText']).toBe('NOT-A-VENDOR');
    expect(line['itemId']).toBeNull();
    expect(line['itemCodeText']).toBe('NOT-AN-ITEM');
  });

  it('resolves source_jc_op_id on the line via the PR→JC-op bridge from prToJcOp lookup', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-A',
          lineNo: 1,
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'X',
          qty: 1,
          rate: 0,
          prNo: 'PR-00001',
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        vendors: [['V1', 'vu']],
        prToJcOp: [['PR-00001', 'jcop-uuid']],
      }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['sourceJcOpId']).toBe('jcop-uuid');
  });

  it('resolves source_so_line_id on the line via idMap.sales_order_lines', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-A',
          lineNo: 1,
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'X',
          qty: 1,
          rate: 0,
          soRefId: 'so-line-legacy-1',
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        vendors: [['V1', 'vu']],
        soLines: { 'so-line-legacy-1': 'soline-uuid' },
      }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['sourceSoLineId']).toBe('soline-uuid');
  });

  it('normalises poType and status to enum values', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-A',
          lineNo: 1,
          poDate: '2026-04-18',
          poType: 'Job Work',
          status: 'Open',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'X',
          qty: 1,
          rate: 0,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    const header = result[0]?.rows[0] as Record<string, unknown>;
    expect(header['poType']).toBe('job_work');
    expect(header['status']).toBe('open');
  });

  it('skips lines with invalid lineNo or qty<=0 with anomalies', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-A',
          lineNo: 1,
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'A',
          qty: 5,
          rate: 0,
        },
        {
          id: 'd2',
          poNo: 'PO-A',
          lineNo: 'bad',
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'B',
          qty: 5,
          rate: 0,
        },
        {
          id: 'd3',
          poNo: 'PO-A',
          lineNo: 3,
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'C',
          qty: 0,
          rate: 0,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    expect(result[1]?.rows).toHaveLength(1);
    const types = result[1]?.anomalies.map((a) => a.type) ?? [];
    expect(types).toContain('lineNo_invalid');
    expect(types).toContain('qty_invalid');
  });

  it('preserves _legacyPoCode + _legacyItemCode on lines for byCompositeKey lookup', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-Z',
          lineNo: 1,
          poDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'X',
          qty: 1,
          rate: 0,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['_legacyPoCode']).toBe('PO-Z');
    expect(line['_legacyItemCode']).toBe('I1');
  });

  it('logs po_type_unrecognised + defaults to standard when poType is a strange value', () => {
    const result = transformPurchaseOrders(
      [
        {
          id: 'd1',
          poNo: 'PO-Z',
          lineNo: 1,
          poDate: '2026-04-18',
          poType: 'Mystery Type',
          vendorCode: 'V1',
          itemCode: 'I1',
          itemName: 'X',
          qty: 1,
          rate: 0,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    expect((result[0]?.rows[0] as Record<string, unknown>)['poType']).toBe('standard');
    expect(result[0]?.anomalies.map((a) => a.type)).toContain('po_type_unrecognised');
  });
});
