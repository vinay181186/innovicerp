// Unit tests for calc-engine. Pure functions, no DB — synthetic fixtures only.

import { describe, expect, it } from 'vitest';
import type { jcOps, jobCards, opLog } from '../db/schema';
import {
  derivePerLineStage,
  deriveOverallSoStatus,
  enrichOps,
  rollupJC,
  rollupSoLine,
} from './calc-engine';

type JcRow = typeof jobCards.$inferSelect;
type JcOpRow = typeof jcOps.$inferSelect;
type OpLogRow = typeof opLog.$inferSelect;

const NOW = new Date('2026-05-21T10:00:00Z');
const COMPANY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ITEM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function jc(over: Partial<JcRow> = {}): JcRow {
  return {
    id: 'jc-1',
    companyId: COMPANY,
    code: 'JC-001',
    jcDate: '2026-05-01',
    itemId: ITEM,
    orderQty: 100,
    priority: 'normal',
    dueDate: '2026-06-01',
    drawingFilePath: null,
    sourceSoLineId: null,
    sourceJwLineId: null,
    sourceLegacyRef: null,
    parentNcId: null,
    closedAt: null,
    createdAt: NOW,
    createdBy: USER,
    updatedAt: NOW,
    updatedBy: USER,
    deletedAt: null,
    ...over,
  } as JcRow;
}

function op(over: Partial<JcOpRow> & Pick<JcOpRow, 'id' | 'opSeq'>): JcOpRow {
  return {
    companyId: COMPANY,
    jobCardId: 'jc-1',
    machineId: null,
    machineCodeText: null,
    operation: `Op ${over.opSeq}`,
    opType: 'process',
    cycleTimeMin: '0',
    program: null,
    toolNo: null,
    toolDetails: null,
    qcRequired: false,
    qcCallDate: null,
    qcAttendedDate: null,
    reworkQty: 0,
    outsourceVendorId: null,
    outsourceVendorText: null,
    outsourceCost: '0',
    outsourceStatus: null,
    outsourcePrId: null,
    outsourcePoLineId: null,
    outsourceDcNo: null,
    outsourceSentQty: 0,
    outsourceSentDate: null,
    outsourceReturnedQty: 0,
    createdAt: NOW,
    createdBy: USER,
    updatedAt: NOW,
    updatedBy: USER,
    deletedAt: null,
    ...over,
  } as JcOpRow;
}

function log(
  jcOpId: string,
  logType: OpLogRow['logType'],
  qty: number,
  rejectQty = 0,
): OpLogRow {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    companyId: COMPANY,
    jcOpId,
    logNo: `LOG-${Math.random().toString(36).slice(2)}`,
    logType,
    logDate: '2026-05-10',
    shift: 'day',
    qty,
    rejectQty,
    operatorId: null,
    operatorName: null,
    startTime: null,
    remarks: null,
    createdAt: NOW,
    createdBy: USER,
  } as OpLogRow;
}

