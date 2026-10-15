// ADR-233 — close history kinds + header-built rows. Pure, no database.

import { describe, expect, it } from 'vitest';
import { productionOrderShortClosedQty } from '@innovic/shared';
import {
  buildCloseHistory,
  needsZeroCreditFinishShortRow,
  type CloseHistoryOrder,
  type CloseLedgerRow,
} from './close-history';

const PO = '00000000-0000-4000-8000-000000000001';
const U = '00000000-0000-4000-8000-0000000000aa';

function order(o: Partial<CloseHistoryOrder> & { creditedQty?: number | null }): CloseHistoryOrder {
  const base = {
    id: PO,
    status: 'open' as CloseHistoryOrder['status'],
    orderQty: 10,
    lostQty: null,
    shortClosedAt: null,
    shortClosedBy: null,
    shortClosedByName: null,
    shortCloseReason: null,
    closedAt: null,
    closedBy: null,
    closedByName: null,
    ...o,
  };
  return {
    ...base,
    shortClosedQty: productionOrderShortClosedQty({
      status: base.status,
      orderQty: base.orderQty,
      creditedQty: o.creditedQty ?? null,
    }),
  };
}

function row(
  id: string,
  at: string,
  qty: number,
  extra: Partial<CloseLedgerRow> = {},
): CloseLedgerRow {
  return {
    id,
    productionOrderId: PO,
    qty,
    isReversal: false,
    reversesCloseId: null,
    lostQty: null,
    remarks: null,
    closedAt: at,
    closedBy: U,
    closedByName: 'Tester',
    ...extra,
  };
}

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const R1 = '00000000-0000-4000-8000-0000000000e1';

describe('buildCloseHistory (ADR-233)', () => {
  it('types ledger rows: close, finish_short (with its Short Closed Qty), reversal', () => {
    const ledger = [
      row(C2, '2026-10-02T00:00:00.000Z', 2, { lostQty: 4 }),
      row(C1, '2026-10-01T00:00:00.000Z', 4),
    ];
    const out = buildCloseHistory(
      order({
        status: 'closed',
        creditedQty: 6,
        lostQty: 4,
        closedAt: '2026-10-02T00:00:00.000Z',
        closedBy: U,
      }),
      ledger,
      null,
    );
    expect(out.map((r) => r.kind)).toEqual(['finish_short', 'close']);
    expect(out[0]!.shortClosedQty).toBe(4);
    expect(out[1]!.shortClosedQty).toBeNull();
    expect(out.every((r) => r.reversible)).toBe(true);

    const rev = buildCloseHistory(
      order({ status: 'partially_closed', creditedQty: 4 }),
      [
        row(R1, '2026-10-03T00:00:00.000Z', 2, { isReversal: true, reversesCloseId: C2 }),
        ...ledger,
      ],
      null,
    );
    expect(rev.map((r) => r.kind)).toEqual(['reversal', 'finish_short', 'close']);
  });

  it('adds a Short Close row from the header, not reversible, newest first', () => {
    const out = buildCloseHistory(
      order({
        status: 'short_closed',
        creditedQty: 6,
        lostQty: 1,
        shortClosedAt: '2026-10-05T00:00:00.000Z',
        shortClosedBy: U,
        shortCloseReason: 'Customer cancelled the balance',
      }),
      [row(C1, '2026-10-01T00:00:00.000Z', 6)],
      null,
    );
    expect(out[0]).toMatchObject({
      id: PO,
      kind: 'short_close',
      qty: 0,
      shortClosedQty: 4,
      lostQty: 1,
      reversible: false,
      remarks: 'Customer cancelled the balance',
    });
    expect(out[1]!.kind).toBe('close');
  });

  it('adds a 0-credit Finish Short row only when no live Finish Short ledger row exists', () => {
    const o = order({
      status: 'closed',
      creditedQty: 6,
      lostQty: 4,
      closedAt: '2026-10-04T00:00:00.000Z',
      closedBy: U,
    });
    const ledger = [row(C1, '2026-10-01T00:00:00.000Z', 6)];
    expect(needsZeroCreditFinishShortRow(o, ledger)).toBe(true);
    const out = buildCloseHistory(o, ledger, 'JC done, rest scrapped');
    expect(out[0]).toMatchObject({
      id: PO,
      kind: 'finish_short',
      qty: 0,
      shortClosedQty: 4,
      reversible: false,
      remarks: 'JC done, rest scrapped',
    });

    // A Finish Short that credited pieces has its own ledger row — no extra row.
    const withLedger = [row(C2, '2026-10-04T00:00:00.000Z', 2, { lostQty: 4 }), ...ledger];
    expect(needsZeroCreditFinishShortRow(o, withLedger)).toBe(false);
    expect(buildCloseHistory(o, withLedger, null)).toHaveLength(2);
  });

  it('builds no header row for an open or fully closed order', () => {
    const full = order({
      status: 'closed',
      creditedQty: 10,
      closedAt: '2026-10-04T00:00:00.000Z',
      closedBy: U,
    });
    expect(buildCloseHistory(full, [row(C1, '2026-10-04T00:00:00.000Z', 10)], null)).toHaveLength(
      1,
    );
    expect(buildCloseHistory(order({}), [], null)).toEqual([]);
  });

  it('reads a Finish Short that left nothing short as an ordinary close', () => {
    const out = buildCloseHistory(
      order({ status: 'closed', creditedQty: 10, lostQty: 0, closedAt: '2026-10-02T10:00:00Z' }),
      [
        row('00000000-0000-4000-8000-000000000011', '2026-10-01T10:00:00Z', 6),
        row('00000000-0000-4000-8000-000000000012', '2026-10-02T10:00:00Z', 4, { lostQty: 0 }),
      ],
      null,
    );
    expect(out.map((r) => [r.kind, r.shortClosedQty])).toEqual([
      ['close', null],
      ['close', null],
    ]);
  });
});
