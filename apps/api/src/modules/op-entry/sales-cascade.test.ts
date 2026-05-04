// T-033 cascade tests. Kept in a separate file from op-entry/service.test.ts
// because the fixtures are larger (SO header + lines + JC + ops, plus
// optional cancelled-sibling setup) and the test JC churn doesn't pollute
// the existing fixture-shared tests.

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  opLog,
  runningOps,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { withUserContext } from '../../db/with-user-context';
import { tryCascadeJcComplete } from './sales-cascade';
import * as service from './service';

const TEST_PREFIX = 'T033-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let testItemId: string;

async function setupSharedFixture(): Promise<void> {
  // One reusable test item. teardownAll() ran just before this so the row
  // can't pre-exist; a plain INSERT is enough (no conflict target needed —
  // items has a partial unique index that Drizzle's onConflict can't target).
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM`,
      name: 'Cascade test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testItemId = itemRows[0]!.id;
}

async function teardownAll(): Promise<void> {
  // Find every test JC + jc_ops to clean dependent op_log / running_ops first.
  const testJcs = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(like(jobCards.code, `${TEST_PREFIX}%`));
  for (const jc of testJcs) {
    const ops = await db.select({ id: jcOps.id }).from(jcOps).where(eq(jcOps.jobCardId, jc.id));
    for (const o of ops) {
      await db.delete(opLog).where(eq(opLog.jcOpId, o.id));
      await db.delete(runningOps).where(eq(runningOps.jcOpId, o.id));
    }
    await db.delete(jcOps).where(eq(jcOps.jobCardId, jc.id));
  }
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));

  // Now SO + JW (lines first via FK).
  const testSos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${TEST_PREFIX}%`));
  for (const so of testSos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));

  const testJws = await db
    .select({ id: jobWorkOrders.id })
    .from(jobWorkOrders)
    .where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  for (const jw of testJws) {
    await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jw.id));
  }
  await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));

  // Test item last.
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardownAll();
  await setupSharedFixture();
});

afterAll(async () => {
  await teardownAll();
});

// ─── Per-test fixture helpers ───────────────────────────────────────────────

interface CascadeFixture {
  soId: string;
  soLineIds: string[]; // length === lineCount
  jcIds: string[]; // one per line, indexed in same order
  jcOpIds: string[]; // one op per JC
}

