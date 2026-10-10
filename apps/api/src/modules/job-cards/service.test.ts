// JC list service tests. Uses the existing migrated data on dev Supabase
// (T-029d): 2 surviving JCs (IN-JC-00002, IN-JC-00003), both with their
// source_so_line_id backfilled to SO-436 lines. Read-only — no test
// fixtures inserted; we just assert the service exposes the data correctly.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  machines,
  opLog,
  purchaseRequests,
  runningOps,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { DEFAULT_FINAL_QC_OP } from '../../lib/jc-default-qc';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

describe('job-cards service', () => {
  it('listJobCards returns headers + computed status + source link for migrated JCs', async () => {
    const result = await service.listJobCards({ limit: 50, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = result.items.find((j) => j.code === 'IN-JC-00002');
    const jc03 = result.items.find((j) => j.code === 'IN-JC-00003');
    expect(jc02).toBeDefined();
    expect(jc03).toBeDefined();

    // v_jc_status enrichment present
    expect(typeof jc02!.computedStatus).toBe('string');
    expect(jc02!.totalOps).toBeGreaterThanOrEqual(0);
    expect(jc02!.doneOps).toBeGreaterThanOrEqual(0);

    // SO source link backfilled in T-029d (legacy soRefId -> SO-436 lines)
    expect(jc02!.sourceLink).not.toBeNull();
    expect(jc02!.sourceLink?.type).toBe('so');
    if (jc02!.sourceLink?.type === 'so') {
      expect(jc02!.sourceLink.code).toBe('SO-436');
      expect(jc02!.sourceLink.lineNo).toBe(6);
      expect(jc02!.sourceLink.partName).toBe('JOINT');
    }

    expect(jc03!.sourceLink?.type).toBe('so');
    if (jc03!.sourceLink?.type === 'so') {
      expect(jc03!.sourceLink.code).toBe('SO-436');
      expect(jc03!.sourceLink.lineNo).toBe(4);
      expect(jc03!.sourceLink.partName).toBe('SPACER');
    }

    // Item info joined
    expect(jc02!.itemCode).not.toBe('');
    expect(jc02!.itemName).not.toBe('');
  });

  it('listJobCards filters by status — scoped to migrated IN-JC-0000* JCs', async () => {
    // Use the migrated JCs (IN-JC-00002, IN-JC-00003) as a stable
    // population — other test files create + tear down JCs which would
    // race against an unscoped query.
    const all = await service.listJobCards({ search: 'IN-JC-0000', limit: 200, offset: 0 }, admin);
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = all.items.find((j) => j.code === 'IN-JC-00002');
    expect(jc02).toBeDefined();
    const status = jc02!.computedStatus;
    const filtered = await service.listJobCards(
      { search: 'IN-JC-0000', status, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((j) => j.computedStatus === status)).toBe(true);
  });

  it('listJobCards search matches against jc code, item code, and SO source code', async () => {
    const bySoCode = await service.listJobCards({ search: 'SO-436', limit: 50, offset: 0 }, admin);
    // Both surviving JCs are linked to SO-436
    expect(bySoCode.items.length).toBeGreaterThanOrEqual(2);
    expect(
      bySoCode.items.every((j) => j.sourceLink?.type === 'so' && j.sourceLink.code === 'SO-436'),
    ).toBe(true);

    const byJcCode = await service.listJobCards(
      { search: 'IN-JC-00002', limit: 50, offset: 0 },
      admin,
    );
    expect(byJcCode.items.length).toBe(1);
    expect(byJcCode.items[0]?.code).toBe('IN-JC-00002');
  });

  it('listJobCards date range filter inclusive', async () => {
    const all = await service.listJobCards({ limit: 200, offset: 0 }, admin);
    if (all.items.length === 0) return;
    const firstDate = all.items[0]!.jcDate;
    const filtered = await service.listJobCards(
      { fromDate: firstDate, toDate: firstDate, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.every((j) => j.jcDate === firstDate)).toBe(true);
  });

  it('getJobCard returns the single row by id', async () => {
    const list = await service.listJobCards({ limit: 1, offset: 0 }, admin);
    if (list.items.length === 0) return; // nothing seeded
    const target = list.items[0]!;
    const fetched = await service.getJobCard(target.id, admin);
    expect(fetched.id).toBe(target.id);
    expect(fetched.code).toBe(target.code);
    expect(fetched.computedStatus).toBe(target.computedStatus);
  });

  it('getJobCard throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobCard('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.listJobCards({ limit: 10, offset: 0 }, noCompanyUser),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('getJobCardEditModel resolves the linked source line as an option (ISSUE-170)', async () => {
    // IN-JC-00002 is backfilled to SO-436 line 6. The linked line must resolve
    // regardless of the SO's open/closed status (source-options lists only open).
    const list = await service.listJobCards({ search: 'IN-JC-00002', limit: 1, offset: 0 }, admin);
    const target = list.items[0];
    if (!target) return; // migrated seed absent on this DB
    const model = await service.getJobCardEditModel(target.id, admin);
    if (target.sourceLink) {
      expect(model.linkedSourceOption).not.toBeNull();
      expect(model.linkedSourceOption?.lineId).toBe(target.sourceLink.type === 'so'
        ? target.sourceLink.salesOrderLineId
        : target.sourceLink.jobWorkOrderLineId);
      expect(model.linkedSourceOption?.code).toBe(target.sourceLink.code);
      expect(model.linkedSourceOption?.remaining).toBeGreaterThanOrEqual(0);
    } else {
      expect(model.linkedSourceOption).toBeNull();
    }
  });

  it('getJobCardStatusExtras returns qcDocs, opExtras, and a real completion-log total', async () => {
    const list = await service.listJobCards({ search: 'IN-JC-0000', limit: 1, offset: 0 }, admin);
    const target = list.items[0];
    if (!target) return; // migrated seed absent on this DB
    const extras = await service.getJobCardStatusExtras(target.id, admin);
    expect(Array.isArray(extras.qcDocs)).toBe(true);
    expect(Array.isArray(extras.opExtras)).toBe(true);
    expect(Array.isArray(extras.completionLog.events)).toBe(true);
    expect(typeof extras.completionLog.total).toBe('number');
    expect(extras.completionLog.total).toBeGreaterThanOrEqual(0);
    expect(typeof extras.completionLog.truncated).toBe('boolean');
    // The exact total must be >= the number of events actually shipped.
    expect(extras.completionLog.total).toBeGreaterThanOrEqual(extras.completionLog.events.length);
    // Feed is latest-first (server-sorted by sortKey desc).
    const keys = extras.completionLog.events.map((e) => e.sortKey);
    const sorted = [...keys].sort((a, b) => b.localeCompare(a));
    expect(keys).toEqual(sorted);
  });

  it('getJobCardStatusExtras throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobCardStatusExtras('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('job-cards service — writes (ADR-051)', () => {
  const createdIds: string[] = [];
  // PRs inserted by the ADR-101 lock-guard tests; hard-cleaned in afterAll.
  const createdPrIds: string[] = [];
  let itemCode: string | null = null;
  let itemId: string | null = null;
  let machineCode: string | null = null;
  // Manual JC creation is now JW-only (governance), so the write tests need a
  // Job Work line to attach to. Created + torn down here (prefix TJC-).
  let jwOrderId: string | null = null;
  let jwLineId: string | null = null;

  beforeAll(async () => {
    const it = (
      await db
        .select({ id: items.id, code: items.code })
        .from(items)
        .where(and(eq(items.companyId, admin.companyId!), isNull(items.deletedAt)))
        .limit(1)
    )[0];
    itemCode = it?.code ?? null;
    itemId = it?.id ?? null;
    const m = (
      await db
        .select({ code: machines.code })
        .from(machines)
        .where(and(eq(machines.companyId, admin.companyId!), isNull(machines.deletedAt)))
        .limit(1)
    )[0];
    machineCode = m?.code ?? null;

    if (it) {
      const jw = (
        await db
          .insert(jobWorkOrders)
          .values({
            companyId: admin.companyId!,
            code: 'TJC-JW-001',
            jwDate: '2026-06-13',
            customerName: 'JC write-test JW',
            status: 'open',
            createdBy: admin.id,
            updatedBy: admin.id,
          })
          .returning()
      )[0]!;
      jwOrderId = jw.id;
      const line = (
        await db
          .insert(jobWorkOrderLines)
          .values({
            companyId: admin.companyId!,
            jobWorkOrderId: jw.id,
            lineNo: 1,
            itemId: it.id,
            partName: 'JC write-test JW line',
            uom: 'NOS',
            orderQty: 100,
            status: 'open',
            createdBy: admin.id,
            updatedBy: admin.id,
          })
          .returning()
      )[0]!;
      jwLineId = line.id;
    }
  });

  afterAll(async () => {
    // Hard-cleanup the test JCs (none have op_log) so we don't leave
    // soft-deleted rows polluting the IN-JC series on the dev DB.
    if (createdIds.length > 0) {
      const opIds = (
        await db.select({ id: jcOps.id }).from(jcOps).where(inArray(jcOps.jobCardId, createdIds))
      ).map((o) => o.id);
      if (opIds.length > 0) await db.delete(opLog).where(inArray(opLog.jcOpId, opIds));
      await db.delete(jcOps).where(inArray(jcOps.jobCardId, createdIds));
      await db.delete(jobCards).where(inArray(jobCards.id, createdIds));
    }
    if (createdPrIds.length > 0) {
      await db.delete(purchaseRequests).where(inArray(purchaseRequests.id, createdPrIds));
    }
    if (jwOrderId) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwOrderId));
      await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwOrderId));
    }
  });

  it('createJobCard creates a JC with IN-JC series code + ops', async () => {
    if (!itemCode || !machineCode || !jwLineId) return; // no master data on this DB
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 5,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [
          {
            operation: 'CNC Turning',
            opType: 'process',
            machineCode,
            cycleTimeMin: 1.5,
            qcRequired: false,
            outsourceCost: 0,
          },
          { operation: 'Final Inspection', opType: 'qc', cycleTimeMin: 0, qcRequired: true, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    expect(jc.code).toMatch(/^IN-JC-\d{2}-\d{5}$/);
    expect(jc.itemCode).toBe(itemCode);
    expect(jc.orderQty).toBe(5);
    expect(jc.totalOps).toBe(2);
  });

  it('updateJobCard changes header + replaces ops (renumbered)', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 5,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [
          { operation: 'Op A', opType: 'process', machineCode, cycleTimeMin: 1, qcRequired: false, outsourceCost: 0 },
          { operation: 'Op B', opType: 'process', machineCode, cycleTimeMin: 2, qcRequired: false, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    // Rule B (ADR-069) already appended the Final Inspection on create; the
    // edit resubmits it LAST with its stored id, exactly as the form does.
    const fi = await finalQcOpOf(jc.id);
    const updated = await service.updateJobCard(
      jc.id,
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 9,
        priority: 'high',
        ops: [
          { operation: 'Op A only', opType: 'process', machineCode, cycleTimeMin: 3, qcRequired: false, outsourceCost: 0 },
          fi,
        ],
        qcDocs: [],
      },
      admin,
    );
    expect(updated.orderQty).toBe(9);
    expect(updated.priority).toBe('high');
    // Op A and Op B are gone, replaced by the one new op, and the Final
    // Inspection still closes the routing — 2 ops.
    expect(updated.totalOps).toBe(2);
    const after = await opsOf(jc.id);
    expect(after.map((o) => o.operation)).toEqual(['Op A only', DEFAULT_FINAL_QC_OP]);
    // ADR-227 — the SAME row, renumbered from 3 to 2. A new id here would mean
    // the writer had quietly deleted and re-created the system's own op.
    expect(after[1]!.id).toBe(fi.id);
    expect(after[1]!.opSeq).toBe(2);
  });

  // Helper: current (non-deleted) ops of a JC, ordered by op_seq.
  async function opsOf(jcId: string) {
    return db
      .select({ id: jcOps.id, opSeq: jcOps.opSeq, operation: jcOps.operation, opType: jcOps.opType })
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, jcId), isNull(jcOps.deletedAt)))
      .orderBy(jcOps.opSeq);
  }

  // ===================================================================
  // WRITING A updateJobCard FIXTURE? READ THIS FIRST (ADR-227).
  //
  // A Job Card whose routing ends on a machining step gets a terminal
  // "Final Inspection" QC op appended by the SYSTEM (ADR-069 Rule B, see
  // withTerminalQcOp). That row is part of the routing from then on, and an
  // update payload MUST send it back, LAST, carrying its STORED id — which is
  // exactly what the edit form does: it pins that row (name read-only, cannot
  // be deleted, cannot be moved) and posts it with the rest.
  //
  // Leave it out and the save is REFUSED — "Final Inspection is added by the
  // system and cannot be removed here." — because omitting it is
  // indistinguishable from a person deleting the row by hand, and the writer
  // used to silently undo that by re-appending a NEW row with a NEW id, which
  // broke every ADR-227 protection on the card from then on.
  //
  // So: `finalQcOpOf(jc.id)` and put the result last in `ops`. Omitting it does
  // not just fail the test you are writing — it makes a test that asserts only
  // `rejects.toBeInstanceOf(ValidationError)` pass on the WRONG refusal, which
  // is why the refusals below are asserted by MESSAGE as well as by type.
  //
  // NOT YET EXECUTED (2026-10-09). The updateJobCard fixtures in this file were
  // corrected for the rule above by TRACING the writer's guards in order — the
  // ADR-227 check, validateOps, machine/vendor code resolution, the
  // started/committed lock loop, then the closed-JC freeze — and have not been
  // run since, because this suite is database-backed and was not runnable here.
  // Reviewed is not passed: the next authorised run of this suite is their first
  // real test. Treat a failure in one of them as a fixture bug first.
  // ===================================================================

  /** The generated terminal Final Inspection op of `jcId`, shaped the way the
   *  edit form posts it back: its STORED id, its system-owned name, type qc.
   *  Throws when the card has no such op, so a fixture can never quietly stop
   *  exercising the guard it was written for. */
  async function finalQcOpOf(jcId: string) {
    const all = await opsOf(jcId);
    const last = all[all.length - 1];
    if (!last || last.opType !== 'qc' || last.operation !== DEFAULT_FINAL_QC_OP) {
      throw new Error(
        `Fixture expects ${jcId} to end with the system's ${DEFAULT_FINAL_QC_OP} op, found: ` +
          all.map((o) => `${o.operation} (${o.opType})`).join(' → '),
      );
    }
    return {
      id: last.id,
      operation: last.operation,
      opType: 'qc' as const,
      cycleTimeMin: 0,
      qcRequired: true,
      outsourceCost: 0,
    };
  }

  /** The error a write threw, so a test can assert BOTH its type AND its
   *  wording. A type-only assertion silently accepts any OTHER refusal — that
   *  is how three fixtures here kept passing while the guard they were written
   *  to prove was never reached. */
  async function refusal(p: Promise<unknown>): Promise<Error> {
    const e = await p.then(
      () => null,
      (err: unknown) => err as Error,
    );
    if (e === null) throw new Error('Expected this write to be refused, but it succeeded.');
    return e;
  }

  const proc = (operation: string, machine: string) => ({
    operation,
    opType: 'process' as const,
    machineCode: machine,
    cycleTimeMin: 1,
    qcRequired: false,
    outsourceCost: 0,
  });

  it('updateJobCard blocks re-sequencing an op that has logged work', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', sourceJwLineId: jwLineId, ops: [proc('Op A', machineCode), proc('Op B', machineCode)], qcDocs: [] },
      admin,
    );
    createdIds.push(jc.id);
    const ops = await opsOf(jc.id);
    const opA = ops.find((o) => o.operation === 'Op A')!;
    const opB = ops.find((o) => o.operation === 'Op B')!;
    // Log work on Op A → it becomes "started".
    await db.insert(opLog).values({
      companyId: admin.companyId!,
      jcOpId: opA.id,
      logNo: 'L1',
      logType: 'complete',
      logDate: '2026-06-13',
      shift: 'day',
      qty: 1,
      createdBy: admin.id,
    });
    // Swap Op A (started) below Op B → re-sequence of a started op → blocked.
    // The Final Inspection stays last, so the ADR-227 refusals cannot fire and
    // the error below can only be the re-sequence guard.
    const fi = await finalQcOpOf(jc.id);
    const e = await refusal(
      service.updateJobCard(
        jc.id,
        {
          jcDate: '2026-06-13',
          itemCode,
          orderQty: 5,
          priority: 'normal',
          ops: [
            { id: opB.id, ...proc('Op B', machineCode) },
            { id: opA.id, ...proc('Op A', machineCode) },
            fi,
          ],
          qcDocs: [],
        },
        admin,
      ),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/^Cannot move Op .+ it already has logged work\.$/);
  });

  /** Stamp an existing op as a committed OSP op backed by a real PR row, the
   *  shape plan-execute / JC-edit actually produce. `prStatus` drives whether
   *  that PR is live ('open') or dead ('cancelled') — the ADR-101 distinction. */
  async function stampOspPr(
    opId: string,
    prStatus: 'open' | 'cancelled',
  ): Promise<string> {
    const pr = (
      await db
        .insert(purchaseRequests)
        .values({
          companyId: admin.companyId!,
          code: `TJC-PR-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          prDate: '2026-06-13',
          status: prStatus,
          prType: 'jw_osp',
          vendorCodeText: '(vendor TBD)',
          itemId: itemId!,
          itemCodeText: itemCode!,
          qty: 5,
          sourceJcOpId: opId,
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning({ id: purchaseRequests.id })
    )[0]!;
    createdPrIds.push(pr.id);
    await db
      .update(jcOps)
      .set({ opType: 'outsource', outsourceStatus: 'pr_raised', outsourcePrId: pr.id })
      .where(eq(jcOps.id, opId));
    return pr.id;
  }

  it('updateJobCard blocks removing an outsource op that already has a PR/PO', async () => {
    if (!itemCode || !itemId || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', sourceJwLineId: jwLineId, ops: [proc('Op A', machineCode), proc('Op B', machineCode)], qcDocs: [] },
      admin,
    );
    createdIds.push(jc.id);
    const ops = await opsOf(jc.id);
    const opA = ops.find((o) => o.operation === 'Op A')!;
    const opB = ops.find((o) => o.operation === 'Op B')!;
    // OSP commitment on Op A, backed by a LIVE PR, and no op_log.
    await stampOspPr(opA.id, 'open');
    // Drop Op A from the payload → remove of a committed op → blocked. The
    // Final Inspection is still sent (last, with its id), so this can only be
    // the committed-op guard and not an ADR-227 refusal.
    const fi = await finalQcOpOf(jc.id);
    const e = await refusal(
      service.updateJobCard(
        jc.id,
        { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', ops: [{ id: opB.id, ...proc('Op B', machineCode) }, fi], qcDocs: [] },
        admin,
      ),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/^Cannot remove Op .+ its PR \/ PO exists\. Cancel it first\.$/);
  });

  // ADR-101 — the bug this fixes: cancelling the PR left the op frozen, so the
  // error ("cancel the PR/PO first") could never be satisfied.
  it('updateJobCard allows retyping an outsource op to in-house once its PR is cancelled', async () => {
    if (!itemCode || !itemId || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', sourceJwLineId: jwLineId, ops: [proc('Op A', machineCode), proc('Op B', machineCode)], qcDocs: [] },
      admin,
    );
    createdIds.push(jc.id);
    const ops = await opsOf(jc.id);
    const opA = ops.find((o) => o.operation === 'Op A')!;
    const opB = ops.find((o) => o.operation === 'Op B')!;
    // Op A is outsource with a CANCELLED PR — the stale stamp is still on the
    // row (pre-fix rows look exactly like this), but it commits nothing.
    await stampOspPr(opA.id, 'cancelled');

    const fi = await finalQcOpOf(jc.id);
    await service.updateJobCard(
      jc.id,
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 5,
        priority: 'normal',
        ops: [{ id: opA.id, ...proc('Op A', machineCode) }, { id: opB.id, ...proc('Op B', machineCode) }, fi],
        qcDocs: [],
      },
      admin,
    );

    const after = await opsOf(jc.id);
    expect(after.find((o) => o.operation === 'Op A')!.opType).toBe('process');
    // The system's own op is untouched by the retype — same row, still last.
    expect(after[after.length - 1]!.id).toBe(fi.id);
  });

  it('updateJobCard freezes operations once the JC is closed', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const jc = await service.createJobCard(
      { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', sourceJwLineId: jwLineId, ops: [proc('Op A', machineCode)], qcDocs: [] },
      admin,
    );
    createdIds.push(jc.id);
    const ops = await opsOf(jc.id);
    const opA = ops.find((o) => o.operation === 'Op A')!;
    const fi = await finalQcOpOf(jc.id);
    // Mark the JC closed.
    await db.update(jobCards).set({ closedAt: new Date() }).where(eq(jobCards.id, jc.id));
    // Any structural change (here: add an op) is frozen. The new op goes in
    // BEFORE the Final Inspection, which is resubmitted last with its id — so
    // the error can only be the freeze guard.
    const e = await refusal(
      service.updateJobCard(
        jc.id,
        {
          jcDate: '2026-06-13',
          itemCode,
          orderQty: 5,
          priority: 'normal',
          ops: [{ id: opA.id, ...proc('Op A', machineCode) }, proc('Op C', machineCode), fi],
          qcDocs: [],
        },
        admin,
      ),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toBe(
      'This JC is Completed, so its operations cannot change. Reopen it first.',
    );
  });

  // ===================================================================
  // CHANGING AN OP'S MACHINE — what the rule actually is (ADR-125 / ADR-084).
  //
  // Migration 0095 made every op_log row permanently carry the machine that
  // produced ITS qty. From then on `jc_ops.machine_id` no longer owns the
  // history — it only says which machine runs the REMAINING qty (50 pcs made on
  // CNC-01, the balance on CNC-02, and both facts survive). So moving a started
  // op to another machine is SAFE and is deliberately ALLOWED.
  //
  // The one case still refused is an OPEN session (ADR-084): a `running_ops` row
  // with status 'running' and is_osp false. Its pieces reach op_log — with their
  // machine stamped — only when the session is STOPPED, so until then the
  // machine must not move out from under it.
  //
  // The two tests below are identical apart from that `running_ops` row. They
  // replace one earlier test that asserted the rule 0095 REMOVED ("blocks
  // changing the machine of an op that has logged work"), which could not fire
  // and had been silently failing.
  // ===================================================================

  /** A second real machine code to move an op to. `resolveCodeMap` validates
   *  the code exists before the guards run, so a made-up one would throw the
   *  wrong error. Null when this database has only one machine. */
  async function otherMachineCode(): Promise<string | null> {
    const machs = await db
      .select({ code: machines.code })
      .from(machines)
      .where(and(eq(machines.companyId, admin.companyId!), isNull(machines.deletedAt)))
      .limit(5);
    return machs.map((m) => m.code).find((c) => c !== machineCode) ?? null;
  }

  /** A JC with one started process op ('Op A', one op_log row) plus the
   *  system's Final Inspection. Returns the op and that Final Inspection. */
  async function jcWithStartedOpA(logNo: string) {
    const jc = await service.createJobCard(
      { jcDate: '2026-06-13', itemCode: itemCode!, orderQty: 5, priority: 'normal', sourceJwLineId: jwLineId!, ops: [proc('Op A', machineCode!)], qcDocs: [] },
      admin,
    );
    createdIds.push(jc.id);
    const ops = await opsOf(jc.id);
    const opA = ops.find((o) => o.operation === 'Op A')!;
    // One completed log → the op counts as "started" (startedOpIds reads op_log).
    await db.insert(opLog).values({
      companyId: admin.companyId!,
      jcOpId: opA.id,
      logNo,
      logType: 'complete',
      logDate: '2026-06-13',
      shift: 'day',
      qty: 1,
      createdBy: admin.id,
    });
    return { jcId: jc.id, opA, fi: await finalQcOpOf(jc.id) };
  }

  /** The machine code stored on an op right now. */
  async function machineCodeOf(opId: string): Promise<string | null> {
    const rows = await db
      .select({ machineCodeText: jcOps.machineCodeText })
      .from(jcOps)
      .where(eq(jcOps.id, opId))
      .limit(1);
    return rows[0]?.machineCodeText ?? null;
  }

  it('updateJobCard ALLOWS changing the machine of a started op with no open session (ADR-125)', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const machine2 = await otherMachineCode();
    if (!machine2) return; // only one machine on this DB — nothing to move to
    const { jcId, opA, fi } = await jcWithStartedOpA('L1');
    // Op A has logged work but NO running_ops row → the move is allowed,
    // because the pieces already made keep their own machine in op_log.
    await service.updateJobCard(
      jcId,
      { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', ops: [{ id: opA.id, ...proc('Op A', machine2) }, fi], qcDocs: [] },
      admin,
    );
    // It really moved — and it is still the same op row, not a replacement.
    expect(await machineCodeOf(opA.id)).toBe(machine2);
    const after = await opsOf(jcId);
    expect(after.map((o) => o.id)).toEqual([opA.id, fi.id]);
  });

  it('updateJobCard REFUSES changing the machine of an op with an OPEN session (ADR-084)', async () => {
    if (!itemCode || !machineCode || !jwLineId) return;
    const machine2 = await otherMachineCode();
    if (!machine2) return;
    const { jcId, opA, fi } = await jcWithStartedOpA('L2');
    // The one state that still blocks a machine change: an OPEN in-house
    // session. machine_id is left null on purpose — the guard reads only
    // (jc_op_id, status, is_osp), and a null keeps this row clear of the
    // `running_ops_machine_running_uniq` index, so it cannot collide with a
    // genuinely running session on either machine. Cleaned up with the JC:
    // running_ops.jc_op_id cascades when afterAll deletes jc_ops.
    await db.insert(runningOps).values({
      companyId: admin.companyId!,
      jcOpId: opA.id,
      isOsp: false,
      startDate: '2026-06-13',
      startTime: '08:00:00',
      shift: 'day',
      status: 'running',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    const e = await refusal(
      service.updateJobCard(
        jcId,
        { jcDate: '2026-06-13', itemCode, orderQty: 5, priority: 'normal', ops: [{ id: opA.id, ...proc('Op A', machine2) }, fi], qcDocs: [] },
        admin,
      ),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toBe('Stop Operation first, then change the machine.');
    // And nothing moved.
    expect(await machineCodeOf(opA.id)).toBe(machineCode);
  });

  it('updateJobCard keeps the JC source immutable — a different or omitted source is ignored', async () => {
    if (!itemCode || !machineCode || !jwLineId || !jwOrderId) return;
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 3,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [
          { operation: 'Op A', opType: 'process', machineCode, cycleTimeMin: 1, qcRequired: false, outsourceCost: 0 },
        ],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    // Sanity: the new JC is linked to our JW line.
    expect(jc.sourceLink?.type).toBe('jw');
    if (jc.sourceLink?.type === 'jw') expect(jc.sourceLink.jobWorkOrderLineId).toBe(jwLineId);

    // A second JW line on the same order — a plausible "re-link" target. Cleaned
    // up by afterAll (deletes all lines for jwOrderId).
    const itemRow = (
      await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.code, itemCode), eq(items.companyId, admin.companyId!), isNull(items.deletedAt)))
        .limit(1)
    )[0]!;
    const otherLine = (
      await db
        .insert(jobWorkOrderLines)
        .values({
          companyId: admin.companyId!,
          jobWorkOrderId: jwOrderId,
          lineNo: 2,
          itemId: itemRow.id,
          partName: 'JC write-test JW line 2',
          uom: 'NOS',
          orderQty: 100,
          status: 'open',
          createdBy: admin.id,
          updatedBy: admin.id,
        })
        .returning()
    )[0]!;

    // The system's own Final Inspection, resubmitted last in BOTH edits below
    // with its stored id — the form never leaves it out, and the writer refuses
    // a payload that does (ADR-227). Its id survives both saves, so one read is
    // enough.
    const fi = await finalQcOpOf(jc.id);

    // 1) Edit that re-points at a DIFFERENT JW line — header edits apply, but the
    //    source must NOT move off the original line.
    const relinked = await service.updateJobCard(
      jc.id,
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 4,
        priority: 'high',
        sourceJwLineId: otherLine.id,
        ops: [
          { operation: 'Op A', opType: 'process', machineCode, cycleTimeMin: 1, qcRequired: false, outsourceCost: 0 },
          fi,
        ],
        qcDocs: [],
      },
      admin,
    );
    expect(relinked.orderQty).toBe(4);
    expect(relinked.sourceLink?.type).toBe('jw');
    if (relinked.sourceLink?.type === 'jw') expect(relinked.sourceLink.jobWorkOrderLineId).toBe(jwLineId);

    // 2) Edit that OMITS the source entirely — the link must NOT be nulled.
    const omitted = await service.updateJobCard(
      jc.id,
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 2,
        priority: 'normal',
        ops: [
          { operation: 'Op A', opType: 'process', machineCode, cycleTimeMin: 1, qcRequired: false, outsourceCost: 0 },
          fi,
        ],
        qcDocs: [],
      },
      admin,
    );
    expect(omitted.sourceLink).not.toBeNull();
    expect(omitted.sourceLink?.type).toBe('jw');
    if (omitted.sourceLink?.type === 'jw') expect(omitted.sourceLink.jobWorkOrderLineId).toBe(jwLineId);
  });

  it('createJobCard rejects a direct (non-JW) Job Card (governance)', async () => {
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: itemCode ?? 'X',
          orderQty: 1,
          priority: 'normal',
          // no sourceJwLineId → direct JC, must be rejected
          ops: [],
          qcDocs: [],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('createJobCard rejects an unknown item (with a valid JW source)', async () => {
    if (!jwLineId) return;
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: 'NOPE-NOT-AN-ITEM-ZZZ',
          orderQty: 1,
          priority: 'normal',
          sourceJwLineId: jwLineId,
          ops: [],
          qcDocs: [],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('createJobCard is write-role gated (viewer rejected)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createJobCard(
        {
          jcDate: '2026-06-13',
          itemCode: itemCode ?? 'X',
          orderQty: 1,
          priority: 'normal',
          ops: [],
          qcDocs: [],
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('deleteJobCard soft-deletes (admin) then the JC 404s', async () => {
    if (!itemCode || !jwLineId) return;
    const jc = await service.createJobCard(
      {
        jcDate: '2026-06-13',
        itemCode,
        orderQty: 2,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        ops: [],
        qcDocs: [],
      },
      admin,
    );
    createdIds.push(jc.id);
    await service.deleteJobCard(jc.id, admin);
    await expect(service.getJobCard(jc.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
