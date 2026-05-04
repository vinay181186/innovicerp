import { describe, expect, it } from 'vitest';
import { transformPurchaseRequests } from './purchase-requests';
import { legacyPurchaseOrderUuid } from './purchase-orders';
import type { TransformContext } from './types';

function ctxWith(
  opts: {
    items?: Array<[string, string]>;
    vendors?: Array<[string, string]>;
    jcOps?: Array<[string, string]>; // key: `${jcNo}::${opSeq}` → uuid
    soLines?: Record<string, string>; // legacyId → uuid
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
        jc_ops: new Map(opts.jcOps ?? []),
      },
    },
  };
}

describe('transformPurchaseRequests', () => {
  it('produces one purchase_requests result with the row mapped end-to-end', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'doc1',
          prNo: 'PR-00001',
          prDate: '2026-04-18',
          status: 'PO Created',
          jcNo: 'IN-JC-00002',
          opSeq: 7,
          soRefId: 'so-line-legacy-1',
          itemCode: '554117302000',
          itemName: 'JOINT',
          operation: 'COATING',
          vendorCode: 'VND-001',
          qty: 60,
          estCost: 50,
          remarks: 'From Plan PLN-00002',
          poNo: 'IN-JWPO-00001',
          approvedBy: 'Japan',
          approvedDate: '2026-04-18',
          poCreatedDate: '2026-04-18',
        },
      ],
      ctxWith({
        items: [['554117302000', 'item-uuid']],
        vendors: [['VND-001', 'vendor-uuid']],
        jcOps: [['IN-JC-00002::7', 'jcop-uuid']],
        soLines: { 'so-line-legacy-1': 'soline-uuid' },
      }),
    );
    expect(result.table).toBe('purchase_requests');
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]!;
    expect(r.code).toBe('PR-00001');
    expect(r.status).toBe('po_created');
    expect(r.itemId).toBe('item-uuid');
    expect(r.vendorId).toBe('vendor-uuid');
    expect(r.sourceJcOpId).toBe('jcop-uuid');
    expect(r.sourceSoLineId).toBe('soline-uuid');
    expect(r.qty).toBe(60);
    expect(r.estCost).toBe('50.00');
    expect(r.poId).toBe(legacyPurchaseOrderUuid('IN-JWPO-00001'));
    expect(r.approvedBy).toBeNull();
    expect(r.approvedAt).toBe('2026-04-18T00:00:00Z');
  });

  it('falls back to *_code_text when vendor or item lookup misses (ADR-012 #10 pattern)', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'doc1',
          prNo: 'PR-X',
          prDate: '2026-04-18',
          jcNo: '',
          itemCode: 'NOT-IN-MASTER',
          vendorCode: 'NOT-A-VENDOR',
          qty: 1,
        },
      ],
      ctxWith(),
    );
    const r = result.rows[0]!;
    expect(r.itemId).toBeNull();
    expect(r.itemCodeText).toBe('NOT-IN-MASTER');
    expect(r.vendorId).toBeNull();
    expect(r.vendorCodeText).toBe('NOT-A-VENDOR');
    // No anomaly for the fallback itself — only when both are empty.
    const types = result.anomalies.map((a) => a.type);
    expect(types).not.toContain('item_missing');
    expect(types).not.toContain('vendor_missing');
  });

  it('logs a jc_op_unresolved anomaly when jcNo+opSeq present but composite key misses', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'doc1',
          prNo: 'PR-X',
          prDate: '2026-04-18',
          jcNo: 'IN-JC-99',
          opSeq: 7,
          vendorCode: 'V1',
          itemCode: 'I1',
          qty: 1,
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        vendors: [['V1', 'vu']],
        // no jcOps lookup populated
      }),
    );
    const r = result.rows[0]!;
    expect(r.sourceJcOpId).toBeNull();
    const types = result.anomalies.map((a) => a.type);
    expect(types).toContain('jc_op_unresolved');
  });

  it('logs so_line_unresolved when soRefId is in payload but missing from idMap', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'doc1',
          prNo: 'PR-X',
          prDate: '2026-04-18',
          soRefId: 'unknown-so-line',
          vendorCode: 'V1',
          itemCode: 'I1',
          qty: 1,
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        vendors: [['V1', 'vu']],
        soLines: {},
      }),
    );
    const r = result.rows[0]!;
    expect(r.sourceSoLineId).toBeNull();
    expect(result.anomalies.map((a) => a.type)).toContain('so_line_unresolved');
  });

  it('logs approved_by_text_only anomaly but stores approved_by=null', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'd1',
          prNo: 'PR-X',
          prDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          qty: 1,
          approvedBy: 'Japan',
          approvedDate: '2026-04-18',
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    expect(result.rows[0]!.approvedBy).toBeNull();
    expect(result.rows[0]!.approvedAt).toBe('2026-04-18T00:00:00Z');
    expect(result.anomalies.map((a) => a.type)).toContain('approved_by_text_only');
  });

  it('skips records with missing prNo / prDate / qty<=0 / no vendor refs at all', () => {
    const result = transformPurchaseRequests(
      [
        { id: 'd1' /* no prNo */ },
        { id: 'd2', prNo: 'PR-A' /* no prDate */ },
        { id: 'd3', prNo: 'PR-B', prDate: '2026-04-18', vendorCode: 'V1', itemCode: 'I1', qty: 0 },
        {
          id: 'd4',
          prNo: 'PR-C',
          prDate: '2026-04-18',
          itemCode: 'I1',
          qty: 1 /* no vendorCode at all */,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.anomalies.map((a) => a.type).sort()).toEqual([
      'prDate_missing',
      'prNo_missing',
      'qty_invalid',
      'vendor_missing',
    ]);
  });

  it('preserves _legacyPrCode + _resolvedJcOpId for the PO transform bridge', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'd1',
          prNo: 'PR-99',
          prDate: '2026-04-18',
          jcNo: 'IN-JC-00002',
          opSeq: 7,
          vendorCode: 'V1',
          itemCode: 'I1',
          qty: 1,
        },
      ],
      ctxWith({
        items: [['I1', 'iu']],
        vendors: [['V1', 'vu']],
        jcOps: [['IN-JC-00002::7', 'jcop-uuid']],
      }),
    );
    const r = result.rows[0]!;
    expect(r._legacyPrCode).toBe('PR-99');
    expect(r._resolvedJcOpId).toBe('jcop-uuid');
  });

  it('po_id is null when legacy poNo is empty', () => {
    const result = transformPurchaseRequests(
      [
        {
          id: 'd1',
          prNo: 'PR-X',
          prDate: '2026-04-18',
          vendorCode: 'V1',
          itemCode: 'I1',
          qty: 1,
        },
      ],
      ctxWith({ items: [['I1', 'iu']], vendors: [['V1', 'vu']] }),
    );
    expect(result.rows[0]!.poId).toBeNull();
  });
});