describe('enrichOps', () => {
  it('returns empty for a JC with no ops', () => {
    expect(enrichOps(jc(), [], [], new Set())).toEqual([]);
  });

  it('first op inputAvail = jc.orderQty; later ops inherit prev output', () => {
    const ops = [op({ id: 'o1', opSeq: 1 }), op({ id: 'o2', opSeq: 2 })];
    const logs = [log('o1', 'complete', 60)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    expect(enriched[0]?.inputAvail).toBe(100);
    expect(enriched[0]?.completed).toBe(60);
    expect(enriched[1]?.inputAvail).toBe(60);
    expect(enriched[1]?.completed).toBe(0);
  });

  it('process op: completed >= inputAvail → complete', () => {
    const ops = [op({ id: 'o1', opSeq: 1 })];
    const logs = [log('o1', 'complete', 100)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[0]?.status).toBe('complete');
    expect(enriched[0]?.available).toBe(0);
  });

  it('process op: completed > 0 but < inputAvail → in_progress', () => {
    const ops = [op({ id: 'o1', opSeq: 1 })];
    const logs = [log('o1', 'complete', 40)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[0]?.status).toBe('in_progress');
    expect(enriched[0]?.available).toBe(60);
  });

  it('process op: completed=0, inputAvail>0 → available', () => {
    const ops = [op({ id: 'o1', opSeq: 1 })];
    const enriched = enrichOps(jc(), ops, [], new Set());
    expect(enriched[0]?.status).toBe('available');
  });

  it('process op: inputAvail=0 → waiting', () => {
    // Op 2 with op 1 incomplete → input from op 1 is 0
    const ops = [op({ id: 'o1', opSeq: 1 }), op({ id: 'o2', opSeq: 2 })];
    const enriched = enrichOps(jc(), ops, [], new Set());
    expect(enriched[1]?.inputAvail).toBe(0);
    expect(enriched[1]?.status).toBe('waiting');
  });

  it('running flag → status=running (beats in_progress)', () => {
    const ops = [op({ id: 'o1', opSeq: 1 })];
    const logs = [log('o1', 'complete', 30)];
    const enriched = enrichOps(jc(), ops, logs, new Set(['o1']));
    expect(enriched[0]?.running).toBe(true);
    expect(enriched[0]?.status).toBe('running');
  });

  it('process+qcRequired: completed reached, qc fully accepted → complete', () => {
    const ops = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs = [log('o1', 'complete', 100), log('o1', 'qc', 100, 0)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[0]?.qcAccepted).toBe(100);
    expect(enriched[0]?.qcPending).toBe(0);
    expect(enriched[0]?.status).toBe('complete');
  });

  it('process+qcRequired: completed reached, qc not yet attended → qc_pending', () => {
    const ops = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs = [log('o1', 'complete', 100)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[0]?.qcPending).toBe(100);
    expect(enriched[0]?.status).toBe('qc_pending');
  });

  it('process+qcRequired: partial qc with rejects → qcPending = completed - acc - rej', () => {
    const ops = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs = [log('o1', 'complete', 100), log('o1', 'qc', 70, 10)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[0]?.qcAccepted).toBe(70);
    expect(enriched[0]?.qcRejected).toBe(10);
    expect(enriched[0]?.qcPending).toBe(20);
    expect(enriched[0]?.status).toBe('qc_pending');
  });

  it('qc op: input flows directly to qc; complete only when ACCEPTED >= inputAvail (0125)', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, [log('o1', 'qc', 100, 0)], new Set());
    expect(enriched[0]?.qcAccepted).toBe(100);
    expect(enriched[0]?.qcPending).toBe(0);
    expect(enriched[0]?.status).toBe('complete');
  });

  // QC-NC audit 2026-09-21 gap 6 — mirrors v_jc_op_status (0125): the old rule
  // here was acc + rej >= input, so op 30 of a 10-piece JC read complete at
  // 8 accepted / 2 rejected while the view (and the JC) said otherwise.
  it('qc op: rejected pieces do NOT count — 95 accepted / 5 rejected of 100 is in_progress, not complete', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const logs = [log('o1', 'qc', 95, 5)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    expect(enriched[0]?.qcAccepted).toBe(95);
    expect(enriched[0]?.qcRejected).toBe(5);
    expect(enriched[0]?.qcPending).toBe(0); // nothing left to inspect …
    expect(enriched[0]?.status).toBe('in_progress'); // … but not everything accepted
  });

  it('qc op: the recovered pieces come back as a qc-accepted re-inject row and complete the op', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    // 8 accepted / 2 rejected, then the rework child clears 2 → re-inject row.
    const logs = [log('o1', 'qc', 8, 2), log('o1', 'qc', 2, 0)];
    const enriched = enrichOps(jc({ orderQty: 10 }), ops, logs, new Set());
    expect(enriched[0]?.qcAccepted).toBe(10);
    expect(enriched[0]?.status).toBe('complete');
  });

  it('qc op: an OPEN rework/repair child on the op holds it at in_progress even when accepted >= input (0124)', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const logs = [log('o1', 'qc', 10, 0)];
    const withOpen = enrichOps(
      jc({ orderQty: 10 }),
      ops,
      logs,
      new Set(),
      undefined,
      new Map([['o1', 2]]),
    );
    expect(withOpen[0]?.status).toBe('in_progress');
    // Child settled (map empty / qty 0) → complete again.
    const settled = enrichOps(jc({ orderQty: 10 }), ops, logs, new Set(), undefined, new Map());
    expect(settled[0]?.status).toBe('complete');
    const zero = enrichOps(
      jc({ orderQty: 10 }),
      ops,
      logs,
      new Set(),
      undefined,
      new Map([['o1', 0]]),
    );
    expect(zero[0]?.status).toBe('complete');
  });

  it('qc op: open rework on a DIFFERENT op does not hold this one', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const logs = [log('o1', 'qc', 10, 0)];
    const r = enrichOps(
      jc({ orderQty: 10 }),
      ops,
      logs,
      new Set(),
      undefined,
      new Map([['o9', 2]]),
    );
    expect(r[0]?.status).toBe('complete');
  });

  it('process+qcRequired: open rework child holds a fully-accepted op at in_progress (0124)', () => {
    const ops = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs = [log('o1', 'complete', 10), log('o1', 'qc', 10, 0)];
    const held = enrichOps(
      jc({ orderQty: 10 }),
      ops,
      logs,
      new Set(),
      undefined,
      new Map([['o1', 1]]),
    );
    expect(held[0]?.status).toBe('in_progress');
    const free = enrichOps(jc({ orderQty: 10 }), ops, logs, new Set());
    expect(free[0]?.status).toBe('complete');
  });

  it('rollupJC: a QC last op with rejects outstanding keeps the JC in_progress and doneQty = accepted only', () => {
    const ops = [
      op({ id: 'o1', opSeq: 1 }),
      op({ id: 'o2', opSeq: 2, opType: 'qc', qcRequired: true }),
    ];
    const logs = [log('o1', 'complete', 10), log('o2', 'qc', 8, 2)];
    const enriched = enrichOps(jc({ orderQty: 10 }), ops, logs, new Set());
    const rollup = rollupJC(jc({ orderQty: 10 }), enriched);
    expect(rollup.doneQty).toBe(8);
    expect(rollup.remainingQty).toBe(2);
    expect(rollup.status).toBe('in_progress');
  });

  it('qc op: partial resolution → qc_pending', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const logs = [log('o1', 'qc', 50, 0)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    expect(enriched[0]?.qcPending).toBe(50);
    expect(enriched[0]?.status).toBe('qc_pending');
  });

  it('outsource op: outsourceStatus=null → outsource_pending', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'outsource' })];
    const enriched = enrichOps(jc(), ops, [], new Set());
    expect(enriched[0]?.status).toBe('outsource_pending');
  });

  it('outsource op: every outsourceStatus maps to corresponding op status', () => {
    const cases: Array<[JcOpRow['outsourceStatus'], string]> = [
      ['pr_raised', 'outsource_pr_raised'],
      ['po_created', 'outsource_po_created'],
      ['sent', 'outsource_at_vendor'],
      ['received', 'outsource_received'],
    ];
    for (const [os, expected] of cases) {
      const ops = [op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: os })];
      const enriched = enrichOps(jc(), ops, [], new Set());
      expect(enriched[0]?.status, `outsourceStatus=${os}`).toBe(expected);
    }
  });

  it('outsource op: GRN-accepted qty (ospAcceptedByOp) counts as completed (G9c)', () => {
    const ops = [
      op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'sent' }),
      op({ id: 'o2', opSeq: 2 }),
    ];
    // Partly back: 7 of 10 accepted → still at vendor, 3 outstanding.
    const partial = enrichOps(jc({ orderQty: 10 }), ops, [], new Set(), new Map([['o1', 7]]));
    expect(partial[0]?.completed).toBe(7);
    expect(partial[0]?.status).toBe('outsource_at_vendor');
    expect(partial[0]!.inputAvail - partial[0]!.completed).toBe(3);
    expect(partial[1]?.inputAvail).toBe(7);
    // Fully back: 10 of 10 accepted → complete, whatever the stamp says.
    const full = enrichOps(jc({ orderQty: 10 }), ops, [], new Set(), new Map([['o1', 10]]));
    expect(full[0]?.status).toBe('complete');
    expect(full[1]?.inputAvail).toBe(10);
    // Map absent → unchanged legacy behaviour (op_log only).
    const legacy = enrichOps(jc({ orderQty: 10 }), ops, [], new Set());
    expect(legacy[0]?.completed).toBe(0);
    expect(legacy[0]?.status).toBe('outsource_at_vendor');
    // Map only applies to outsource ops.
    const inHouse = enrichOps(
      jc({ orderQty: 10 }),
      [op({ id: 'o3', opSeq: 1 })],
      [],
      new Set(),
      new Map([['o3', 10]]),
    );
    expect(inHouse[0]?.completed).toBe(0);
  });

  // ADR-167 code-review F2 / R1 (a) — mirrors v_jc_op_status.completed_qty
  // (0130): for an outsource op WITHOUT shop QC, op_log 'qc' accepted rows
  // (rework-child re-inject, use_as_is) are recovered pieces and count as
  // completed alongside the GRN-accepted qty.
  it('outsource op, qcRequired=false: GRN-accepted 8 + re-injected qc 2 → completed 10, complete, next op fed 10 (F2 / R1-a)', () => {
    const ops = [
      op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'received' }),
      op({ id: 'o2', opSeq: 2 }),
    ];
    // GRN: 8 accepted, 2 rejected → NC → rework child → 2 recovered and
    // re-injected onto o1 as one op_log qc row (recovery.ts reinjectIntoOriginOp).
    const before = enrichOps(jc({ orderQty: 10 }), ops, [], new Set(), new Map([['o1', 8]]));
    expect(before[0]?.completed).toBe(8);
    expect(before[0]?.status).toBe('outsource_received');
    expect(before[1]?.inputAvail).toBe(8);

    const logs = [log('o1', 'qc', 2)];
    const after = enrichOps(jc({ orderQty: 10 }), ops, logs, new Set(), new Map([['o1', 8]]));
    expect(after[0]?.completed).toBe(10);
    expect(after[0]?.qcAccepted).toBe(2);
    expect(after[0]?.status).toBe('complete');
    expect(after[1]?.inputAvail).toBe(10);
    // Not qcRequired → no shop-QC bucket appears from the re-inject row.
    expect(after[0]?.qcPending).toBe(0);
  });

  // ADR-167 code-review F3 / R1–R3 — with qcRequired the op_log qc rows are
  // the shop's own inspection of the SAME pieces the GRN counted: they must
  // NOT add to completed, and qc_pending must not pre-empt the at-vendor
  // identity while pieces are still out.
  describe('outsource op with qcRequired (shop QC on top of the vendor GRN)', () => {
    const ops = () => [
      op({
        id: 'o1',
        opSeq: 1,
        opType: 'outsource',
        outsourceStatus: 'received',
        qcRequired: true,
      }),
      op({ id: 'o2', opSeq: 2 }),
    ];

    it('(b) GRN 5 of 10, shop QC 5, stamp sent → completed 5 (not 10), outsource_at_vendor, NOT complete', () => {
      const half = [
        op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'sent', qcRequired: true }),
        op({ id: 'o2', opSeq: 2 }),
      ];
      const r = enrichOps(
        jc({ orderQty: 10 }),
        half,
        [log('o1', 'qc', 5)],
        new Set(),
        new Map([['o1', 5]]),
      );
      expect(r[0]?.completed).toBe(5);
      expect(r[0]?.qcAccepted).toBe(5);
      expect(r[0]?.qcPending).toBe(0);
      expect(r[0]?.status).toBe('outsource_at_vendor');
      expect(r[0]?.status).not.toBe('complete');
      // 5 still at the vendor for so-status / so-overview atVendorQty.
      expect(r[0]!.inputAvail - r[0]!.completed).toBe(5);
      expect(r[1]?.inputAvail).toBe(5);
    });

    it('(b2) GRN 5 of 10, shop QC still outstanding on those 5, stamp sent → still outsource_at_vendor, not qc_pending (R3)', () => {
      const half = [
        op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'sent', qcRequired: true }),
      ];
      const r = enrichOps(jc({ orderQty: 10 }), half, [], new Set(), new Map([['o1', 5]]));
      expect(r[0]?.completed).toBe(5);
      expect(r[0]?.qcPending).toBe(5);
      expect(r[0]?.status).toBe('outsource_at_vendor');
    });

    it('(c) GRN 10, shop QC 0 → completed 10, qc_pending, next op fed 0', () => {
      const r = enrichOps(jc({ orderQty: 10 }), ops(), [], new Set(), new Map([['o1', 10]]));
      expect(r[0]?.completed).toBe(10);
      expect(r[0]?.qcAccepted).toBe(0);
      expect(r[0]?.qcPending).toBe(10);
      expect(r[0]?.status).toBe('qc_pending');
      expect(r[0]?.status).not.toBe('complete');
      // outputOf() a qcRequired op is qcAccepted — nothing has been cleared yet.
      expect(r[1]?.inputAvail).toBe(0);
    });

    it('(c2) GRN 10, stamp still sent but bar covers the input → qc_pending (pieces are back)', () => {
      const stale = [
        op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'sent', qcRequired: true }),
      ];
      const r = enrichOps(jc({ orderQty: 10 }), stale, [], new Set(), new Map([['o1', 10]]));
      expect(r[0]?.completed).toBe(10);
      expect(r[0]?.status).toBe('qc_pending');
    });

    it('(d) GRN 10, shop QC 10 → completed 10 (not 20), complete, next op fed 10', () => {
      const r = enrichOps(
        jc({ orderQty: 10 }),
        ops(),
        [log('o1', 'qc', 10)],
        new Set(),
        new Map([['o1', 10]]),
      );
      expect(r[0]?.completed).toBe(10);
      expect(r[0]?.qcAccepted).toBe(10);
      expect(r[0]?.qcPending).toBe(0);
      expect(r[0]?.status).toBe('complete');
      expect(r[1]?.inputAvail).toBe(10);
    });

    it('(d2) GRN 10, shop QC 6 accepted / 1 rejected → completed 10, 3 pending, qc_pending, next op fed 6', () => {
      const r = enrichOps(
        jc({ orderQty: 10 }),
        ops(),
        [log('o1', 'qc', 6, 1)],
        new Set(),
        new Map([['o1', 10]]),
      );
      expect(r[0]?.completed).toBe(10);
      expect(r[0]?.qcPending).toBe(3);
      expect(r[0]?.status).toBe('qc_pending');
      expect(r[1]?.inputAvail).toBe(6);
    });
  });

  it('output of qcRequired op flows qcAccepted to next op input, not completed', () => {
    const ops = [
      op({ id: 'o1', opSeq: 1, qcRequired: true }),
      op({ id: 'o2', opSeq: 2 }),
    ];
    // 100 produced, only 80 QC-accepted (15 rejected, 5 pending)
    const logs = [log('o1', 'complete', 100), log('o1', 'qc', 80, 15)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    expect(enriched[1]?.inputAvail).toBe(80);
  });

  it('reworkQty adds to available', () => {
    const ops = [op({ id: 'o1', opSeq: 1, reworkQty: 5 })];
    const logs = [log('o1', 'complete', 60)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    expect(enriched[0]?.available).toBe(45);
  });
});

