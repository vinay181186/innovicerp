import { describe, expect, it } from 'vitest';
import { transformStoreTransactions } from './store-transactions';
import type { TransformContext } from './types';

function ctxWith(items: Array<[string, string]> = []): TransformContext {
  return {
    idMap: {},
    lookups: {
      byCode: { items: new Map(items) },
      byName: {},
      byCompositeKey: {},
    },
  };
}

describe('transformStoreTransactions', () => {
  it('produces one store_transactions result with the row mapped end-to-end', () => {
    const result = transformStoreTransactions(
      [
        {
          id: 'd1',
          date: '2026-04-18',
          itemCode: '554117302000',
          type: 'IN',
          qty: 25,
          source: 'GRN QC',
          refNo: 'IN-GRN-00001',
          remarks: 'QC accepted',
          stockBefore: 0,
          stockAfter: 25,
        },
      ],
      ctxWith([['554117302000', 'item-uuid']]),
    );
    expect(result.table).toBe('store_transactions');
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]!;
    expect(r.itemId).toBe('item-uuid');
    expect(r.txnType).toBe('in');
    expect(r.sourceType).toBe('grn_qc');
    expect(r.sourceRef).toBe('IN-GRN-00001');
    expect(r.qty).toBe(25);
    expect(r.stockBefore).toBe(0);
    expect(r.stockAfter).toBe(25);
  });

  it('normalises txn type and source type to lowercase enum values', () => {
    const result = transformStoreTransactions(
      [
        {
          id: 'd1',
          date: '2026-04-18',
          itemCode: 'I1',
          type: 'OUT',
          qty: 5,
          source: 'Dispatch',
          refNo: 'DISP-1',
          stockBefore: 10,
          stockAfter: 5,
        },
      ],
      ctxWith([['I1', 'iu']]),
    );
    const r = result.rows[0]!;
    expect(r.txnType).toBe('out');
    expect(r.sourceType).toBe('dispatch');
  });

  it('falls back to item_code_text when itemCode lookup misses', () => {
    const result = transformStoreTransactions(
      [
        {
          id: 'd1',
          date: '2026-04-18',
          itemCode: 'NOT-IN-MASTER',
          type: 'IN',
          qty: 1,
          source: 'GRN QC',
          refNo: 'GRN-1',
        },
      ],
      ctxWith(),
    );
    const r = result.rows[0]!;
    expect(r.itemId).toBeNull();
    expect(r.itemCodeText).toBe('NOT-IN-MASTER');
  });

  it('flags stock_arithmetic_mismatch when stockAfter does not equal stockBefore ± qty (but still loads)', () => {
    const result = transformStoreTransactions(
      [
        {
          id: 'd1',
          date: '2026-04-18',
          itemCode: 'I1',
          type: 'IN',
          qty: 5,
          source: 'GRN QC',
          refNo: 'GRN-1',
          stockBefore: 0,
          stockAfter: 99, // wrong on purpose; expected 5
        },
      ],
      ctxWith([['I1', 'iu']]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.anomalies.map((a) => a.type)).toContain('stock_arithmetic_mismatch');
  });

  it('skips rows with missing date / qty<=0 / missing source_ref', () => {
    const result = transformStoreTransactions(
      [
        { id: 'd1' /* no date */ },
        {
          id: 'd2',
          date: '2026-04-18',
          itemCode: 'I1',
          type: 'IN',
          qty: 0,
          source: 'GRN QC',
          refNo: 'GRN-1',
        },
        {
          id: 'd3',
          date: '2026-04-18',
          itemCode: 'I1',
          type: 'IN',
          qty: 1,
          source: 'GRN QC',
          refNo: '',
        },
      ],
      ctxWith([['I1', 'iu']]),
    );
    expect(result.rows).toHaveLength(0);
    const types = result.anomalies.map((a) => a.type).sort();
    expect(types).toEqual(['date_missing', 'qty_invalid', 'source_ref_missing']);
  });

  it('logs source_type_unrecognised but defaults to "other" and still loads', () => {
    const result = transformStoreTransactions(
      [
        {
          id: 'd1',
          date: '2026-04-18',
          itemCode: 'I1',
          type: 'IN',
          qty: 1,
          source: 'Mystery Source',
          refNo: 'X',
        },
      ],
      ctxWith([['I1', 'iu']]),
    );
    expect(result.rows[0]!.sourceType).toBe('other');
    expect(result.anomalies.map((a) => a.type)).toContain('source_type_unrecognised');
  });
});
