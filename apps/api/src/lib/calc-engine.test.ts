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

  it('qc op: input flows directly to qc; resolved when acc+rej >= inputAvail', () => {
    const ops = [op({ id: 'o1', opSeq: 1, opType: 'qc', qcRequired: true })];
    const logs = [log('o1', 'qc', 95, 5)];
    const enriched = enrichOps(jc({ orderQty: 100 }), ops, logs, new Set());
    expect(enriched[0]?.qcAccepted).toBe(95);
    expect(enriched[0]?.qcRejected).toBe(5);
    expect(enriched[0]?.qcPending).toBe(0);
    expect(enriched[0]?.status).toBe('complete');
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