async function makeSoCascadeFixture(opts: {
  soCode: string;
  jcCodePrefix: string;
  lineCount: number;
  opsPerJc?: number; // default 1
  qtyPerOp?: number; // default 5
}): Promise<CascadeFixture> {
  const { soCode, jcCodePrefix, lineCount } = opts;
  const opsPerJc = opts.opsPerJc ?? 1;
  const qtyPerOp = opts.qtyPerOp ?? 5;

  const so = (
    await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: soCode,
        soDate: '2026-05-02',
        customerName: 'Cascade Test Co',
        type: 'component_manufacturing',
        status: 'open',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!;

  const soLineIds: string[] = [];
  const jcIds: string[] = [];
  const jcOpIds: string[] = [];

  for (let i = 0; i < lineCount; i++) {
    const line = (
      await db
        .insert(salesOrderLines)
        .values({
          companyId: admin.companyId!,
          salesOrderId: so.id,
          lineNo: i + 1,
          itemId: testItemId,
          partName: `Line ${i + 1}`,
          uom: 'NOS',
          orderQty: qtyPerOp,
          rate: '0.00',
          status: 'open',
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;
    soLineIds.push(line.id);

    const jc = (
      await db
        .insert(jobCards)
        .values({
          companyId: admin.companyId!,
          code: `${jcCodePrefix}-${i + 1}`,
          jcDate: '2026-05-02',
          itemId: testItemId,
          orderQty: qtyPerOp,
          priority: 'normal',
          sourceSoLineId: line.id,
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;
    jcIds.push(jc.id);

    // First op holds the jcOpId we expose; later ops are also created but
    // tracked only by the test driver below.
    let firstOpId: string | undefined;
    for (let k = 0; k < opsPerJc; k++) {
      const op = (
        await db
          .insert(jcOps)
          .values({
            companyId: admin.companyId!,
            jobCardId: jc.id,
            opSeq: k + 1,
            machineCodeText: 'CASCADE-M',
            operation: `op-${k + 1}`,
            opType: 'process',
            cycleTimeMin: '0.00',
            qcRequired: false,
            reworkQty: 0,
            outsourceCost: '0.00',
            outsourceSentQty: 0,
            outsourceReturnedQty: 0,
            createdBy: admin.id,
            updatedBy: admin.id,
          })
          .returning()
      )[0]!;
      if (k === 0) firstOpId = op.id;
    }
    jcOpIds.push(firstOpId!);
  }

  return { soId: so.id, soLineIds, jcIds, jcOpIds };
}

async function makeJwCascadeFixture(opts: { jwCode: string; jcCode: string }): Promise<{
  jwId: string;
  jwLineId: string;
  jcId: string;
  jcOpId: string;
}> {
  const jw = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId: admin.companyId!,
        code: opts.jwCode,
        jwDate: '2026-05-02',
        customerName: 'Cascade Test JW Co',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!;
  const line = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId: admin.companyId!,
        jobWorkOrderId: jw.id,
        lineNo: 1,
        itemId: testItemId,
        partName: 'JW Cascade Line',
        uom: 'NOS',
        orderQty: 5,
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!;
  const jc = (
    await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: opts.jcCode,
        jcDate: '2026-05-02',
        itemId: testItemId,
        orderQty: 5,
        priority: 'normal',
        sourceJwLineId: line.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!;
  const op = (
    await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: jc.id,
        opSeq: 1,
        machineCodeText: 'CASCADE-M',
        operation: 'op-1',
        opType: 'process',
        cycleTimeMin: '0.00',
        qcRequired: false,
        reworkQty: 0,
        outsourceCost: '0.00',
        outsourceSentQty: 0,
        outsourceReturnedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!;
  return { jwId: jw.id, jwLineId: line.id, jcId: jc.id, jcOpId: op.id };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('op-entry sales-cascade (T-033)', () => {
  it('SO single-line: completing the JC closes both the line and the header', async () => {
    const f = await makeSoCascadeFixture({
      soCode: `${TEST_PREFIX}SO-A`,
      jcCodePrefix: `${TEST_PREFIX}JC-A`,
      lineCount: 1,
    });

    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[0]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const line = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0];
    expect(line?.status).toBe('closed');

    const header = (
      await db
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, f.soId))
        .limit(1)
    )[0];
    expect(header?.status).toBe('closed');
  });

  it('SO multi-line: completing JC for line 1 closes that line but NOT the header', async () => {
    const f = await makeSoCascadeFixture({
      soCode: `${TEST_PREFIX}SO-B`,
      jcCodePrefix: `${TEST_PREFIX}JC-B`,
      lineCount: 2,
    });

    // Complete only JC #1.
    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[0]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const line1 = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0];
    const line2 = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[1]!))
        .limit(1)
    )[0];
    const header = (
      await db
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, f.soId))
        .limit(1)
    )[0];
    expect(line1?.status).toBe('closed');
    expect(line2?.status).toBe('open');
    expect(header?.status).toBe('open');

    // Now complete JC #2 → header should close.
    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[1]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const headerAfter = (
      await db
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, f.soId))
        .limit(1)
    )[0];
    expect(headerAfter?.status).toBe('closed');
  });

  it('partial completion: JC has 2 ops, completing only op 1 does NOT cascade', async () => {
    const f = await makeSoCascadeFixture({
      soCode: `${TEST_PREFIX}SO-C`,
      jcCodePrefix: `${TEST_PREFIX}JC-C`,
      lineCount: 1,
      opsPerJc: 2,
    });

    // Complete op 1 only — op 2 still has work to do.
    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[0]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const line = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0];
    const header = (
      await db
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, f.soId))
        .limit(1)
    )[0];
    expect(line?.status).toBe('open');
    expect(header?.status).toBe('open');
  });

  it('idempotent: calling tryCascadeJcComplete on an already-closed line is a no-op', async () => {
    const f = await makeSoCascadeFixture({
      soCode: `${TEST_PREFIX}SO-D`,
      jcCodePrefix: `${TEST_PREFIX}JC-D`,
      lineCount: 1,
    });

    // First call: close line + header via the normal submit path.
    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[0]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const lineUpdatedAt1 = (
      await db
        .select({ updatedAt: salesOrderLines.updatedAt })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0]?.updatedAt;
    expect(lineUpdatedAt1).toBeDefined();

    // Second call: directly invoke tryCascadeJcComplete — should bail with
    // skipped='so_line_already_terminal' and not bump updated_at.
    let result;
    await withUserContext(admin, async (tx) => {
      result = await tryCascadeJcComplete(tx, f.jcIds[0]!, admin);
    });
    expect(result).toEqual({ skipped: 'so_line_already_terminal' });

    const lineUpdatedAt2 = (
      await db
        .select({ updatedAt: salesOrderLines.updatedAt })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0]?.updatedAt;
    expect(lineUpdatedAt2?.getTime()).toBe(lineUpdatedAt1?.getTime());
  });

  it('cancelled sibling: line marked cancelled is NOT re-flipped, but counts as terminal for header close', async () => {
    const f = await makeSoCascadeFixture({
      soCode: `${TEST_PREFIX}SO-E`,
      jcCodePrefix: `${TEST_PREFIX}JC-E`,
      lineCount: 2,
    });

    // Mark line 2 cancelled before driving line 1 to complete.
    await db
      .update(salesOrderLines)
      .set({ status: 'cancelled', updatedBy: admin.id })
      .where(eq(salesOrderLines.id, f.soLineIds[1]!));

    await service.submitOpLog(
      {
        jcOpId: f.jcOpIds[0]!,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const line1 = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[0]!))
        .limit(1)
    )[0];
    const line2 = (
      await db
        .select({ status: salesOrderLines.status })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, f.soLineIds[1]!))
        .limit(1)
    )[0];
    const header = (
      await db
        .select({ status: salesOrders.status })
        .from(salesOrders)
        .where(eq(salesOrders.id, f.soId))
        .limit(1)
    )[0];
    expect(line1?.status).toBe('closed');
    expect(line2?.status).toBe('cancelled'); // unchanged
    // All siblings terminal (closed + cancelled) → header should close
    expect(header?.status).toBe('closed');
  });

  it('JW path: completing the JC closes its source JW line + header', async () => {
    const f = await makeJwCascadeFixture({
      jwCode: `${TEST_PREFIX}JW-A`,
      jcCode: `${TEST_PREFIX}JC-JW-A`,
    });

    await service.submitOpLog(
      {
        jcOpId: f.jcOpId,
        qty: 5,
        rejectQty: 0,
        logDate: '2026-05-02',
        shift: 'day',
        operatorName: 'Cascader',
      },
      admin,
    );

    const line = (
      await db
        .select({ status: jobWorkOrderLines.status })
        .from(jobWorkOrderLines)
        .where(eq(jobWorkOrderLines.id, f.jwLineId))
        .limit(1)
    )[0];
    const header = (
      await db
        .select({ status: jobWorkOrders.status })
        .from(jobWorkOrders)
        .where(eq(jobWorkOrders.id, f.jwId))
        .limit(1)
    )[0];
    expect(line?.status).toBe('closed');
    expect(header?.status).toBe('closed');
  });

  it('source-less JC: completing a JC with no source link does NOT cascade (no error)', async () => {
    // Insert a JC with neither source_so_line_id nor source_jw_line_id.
    const jc = (
      await db
        .insert(jobCards)
        .values({
          companyId: admin.companyId!,
          code: `${TEST_PREFIX}JC-NOSRC`,
          jcDate: '2026-05-02',
          itemId: testItemId,
          orderQty: 5,
          priority: 'normal',
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;
    const op = (
      await db
        .insert(jcOps)
        .values({
          companyId: admin.companyId!,
          jobCardId: jc.id,
          opSeq: 1,
          operation: 'op-1',
          opType: 'process',
          cycleTimeMin: '0.00',
          qcRequired: false,
          reworkQty: 0,
          outsourceCost: '0.00',
          outsourceSentQty: 0,
          outsourceReturnedQty: 0,
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;

    // No-op path — submit succeeds, cascade returns 'jc_has_no_source_link'.
    await expect(
      service.submitOpLog(
        {
          jcOpId: op.id,
          qty: 5,
          rejectQty: 0,
          logDate: '2026-05-02',
          shift: 'day',
          operatorName: 'Cascader',
        },
        admin,
      ),
    ).resolves.toBeDefined();
  });
});
