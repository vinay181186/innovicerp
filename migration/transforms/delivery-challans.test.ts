import { describe, expect, it } from 'vitest';
import { transformDeliveryChallans } from './delivery-challans';
import type { TransformContext } from './types';

function ctxWith({
  items = [],
  vendors = [],
  purchaseOrders = [],
  salesOrderLines = {},
}: {
  items?: Array<[string, string]>;
  vendors?: Array<[string, string]>;
  purchaseOrders?: Array<[string, string]>;
  salesOrderLines?: Record<string, string | null>;
} = {}): TransformContext {
  return {
    idMap: {
      sales_order_lines: salesOrderLines,
    },
    lookups: {
      byCode: {
        items: new Map(items),
        vendors: new Map(vendors),
        purchase_orders: new Map(purchaseOrders),
      },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformDeliveryChallans', () => {
  it('maps the 4 real legacy records (header + lines split)', () => {
    const result = transformDeliveryChallans(
      [
        {
          id: 'w26rg6zy',
          dcNo: 'DC-00002',
          poNo: 'IN-PO-00002',
          dcDate: '2026-03-17',
          vendorCode: 'VND-001',
          soRefId: '574se7ev',
          transport: '',
          lines: [
            {
              itemCode: '60346569',
              itemName: 'BLOCK',
              qty: 83,
              uom: 'NOS',
              material: '1018',
              dcRemarks: 'Machining Only, 32od round bar given.',
            },
          ],
          status: 'Issued',
        },
        {
          id: '3tf3f90k',
          dcNo: 'DC-00001',
          poNo: 'IN-JWPO-00001',
          dcDate: '2026-03-18',
          vendorCode: 'VND-001',
          soRefId: '9is8kb7f',
          transport: '',
          lines: [
            {
              itemCode: '60346519',
              itemName: 'BLOCK',
              qty: 80,
              uom: 'NOS',
              material: 'MS',
              dcRemarks: 'Outsource: drill for IN-JC-00004 (PR: PR-00002)',
            },
          ],
          status: 'Issued',
        },
        {
          id: 'mskmnfg7',
          dcNo: 'DC-00001-02',
          poNo: 'IN-JWPO-00001',
          dcDate: '2026-04-18',
          vendorCode: 'VND-001',
          soRefId: '4n7tmo9u',
          transport: '',
          lines: [
            {
              itemCode: '554117302000',
              itemName: 'JOINT',
              qty: 25,
              uom: 'NOS',
              material: '',
              dcRemarks: 'COATING PROCESS',
            },
          ],
          status: 'Issued',
        },
        {
          id: 'hi12gj7i',
          dcNo: 'DC-00001-03',
          poNo: 'IN-JWPO-00001',
          dcDate: '2026-04-18',
          vendorCode: 'VND-001',
          soRefId: '4n7tmo9u',
          transport: '',
          lines: [
            { itemCode: '554117302000', itemName: 'JOINT', qty: 25, uom: 'NOS', material: '', dcRemarks: '' },
          ],
          status: 'Issued',
        },
      ],
      ctxWith({
        items: [
          ['60346569', 'item-block-1'],
          ['60346519', 'item-block-2'],
          ['554117302000', 'item-joint'],
        ],
        vendors: [['VND-001', 'vendor-uuid']],
        purchaseOrders: [['IN-JWPO-00001', 'po-jw-001']],
        salesOrderLines: { '4n7tmo9u': 'sol-uuid-4n7tmo9u' },
      }),
    );

    expect(result).toHaveLength(2);
    const [headers, lines] = result;
    expect(headers?.table).toBe('delivery_challans');
    expect(headers?.rows).toHaveLength(4);
    expect(lines?.table).toBe('delivery_challan_lines');
    expect(lines?.rows).toHaveLength(4);

    const headerRows = headers?.rows as Array<Record<string, unknown>>;
    const lineRows = lines?.rows as Array<Record<string, unknown>>;
    const dc00002 = headerRows.find((h) => h['code'] === 'DC-00002') as Record<string, unknown>;
    expect(dc00002['purchaseOrderId']).toBeNull(); // IN-PO-00002 unmigrated
    expect(dc00002['poCodeText']).toBe('IN-PO-00002');
    expect(dc00002['salesOrderLineId']).toBeNull();
    expect(dc00002['soRefText']).toBe('574se7ev');
    expect(dc00002['vendorId']).toBe('vendor-uuid');
    expect(dc00002['status']).toBe('issued');

    const dc00001_02 = headerRows.find((h) => h['code'] === 'DC-00001-02') as Record<string, unknown>;
    expect(dc00001_02['purchaseOrderId']).toBe('po-jw-001');
    expect(dc00001_02['salesOrderLineId']).toBe('sol-uuid-4n7tmo9u');

    // 2 of 4 soRefIds resolve to the same SO line (4n7tmo9u via DC-00001-02
    // and DC-00001-03); the other 2 (574se7ev, 9is8kb7f) are unresolved → 2
    // so_line_unresolved anomalies. Plus 1 po_unresolved (DC-00002 → IN-PO-00002).
    const headerAnomTypes = headers?.anomalies.map((a) => a.type).sort();
    expect(headerAnomTypes).toEqual(['po_unresolved', 'so_line_unresolved', 'so_line_unresolved']);

    // All 4 line rows should be present, qty preserved as numeric string,
    // uom uppercased to match the Postgres uom enum, line_no=1 (each DC has 1 line)
    expect(lineRows[0]?.['qty']).toBe('83.00');
    expect(lineRows[0]?.['uom']).toBe('NOS');
    expect(lineRows[0]?.['lineNo']).toBe(1);
    expect(lines?.anomalies).toHaveLength(0);
  });

  it('skips header when dcNo missing', () => {
    const [headers, lines] = transformDeliveryChallans(
      [{ id: 'a', dcDate: '2026-03-01', vendorCode: 'V1', poNo: 'P1', lines: [] }],
      ctxWith(),
    );
    expect(headers?.rows).toHaveLength(0);
    expect(lines?.rows).toHaveLength(0);
    expect(headers?.anomalies[0]?.type).toBe('dcNo_missing');
  });

  it('skips header when vendorCode unresolved', () => {
    const [headers] = transformDeliveryChallans(
      [
        {
          id: 'a',
          dcNo: 'DC-X',
          dcDate: '2026-03-01',
          vendorCode: 'NOPE',
          poNo: 'IN-JWPO-00001',
          lines: [],
        },
      ],
      ctxWith({ purchaseOrders: [['IN-JWPO-00001', 'po1']] }),
    );
    expect(headers?.rows).toHaveLength(0);
    expect(headers?.anomalies[0]?.type).toBe('vendor_unresolved');
  });

  it('keeps header when poNo unresolved (po_code_text fallback) — DC-00002 case', () => {
    const [headers] = transformDeliveryChallans(
      [
        {
          id: 'a',
          dcNo: 'DC-00002',
          dcDate: '2026-03-17',
          vendorCode: 'VND-001',
          poNo: 'IN-PO-00002',
          soRefId: '',
          lines: [{ itemCode: '60346569', qty: 1, uom: 'NOS' }],
        },
      ],
      ctxWith({
        items: [['60346569', 'i1']],
        vendors: [['VND-001', 'v1']],
        purchaseOrders: [['IN-JWPO-00001', 'po1']], // IN-PO-00002 NOT here
      }),
    );
    const headerRows = headers?.rows as Array<Record<string, unknown>>;
    expect(headerRows).toHaveLength(1);
    expect(headerRows[0]?.['purchaseOrderId']).toBeNull();
    expect(headerRows[0]?.['poCodeText']).toBe('IN-PO-00002');
    expect(headers?.anomalies[0]?.type).toBe('po_unresolved');
  });

  it('skips line when itemCode unresolved or qty invalid', () => {
    const [headers, lines] = transformDeliveryChallans(
      [
        {
          id: 'a',
          dcNo: 'DC-X',
          dcDate: '2026-03-01',
          vendorCode: 'V1',
          poNo: 'P1',
          lines: [
            { itemCode: 'NOPE', qty: 1, uom: 'NOS' },
            { itemCode: 'I1', qty: 0, uom: 'NOS' },
            { itemCode: 'I1', qty: -3, uom: 'NOS' },
            { itemCode: 'I1', qty: 5, uom: 'NOS' }, // valid
          ],
        },
      ],
      ctxWith({
        items: [['I1', 'i1-uuid']],
        vendors: [['V1', 'v1-uuid']],
        purchaseOrders: [['P1', 'p1-uuid']],
      }),
    );
    const lineRows = lines?.rows as Array<Record<string, unknown>>;
    expect(headers?.rows).toHaveLength(1);
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0]?.['qty']).toBe('5.00');
    expect(lineRows[0]?.['lineNo']).toBe(1); // line counter only increments on valid lines
    const lineAnomTypes = lines?.anomalies.map((a) => a.type).sort();
    expect(lineAnomTypes).toEqual(['line_item_unresolved', 'line_qty_invalid', 'line_qty_invalid']);
  });

  it('defaults unrecognised UOM to "NOS" with anomaly', () => {
    const [, lines] = transformDeliveryChallans(
      [
        {
          id: 'a',
          dcNo: 'DC-X',
          dcDate: '2026-03-01',
          vendorCode: 'V1',
          poNo: 'P1',
          lines: [{ itemCode: 'I1', qty: 1, uom: 'TUNNEL' }],
        },
      ],
      ctxWith({
        items: [['I1', 'i1-uuid']],
        vendors: [['V1', 'v1-uuid']],
        purchaseOrders: [['P1', 'p1-uuid']],
      }),
    );
    const lineRows = lines?.rows as Array<Record<string, unknown>>;
    expect(lineRows[0]?.['uom']).toBe('NOS');
    expect(lines?.anomalies[0]?.type).toBe('line_uom_unrecognised');
  });

  it('produces deterministic UUIDv5 ids stable across re-runs', () => {
    const args = [
      {
        id: 'mskmnfg7',
        dcNo: 'DC-00001-02',
        poNo: 'IN-JWPO-00001',
        dcDate: '2026-04-18',
        vendorCode: 'VND-001',
        soRefId: '4n7tmo9u',
        lines: [{ itemCode: '554117302000', qty: 25, uom: 'NOS' }],
        status: 'Issued',
      },
    ];
    const ctx = ctxWith({
      items: [['554117302000', 'i']],
      vendors: [['VND-001', 'v']],
      purchaseOrders: [['IN-JWPO-00001', 'po']],
      salesOrderLines: { '4n7tmo9u': 'sol' },
    });
    const a = transformDeliveryChallans(args, ctx);
    const b = transformDeliveryChallans(args, ctx);
    const aHdr = a[0]?.rows[0] as Record<string, unknown>;
    const bHdr = b[0]?.rows[0] as Record<string, unknown>;
    const aLine = a[1]?.rows[0] as Record<string, unknown>;
    const bLine = b[1]?.rows[0] as Record<string, unknown>;
    expect(aHdr['id']).toBe(bHdr['id']);
    expect(aLine['id']).toBe(bLine['id']);
  });
});
