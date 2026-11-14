// ADR-289 — a Rev change on an IN-USE SO line goes through edit approval; the
// requester's revChangeReason rides in the staged line, so the approved replay
// moves the Rev and stores the reason on item_revision_changes.
// Runs on TEST only, on its own (no global setup): prefix TRA-.

import type { DocumentEditStagedResult, SalesOrderLineInput } from '@innovic/shared';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  documentEditRequests,
  itemRevisionChanges,
  itemRevisionDrawings,
  itemRevisions,
  items,
  jobCards,
  plans,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { decideDocumentEdit } from '../document-edits/service';
import { createSalesOrder, updateSalesOrderOrStage } from '../sales-orders/service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TRA-';

let admin: AuthContext;
let companyId: string;
let itemId: string;
let cfgId: string | null = null;
let origGate = false;

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((r) => r.id);
  if (ids.length === 0) return;
  const lines = await db
    .select({ id: salesOrderLines.id, soId: salesOrderLines.salesOrderId })
    .from(salesOrderLines)
    .where(inArray(salesOrderLines.itemId, ids));
  const soIds = [...new Set(lines.map((l) => l.soId))];
  const jcs = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(inArray(jobCards.itemId, ids));
  const jcIds = jcs.map((j) => j.id);
  const pls = await db.select({ id: plans.id }).from(plans).where(inArray(plans.itemId, ids));
  if (pls.length > 0) {
    await db.delete(activityLog).where(
      inArray(
        activityLog.entityId,
        pls.map((x) => x.id),
      ),
    );
    await db.delete(plans).where(
      inArray(
        plans.id,
        pls.map((x) => x.id),
      ),
    );
  }
  if (jcIds.length > 0) {
    await db.delete(activityLog).where(inArray(activityLog.entityId, jcIds));
    await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
  }
  if (lines.length > 0) {
    await db.delete(itemRevisionChanges).where(
      inArray(
        itemRevisionChanges.soLineId,
        lines.map((l) => l.id),
      ),
    );
  }
  if (soIds.length > 0) {
    await db.delete(documentEditRequests).where(inArray(documentEditRequests.entityId, soIds));
    await db.delete(activityLog).where(inArray(activityLog.entityId, soIds));
    await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
    await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
  }
  const revs = await db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .where(inArray(itemRevisions.itemId, ids));
  const revIds = revs.map((r) => r.id);
  if (revIds.length > 0) {
    await db.delete(activityLog).where(inArray(activityLog.entityId, revIds));
    await db
      .delete(itemRevisionDrawings)
      .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
    await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
  }
  await db.delete(items).where(inArray(items.id, ids));
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const cfg = await db
    .select()
    .from(approvalConfig)
    .where(eq(approvalConfig.companyId, companyId))
    .limit(1);
  if (cfg[0]) {
    cfgId = cfg[0].id;
    origGate = cfg[0].docEditApproval;
    await db
      .update(approvalConfig)
      .set({ docEditApproval: true })
      .where(eq(approvalConfig.id, cfg[0].id));
  } else {
    await db.insert(approvalConfig).values({
      companyId,
      docEditApproval: true,
      poApproval: false,
      prApproval: false,
      invoiceApproval: false,
      createdBy: admin.id,
      updatedBy: admin.id,
    });
  }
  const [it] = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}PART`,
      name: 'Rev approval test part',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId = it!.id;
}, 120_000);

afterAll(async () => {
  if (cfgId) {
    await db
      .update(approvalConfig)
      .set({ docEditApproval: origGate })
      .where(eq(approvalConfig.id, cfgId));
  } else {
    await db.delete(approvalConfig).where(eq(approvalConfig.companyId, companyId));
  }
  await cleanup();
}, 120_000);

describe('ADR-289 Rev change through edit approval', () => {
  it('stage a Rev change with a reason on an in-use line → approve → Rev moves, reason stored', async () => {
    const line = (id: string | undefined, rev: string, reason?: string): SalesOrderLineInput =>
      ({
        ...(id ? { id } : {}),
        partName: 'Rev part',
        clientPoLineNo: '10',
        revision: rev,
        itemId,
        uom: 'NOS',
        orderQty: 2,
        rate: 0,
        ...(reason ? { revChangeReason: reason } : {}),
      }) as SalesOrderLineInput;
    const so = await createSalesOrder(
      {
        header: {
          internalSoNo: `SO-${P}${Date.now()}`,
          soDate: '2026-11-14',
          customerName: 'Rev approval customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [line(undefined, '1')],
      } as never,
      admin,
    );
    const lineId = so.lines[0]!.id;
    const fromRev = (
      await db
        .select({ rev: salesOrderLines.itemRevisionId })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, lineId))
    )[0]!.rev;
    expect(fromRev).toBeTruthy();
    // A Plan (no PRO) on the line → the SO is IN USE (edits go for approval).
    // ADR-291 — an open Job Card / PRO would refuse the Rev change (ECR only);
    // a plan with no PRO still moves.
    const [jc] = await db
      .insert(plans)
      .values({
        companyId,
        code: `${P}PLN-${Date.now()}`,
        planDate: '2026-11-14',
        planType: 'manufacture',
        soLineId: lineId,
        itemId,
        orderQty: 2,
        planQty: 2,
        itemRevisionId: fromRev,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: plans.id });

    // ADR-290 — the line's open work moves to Rev 2, so Rev 2 must be released.
    await db.insert(itemRevisions).values({
      companyId,
      itemId,
      rev: '2',
      sourceType: 'so_line',
      sourceRef: `${P}test`,
      releaseStatus: 'released',
      createdBy: admin.id,
      updatedBy: admin.id,
    });

    const reason = 'Customer issued drawing Rev 2';
    const staged = (await updateSalesOrderOrStage(
      so.id,
      { header: {}, lines: [line(lineId, '2', reason)], expectedUpdatedAt: so.updatedAt },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);
    const box = staged.request.changes.find((c) => c.id === `line:${lineId}:codeRev`);
    expect(box).toBeTruthy();
    // Nothing moved while it waits.
    expect(
      (await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, lineId)))[0]!.revision,
    ).toBe('1');

    await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: box!.id, decision: 'approve' }] },
      admin,
    );

    const after = (
      await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, lineId))
    )[0]!;
    expect(after.revision).toBe('2');
    expect(after.itemRevisionId).not.toBe(fromRev);
    const changes = await db
      .select({
        reason: itemRevisionChanges.reason,
        to: itemRevisionChanges.toItemRevisionId,
      })
      .from(itemRevisionChanges)
      .where(eq(itemRevisionChanges.soLineId, lineId));
    expect(changes).toEqual([{ reason, to: after.itemRevisionId }]);
    const jcRow = (
      await db.select({ rev: plans.itemRevisionId }).from(plans).where(eq(plans.id, jc!.id))
    )[0]!;
    expect(jcRow.rev).toBe(after.itemRevisionId);
  }, 180_000);
});