describe('rollupJC', () => {
  it('no ops → status=no_ops, 0% completion', () => {
    const rollup = rollupJC(jc(), []);
    expect(rollup.status).toBe('no_ops');
    expect(rollup.completionPct).toBe(0);
    expect(rollup.totalOps).toBe(0);
  });

  it('all ops complete → status=complete, 100%', () => {
    const ops = [op({ id: 'o1', opSeq: 1 }), op({ id: 'o2', opSeq: 2 })];
    const logs = [log('o1', 'complete', 100), log('o2', 'complete', 100)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    const rollup = rollupJC(jc({ orderQty: 100 }), enriched);
    expect(rollup.status).toBe('complete');
    expect(rollup.completionPct).toBe(100);
    expect(rollup.doneQty).toBe(100);
    expect(rollup.remainingQty).toBe(0);
  });

  it('any qc_pending op → JC status=qc_pending', () => {
    const ops = [
      op({ id: 'o1', opSeq: 1 }),
      op({ id: 'o2', opSeq: 2, qcRequired: true }),
    ];
    const logs = [log('o1', 'complete', 100), log('o2', 'complete', 100)];
    const enriched = enrichOps(jc(), ops, logs, new Set());
    const rollup = rollupJC(jc(), enriched);
    expect(rollup.status).toBe('qc_pending');
    expect(rollup.qcPendOps).toBe(1);
  });

  it('partial production → status=in_progress, percent floors to integer', () => {
    const ops = [op({ id: 'o1', opSeq: 1 }), op({ id: 'o2', opSeq: 2 })];
    const logs = [log('o1', 'complete', 100), log('o2', 'complete', 33)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    const rollup = rollupJC(jc({ orderQty: 100 }), enriched);
    expect(rollup.status).toBe('in_progress');
    expect(rollup.doneQty).toBe(33);
    expect(rollup.completionPct).toBe(33);
  });

  it('doneQty caps at 100% even when over-produced', () => {
    const ops = [op({ id: 'o1', opSeq: 1 })];
    const logs = [log('o1', 'complete', 150)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    const rollup = rollupJC(jc({ orderQty: 100 }), enriched);
    expect(rollup.completionPct).toBe(100);
    expect(rollup.remainingQty).toBe(0);
  });
});

describe('rollupSoLine', () => {
  it('no JCs → status=no_jc, full remaining', () => {
    const rollup = rollupSoLine('line-1', 50, []);
    expect(rollup.lineStatus).toBe('no_jc');
    expect(rollup.remainingQty).toBe(50);
    expect(rollup.jcCount).toBe(0);
  });

  it('all JCs complete → status=complete', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const logs1 = [log('o1', 'complete', 30)];
    const enriched1 = enrichOps(jc({ id: 'jc-a', orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ id: 'jc-a', orderQty: 30 }), enriched1);

    const ops2 = [op({ id: 'o2', opSeq: 1, jobCardId: 'jc-b' })];
    const logs2 = [log('o2', 'complete', 20)];
    const enriched2 = enrichOps(jc({ id: 'jc-b', orderQty: 20 }), ops2, logs2, new Set());
    const r2 = rollupJC(jc({ id: 'jc-b', orderQty: 20 }), enriched2);

    const rollup = rollupSoLine('line-1', 50, [r1, r2]);
    expect(rollup.lineStatus).toBe('complete');
    expect(rollup.doneQty).toBe(50);
    expect(rollup.completionPct).toBe(100);
    expect(rollup.jcCount).toBe(2);
  });

  it('any JC qc_pending → line status=qc_pending', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs1 = [log('o1', 'complete', 30)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    const rollup = rollupSoLine('line-1', 50, [r1]);
    expect(rollup.lineStatus).toBe('qc_pending');
  });

  it('JC in progress + ample remaining → status=in_progress', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const logs1 = [log('o1', 'complete', 10)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    const rollup = rollupSoLine('line-1', 50, [r1]);
    expect(rollup.lineStatus).toBe('in_progress');
    expect(rollup.doneQty).toBe(10);
    expect(rollup.completionPct).toBe(20);
  });
});

describe('derivePerLineStage', () => {
  it('no JCs → not_released', () => {
    expect(derivePerLineStage([])).toBe('not_released');
  });

  it('explicit hold flag overrides everything', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const logs1 = [log('o1', 'complete', 30)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1], { hold: true })).toBe('hold');
  });

  it('all JCs complete → finished', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const logs1 = [log('o1', 'complete', 30)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('finished');
  });

  it('any op qc_pending → quality_check', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1, qcRequired: true })];
    const logs1 = [log('o1', 'complete', 30)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('quality_check');
  });

  it('outsource op at_vendor → outsourced', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'sent' })];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, [], new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('outsourced');
  });

  it('outsource pr_raised → outsourced (pre-vendor states count)', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1, opType: 'outsource', outsourceStatus: 'pr_raised' })];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, [], new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('outsourced');
  });

  it('production in progress → in_production', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const logs1 = [log('o1', 'complete', 10)];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, logs1, new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('in_production');
  });

  it('JC linked but no progress yet → not_released', () => {
    const ops1 = [op({ id: 'o1', opSeq: 1 })];
    const enriched1 = enrichOps(jc({ orderQty: 30 }), ops1, [], new Set());
    const r1 = rollupJC(jc({ orderQty: 30 }), enriched1);
    expect(derivePerLineStage([r1])).toBe('not_released');
  });
});

