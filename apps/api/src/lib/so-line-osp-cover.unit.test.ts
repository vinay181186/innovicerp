import { describe, expect, it } from 'vitest';

import {
  type CoverJcInput,
  type OspPoLineRow,
  computeLineOspCover,
  computeOpCover,
} from './so-line-osp-cover';

// ADR-320 — SO Status PO Raised / GRN Received / QC Accepted cover math.

const line = (p: Partial<OspPoLineRow> = {}): OspPoLineRow => ({
  poCode: 'IN-PO-00001',
  poStatus: 'open',
  poShortClosed: false,
  qty: 34,
  approvedQty: 34,
  receivedQty: 0,
  acceptedQty: 0,
  ...p,
});

const jc = (
  jcCode: string,
  jcOrderQty: number,
  ops: OspPoLineRow[][],
): CoverJcInput => ({
  jcId: `00000000-0000-0000-0000-${jcCode.padStart(12, '0')}`,
  jcCode,
  jcOrderQty,
  ops: ops.map((poLines, i) => ({
    jcOpId: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    opSeq: (i + 1) * 10,
    operation: `Op ${i + 1}`,
    poLines,
  })),
});

describe('computeLineOspCover', () => {
  it('3 ops, one with no PO → PO Raised 0', () => {
    const c = computeLineOspCover(34, [jc('1', 34, [[line()], [line()], []])]);
    expect(c.poRaised).toEqual({ qty: 0, total: 34, required: true });
    expect(c.ospOps.map((o) => o.poState)).toEqual(['approved', 'approved', 'none']);
  });

  it('all ops approved for 34 → 34, not 102', () => {
    const c = computeLineOspCover(34, [jc('1', 34, [[line()], [line()], [line()]])]);
    expect(c.poRaised.qty).toBe(34);
    expect(c.poRaised.total).toBe(34);
  });

  it('GRN total = PO Raised qty, QC total = GRN qty; each capped at the one before', () => {
    const c = computeLineOspCover(34, [
      jc('1', 34, [[line({ receivedQty: 20, acceptedQty: 7 })], [line({ receivedQty: 34, acceptedQty: 34 })]]),
    ]);
    expect(c.poRaised).toEqual({ qty: 34, total: 34, required: true });
    expect(c.grnReceived).toEqual({ qty: 20, total: 34, required: true });
    expect(c.qcAccepted).toEqual({ qty: 7, total: 20, required: true });
  });

  it('two job cards 20 + 14 → 34', () => {
    const c = computeLineOspCover(34, [
      jc('1', 20, [[line({ qty: 20, approvedQty: 20 })]]),
      jc('2', 14, [[line({ qty: 14, approvedQty: 14 })]]),
    ]);
    expect(c.poRaised.qty).toBe(34);
    expect(c.ospOps.map((o) => o.jcCode)).toEqual(['1', '2']);
  });

  it('no outsourced op → Not required, 0/0, no ops', () => {
    const c = computeLineOspCover(34, [jc('1', 34, [])]);
    expect(c.poRaised).toEqual({ qty: 0, total: 0, required: false });
    expect(c.grnReceived).toEqual({ qty: 0, total: 0, required: false });
    expect(c.qcAccepted).toEqual({ qty: 0, total: 0, required: false });
    expect(c.ospOps).toEqual([]);
    expect(computeLineOspCover(34, []).poRaised.required).toBe(false);
  });

  it('line sum capped at the line order qty', () => {
    const c = computeLineOspCover(30, [
      jc('1', 20, [[line({ approvedQty: 20 })]]),
      jc('2', 14, [[line({ approvedQty: 14 })]]),
    ]);
    expect(c.poRaised.qty).toBe(30);
  });
});

describe('computeOpCover', () => {
  it('cancelled PO ignored', () => {
    const c = computeOpCover([line({ poStatus: 'cancelled', poCode: 'IN-JWPO-00005' })], 34);
    expect(c.approvedPoQty).toBe(0);
    expect(c.poState).toBe('none');
    expect(c.poCodes).toEqual([]);
  });

  it('never-approved draft is shown, not counted', () => {
    const c = computeOpCover([line({ poStatus: 'draft', approvedQty: null, qty: 34 })], 34);
    expect(c.approvedPoQty).toBe(0);
    expect(c.draftPoQty).toBe(34);
    expect(c.poState).toBe('draft');
    expect(c.poCodes).toEqual(['IN-PO-00001']);
  });

  it('PO waiting re-approval keeps its last approved qty', () => {
    const c = computeOpCover([line({ poStatus: 'draft', qty: 40, approvedQty: 30 })], 34);
    expect(c.approvedPoQty).toBe(30);
    expect(c.draftPoQty).toBe(0);
    expect(c.poState).toBe('reapproval');
  });

  it('approved wins over a draft on the same op', () => {
    const c = computeOpCover(
      [line({ poCode: 'B' }), line({ poCode: 'A', poStatus: 'draft', approvedQty: null, qty: 5 })],
      34,
    );
    expect(c.poState).toBe('approved');
    expect(c.approvedPoQty).toBe(34);
    expect(c.draftPoQty).toBe(5);
    expect(c.poCodes).toEqual(['A', 'B']);
  });

  it('short-closed PO counts only what was received', () => {
    const c = computeOpCover(
      [line({ poShortClosed: true, poStatus: 'closed', approvedQty: 34, receivedQty: 12, acceptedQty: 10 })],
      34,
    );
    expect(c.approvedPoQty).toBe(12);
    expect(c.grnReceivedQty).toBe(12);
    expect(c.qcAcceptedQty).toBe(10);
  });

  it('PO 40 on a JC of 34 is capped at 34', () => {
    const c = computeOpCover([line({ qty: 40, approvedQty: 40, receivedQty: 40, acceptedQty: 40 })], 34);
    expect(c.approvedPoQty).toBe(34);
    expect(c.grnReceivedQty).toBe(34);
    expect(c.qcAcceptedQty).toBe(34);
  });

  it('decimals (KGS) stay on 3 places', () => {
    const c = computeOpCover(
      [
        line({ qty: 0.1, approvedQty: 0.1, receivedQty: 0.1, acceptedQty: 0.1 }),
        line({ qty: 0.2, approvedQty: 0.2, receivedQty: 0.2, acceptedQty: 0.15 }),
      ],
      34,
    );
    expect(c.approvedPoQty).toBe(0.3);
    expect(c.grnReceivedQty).toBe(0.3);
    expect(c.qcAcceptedQty).toBe(0.25);
  });
});
