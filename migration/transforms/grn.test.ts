import { describe, expect, it } from 'vitest';
import { transformGrn } from './grn';
import type { TransformContext } from './types';

function ctxWith(
  opts: {
    items?: Array<[string, string]>;
    vendors?: Array<[string, string]>;
    pos?: Array<[string, string]>;
    poLines?: Array<[string, string]>; // key: `${poCode}::${itemCode}`
  } = {},
): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: {
        items: new Map(opts.items ?? []),
        vendors: new Map(opts.vendors ?? []),
        purchase_orders: new Map(opts.pos ?? []),
      },
      byName: {},
      byCompositeKey: {
        purchase_order_lines: new Map(opts.poLines ?? []),
      },
    },
  };
}

describe('transformGrn', () => {
  it('produces 2 result tables (headers + lines)', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'IN-GRN-00001',
          grnDate: '2026-04-18',
          poNo: 'IN-JWPO-00001',
          vendorCode: 'VND-001',
          itemCode: '554117302000',
          itemName: 'JOINT',
          receivedQty: 25,
          qcStatus: 'Completed',
          qcAcceptedQty: 25,
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        vendors: [['VND-001', 'vendor-uuid']],
        pos: [['IN-JWPO-00001', 'po-uuid']],
        poLines: [['IN-JWPO-00001::554117302000', 'poline-uuid']],
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.table).toBe('goods_receipt_notes');
    expect(result[1]?.table).toBe('goods_receipt_note_lines');
  });

  it('groups multiple line docs sharing the same grnNo into one header + auto-numbers lines 1..N', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'IN-GRN-00001',
          grnDate: '2026-04-18',
          itemCode: 'I1',
          itemName: 'A',
          receivedQty: 80,
        },
        {
          id: 'd2',
          grnNo: 'IN-GRN-00001',
          grnDate: '2026-04-18',
          itemCode: 'I2',
          itemName: 'B',
          receivedQty: 25,
        },
        {
          id: 'd3',
          grnNo: 'IN-GRN-00001',
          grnDate: '2026-04-18',
          itemCode: 'I2',
          itemName: 'B',
          receivedQty: 20,
        },
      ],
      ctxWith({
        items: [
          ['I1', 'iu1'],
          ['I2', 'iu2'],
        ],
      }),
    );
    expect(result[0]?.rows).toHaveLength(1);
    const lines = result[1]?.rows as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l['lineNo'])).toEqual([1, 2, 3]);
  });

  it('resolves header purchase_order_id via byCode.purchase_orders, falls back to po_code_text on miss', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          poNo: 'PO-MISSING',
          itemCode: 'I1',
          itemName: 'X',
          receivedQty: 1,
        },
      ],
      ctxWith({ items: [['I1', 'iu']] /* no PO lookup */ }),
    );
    const header = result[0]?.rows[0] as Record<string, unknown>;
    expect(header['purchaseOrderId']).toBeNull();
    expect(header['poCodeText']).toBe('PO-MISSING');
    expect(result[0]?.anomalies.map((a) => a.type)).toContain('po_unresolved');
  });

  it('resolves purchase_order_line_id via the (poCode::itemCode) composite tuple per ADR-015 #9', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          poNo: 'PO-X',
          itemCode: 'I1',
          itemName: 'X',
          receivedQty: 5,
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        pos: [['PO-X', 'po-uuid']],
        poLines: [['PO-X::I1', 'poline-uuid']],
      }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['purchaseOrderLineId']).toBe('poline-uuid');
  });

  it('logs po_line_unresolved when the (poCode::itemCode) tuple does not resolve', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          poNo: 'PO-X',
          itemCode: 'I1',
          itemName: 'X',
          receivedQty: 5,
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        pos: [['PO-X', 'po-uuid']],
        // no poLines populated
      }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['purchaseOrderLineId']).toBeNull();
    expect(result[1]?.anomalies.map((a) => a.type)).toContain('po_line_unresolved');
  });

  it('takes max of legacy duplicate fields (acceptedQty vs qcAcceptedQty)', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          itemCode: 'I1',
          itemName: 'X',
          receivedQty: 25,
          qcAcceptedQty: 25,
          acceptedQty: 0, // legacy duplicate field
          qcStatus: 'Completed',
        },
      ],
      ctxWith({ items: [['I1', 'iu']] }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['qcAcceptedQty']).toBe(25);
    expect(line['qcRejectedQty']).toBe(0);
  });

  it('normalises qcStatus and clamps qc_accepted+qc_rejected when greater than received_qty', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          itemCode: 'I1',
          itemName: 'X',
          receivedQty: 10,
          qcStatus: 'Completed',
          qcAcceptedQty: 8,
          qcRejectedQty: 5, // accepted+rejected = 13 > 10
        },
      ],
      ctxWith({ items: [['I1', 'iu']] }),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['qcStatus']).toBe('completed');
    expect(line['qcAcceptedQty']).toBe(8);
    expect(line['qcRejectedQty']).toBe(2); // clamped to 10-8
    expect(result[1]?.anomalies.map((a) => a.type)).toContain('qc_total_exceeds_received');
  });

  it('falls back to item_code_text when itemCode lookup misses (ADR-012 #10 — no skip)', () => {
    const result = transformGrn(
      [
        {
          id: 'd1',
          grnNo: 'GRN-A',
          grnDate: '2026-04-18',
          itemCode: 'NOT-IN-MASTER',
          itemName: 'X',
          receivedQty: 1,
        },
      ],
      ctxWith(),
    );
    const line = result[1]?.rows[0] as Record<string, unknown>;
    expect(line['itemId']).toBeNull();
    expect(line['itemCodeText']).toBe('NOT-IN-MASTER');
  });

  it('skips records with missing grnNo or grnDate or invalid receivedQty / itemName', () => {
    const result = transformGrn(
      [
        { id: 'd1' /* no grnNo */ },
        { id: 'd2', grnNo: 'GRN-A' /* no grnDate */ },
        {
          id: 'd3',
          grnNo: 'GRN-B',
          grnDate: '2026-04-18',
          itemName: 'X',
          receivedQty: -1,
        },
        {
          id: 'd4',
          grnNo: 'GRN-B',
          grnDate: '2026-04-18',
          itemCode: 'I1',
          /* no itemName */
          receivedQty: 1,
        },
      ],
      ctxWith({ items: [['I1', 'iu']] }),
    );
    const headerAnomalyTypes = result[0]?.anomalies.map((a) => a.type) ?? [];
    const lineAnomalyTypes = result[1]?.anomalies.map((a) => a.type) ?? [];
    expect(headerAnomalyTypes).toContain('grnNo_missing');
    expect(headerAnomalyTypes).toContain('grnDate_missing');
    expect(lineAnomalyTypes).toContain('receivedQty_invalid');
    expect(lineAnomalyTypes).toContain('itemName_missing');
  });
});