describe('deriveOverallSoStatus', () => {
  it('any hold → blocked', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 0,
        totalRequiredQty: 100,
        holdCount: 1,
        finishedCount: 0,
        delayedCount: 0,
        lineCount: 2,
        dueDate: '2026-06-01',
      }),
    ).toBe('blocked');
  });

  it('all lines finished → completed', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 100,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 3,
        delayedCount: 0,
        lineCount: 3,
        dueDate: '2026-06-01',
      }),
    ).toBe('completed');
  });

  it('completed beats delayed (finished count short-circuits before delayed check)', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 100,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 2,
        delayedCount: 1,
        lineCount: 2,
        dueDate: '2025-01-01',
      }),
    ).toBe('completed');
  });

  it('delayed when any line past due', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 10,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 0,
        delayedCount: 1,
        lineCount: 2,
        dueDate: '2025-01-01',
      }),
    ).toBe('delayed');
  });

  it('on_track when in progress + due date in future', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 20,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 0,
        delayedCount: 0,
        lineCount: 2,
        dueDate: '2099-12-31',
        today: '2026-05-21',
      }),
    ).toBe('on_track');
  });

  it('in_progress when in progress + due date past (and not delayed)', () => {
    // delayedCount=0 but dueDate < today → still in_progress, not on_track
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 20,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 0,
        delayedCount: 0,
        lineCount: 2,
        dueDate: '2020-01-01',
        today: '2026-05-21',
      }),
    ).toBe('in_progress');
  });

  it('not_started when no progress yet', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 0,
        totalRequiredQty: 100,
        holdCount: 0,
        finishedCount: 0,
        delayedCount: 0,
        lineCount: 2,
        dueDate: '2099-12-31',
      }),
    ).toBe('not_started');
  });

  it('zero lines → not_started (defensive against empty SOs)', () => {
    expect(
      deriveOverallSoStatus({
        totalDoneQty: 0,
        totalRequiredQty: 0,
        holdCount: 0,
        finishedCount: 0,
        delayedCount: 0,
        lineCount: 0,
        dueDate: null,
      }),
    ).toBe('not_started');
  });
});
