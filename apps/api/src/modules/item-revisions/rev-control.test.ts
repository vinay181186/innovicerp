// ADR-289 — Drawing Rev control, step 1. Positive asserts on TEST:
//   • A1: an Item Issue that took stock from several Rev buckets gives it back
//     to THOSE buckets — a partial Return last-taken-first, a Cancel exactly;
//   • A3: an OSP last-op GRN of a Job Card NOT built by a PRO credits the Job
//     Card's own Rev bucket;
//   • F: a Rev change on a line with a Job Card needs a reason; the reason is
//     stored on the change row and logged on the moved Job Card;
//   • G: a valid Replace drawing succeeds (file changed + history row), a
//     stale one is 409.
// Runs on TEST only, on its own (no global setup): prefix TRC-.

import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  itemRevisionChanges,
  itemRevisionDrawings,
  itemRevisions,
  itemRevStockBalances,
  itemStockBalances,
  items,
  jcOps,
  jobCards,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockOutParts,
  storeIssueLines,
  storeIssueReturns,
  storeIssues,
  storeTransactions,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AppError, ValidationError } from '../../lib/errors';
import { replaceItemRevisionDrawing, resolveItemRevision } from '../../lib/item-revision';
import { postStockMove } from '../../lib/stock-ledger';
import { creditGrnQcStock } from '../goods-receipt-notes/cascades';
import { cancelStoreIssueTx } from '../store-issues/cancel';
import { createStoreIssue, returnStoreIssue } from '../store-issues/service';
import { applyLineRevChange } from './line-rev';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TRC-';

let admin: AuthContext;
let companyId: string;
let itemId: string;
let rev1: string;
let rev2: string;

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((r) => r.id);
  if (ids.length > 0) {
    const lines = await db
      .select({ id: storeIssueLines.id, issueId: storeIssueLines.issueId })
      .from(storeIssueLines)
      .where(inArray(storeIssueLines.itemId, ids));
    const issueIds = [...new Set(lines.map((l) => l.issueId))];
    if (lines.length > 0) {
      await db.delete(stockOutParts).where(
        inArray(
          stockOutParts.storeIssueLineId,
          lines.map((l) => l.id),
        ),
      );
      await db.delete(storeIssueReturns).where(
        inArray(
          storeIssueReturns.issueLineId,
          lines.map((l) => l.id),
        ),
      );
    }
    if (issueIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.entityId, issueIds));
      await db.delete(storeIssueLines).where(inArray(storeIssueLines.issueId, issueIds));
      await db.delete(storeIssues).where(inArray(storeIssues.id, issueIds));
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('innovic.ledger_maintenance', 'on', true)`);
      await tx.delete(storeTransactions).where(inArray(storeTransactions.itemId, ids));
    });
    await db.delete(itemRevStockBalances).where(inArray(itemRevStockBalances.itemId, ids));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, ids));
    const grns = await db
      .select({ id: goodsReceiptNotes.id })
      .from(goodsReceiptNotes)
      .where(like(goodsReceiptNotes.code, `${P}%`));
    if (grns.length > 0) {
      await db.delete(goodsReceiptNoteLines).where(
        inArray(
          goodsReceiptNoteLines.goodsReceiptNoteId,
          grns.map((g) => g.id),
        ),
      );
      await db.delete(goodsReceiptNotes).where(
        inArray(
          goodsReceiptNotes.id,
          grns.map((g) => g.id),
        ),
      );
    }
    const jcs = await db
      .select({ id: jobCards.id })
      .from(jobCards)
      .where(like(jobCards.code, `${P}%`));
    if (jcs.length > 0) {
      const jcIds = jcs.map((j) => j.id);
      await db.delete(activityLog).where(inArray(activityLog.entityId, jcIds));
      await db.delete(jcOps).where(inArray(jcOps.jobCardId, jcIds));
      await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
    }
    const pos = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(like(purchaseOrders.code, `${P}%`));
    if (pos.length > 0) {
      await db.delete(purchaseOrderLines).where(
        inArray(
          purchaseOrderLines.purchaseOrderId,
          pos.map((p) => p.id),
        ),
      );
      await db.delete(purchaseOrders).where(
        inArray(
          purchaseOrders.id,
          pos.map((p) => p.id),
        ),
      );
    }
    const sos = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(like(salesOrders.code, `${P}%`));
    const revs = await db
      .select({ id: itemRevisions.id })
      .from(itemRevisions)
      .where(inArray(itemRevisions.itemId, ids));
    const revIds = revs.map((r) => r.id);
    if (revIds.length > 0) {
      await db
        .delete(itemRevisionChanges)
        .where(inArray(itemRevisionChanges.toItemRevisionId, revIds));
    }
    if (sos.length > 0) {
      const soIds = sos.map((s) => s.id);
      await db.delete(activityLog).where(inArray(activityLog.entityId, soIds));
      await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
      await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
    }
    if (revIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.entityId, revIds));
      await db
        .delete(itemRevisionDrawings)
        .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
      await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
    }
    await db.delete(items).where(inArray(items.id, ids));
  }
}

/** On hand per bucket ('' = blank). */
async function buckets(): Promise<Record<string, number>> {
  const bs = await db
    .select({ rev: itemRevStockBalances.itemRevisionId, q: itemRevStockBalances.onHandQty })
    .from(itemRevStockBalances)
    .where(eq(itemRevStockBalances.itemId, itemId));
  return Object.fromEntries(bs.map((b) => [b.rev ?? '', Number(b.q)]));
}

const seed = (qty: number, rev: string | null) =>
  withUserContext(admin, (tx) =>
    postStockMove(tx, {
      companyId,
      itemId,
      txnType: 'in',
      qty,
      sourceType: 'manual_adjust',
      sourceRef: `${P}seed`,
      txnDate: '2026-11-14',
      userId: admin.id,
      guard: 'none',
      itemRevisionId: rev,
    }),
  );

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const [it] = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}PART`,
      name: 'Rev control test part',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId = it!.id;
  const mk = (rev: string, file: string | null) =>
    withUserContext(admin, (tx) =>
      resolveItemRevision(tx, admin, companyId, {
        itemId,
        rev,
        drawingFilePath: file,
        sourceType: 'so_line',
        sourceRef: `${P}test`,
      }),
    );
  rev1 = (await mk('1', `${P}d1.pdf`))!.id;
  rev2 = (await mk('2', null))!.id;
});

afterAll(cleanup);

describe('ADR-289 Drawing Rev control', () => {
  it('A1: Item Issue Return and Cancel put stock back into the buckets it was taken from', async () => {
    await seed(3, null);
    await seed(5, rev1);
    await seed(2, rev2);
    // Take 9: blank 3 first, then ABC/1 (5, largest), then ABC/2 (1).
    const iss = await createStoreIssue(
      {
        issueDate: '2026-11-14',
        issueAgainst: 'general',
        issuedToText: 'Rev test',
        department: 'Production',
        purpose: 'ADR-289 test',
        lines: [{ itemId, qty: 9 }],
      } as never,
      admin,
    );
    expect(await buckets()).toMatchObject({ '': 0, [rev1]: 0, [rev2]: 1 });
    const parts = await db
      .select({ rev: stockOutParts.itemRevisionId, qty: stockOutParts.qty })
      .from(stockOutParts)
      .where(eq(stockOutParts.storeIssueLineId, iss.lines[0]!.id))
      .orderBy(stockOutParts.takeOrder);
    expect(parts).toEqual([
      { rev: null, qty: 3 },
      { rev: rev1, qty: 5 },
      { rev: rev2, qty: 1 },
    ]);

    // Return 2: last taken first → ABC/2 gets 1, ABC/1 gets 1; blank nothing.
    await returnStoreIssue(
      iss.id,
      { lines: [{ issueLineId: iss.lines[0]!.id, qty: 2 }], reason: 'ADR-289 partial return' },
      admin,
    );
    expect(await buckets()).toMatchObject({ '': 0, [rev1]: 1, [rev2]: 2 });
    const rets = await db
      .select({ qty: storeIssueReturns.qty })
      .from(storeIssueReturns)
      .where(eq(storeIssueReturns.issueLineId, iss.lines[0]!.id));
    // ONE return row per user Return; the bucket split is in the parts + ledger.
    expect(rets.map((r) => Number(r.qty))).toEqual([2]);
    const back = await db
      .select({ ret: stockOutParts.returnedQty })
      .from(stockOutParts)
      .where(eq(stockOutParts.storeIssueLineId, iss.lines[0]!.id))
      .orderBy(stockOutParts.takeOrder);
    expect(back.map((b) => Number(b.ret))).toEqual([0, 1, 1]);

    // A second issue of 3 (blank 0 → ABC/2 2 first, then ABC/1 1), then Cancel.
    const before = await buckets();
    const iss2 = await createStoreIssue(
      {
        issueDate: '2026-11-14',
        issueAgainst: 'general',
        issuedToText: 'Rev test',
        department: 'Production',
        purpose: 'ADR-289 test 2',
        lines: [{ itemId, qty: 3 }],
      } as never,
      admin,
    );
    expect(await buckets()).toMatchObject({ [rev1]: 0, [rev2]: 0 });
    await withUserContext(admin, (tx) =>
      cancelStoreIssueTx(tx, companyId, iss2.id, 'ADR-289 cancel test', admin),
    );
    expect(await buckets()).toMatchObject(before);
  });

  it('A3: an OSP last-op GRN of a Job Card not built by a PRO credits the Job Card Rev', async () => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        companyId,
        code: `${P}PO1`,
        poDate: '2026-11-14',
        vendorCodeText: `${P}VEN`,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: purchaseOrders.id });
    const [pol] = await db
      .insert(purchaseOrderLines)
      .values({
        companyId,
        purchaseOrderId: po!.id,
        lineNo: 1,
        itemId,
        itemName: 'part',
        qty: 4,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: purchaseOrderLines.id });
    const [jc] = await db
      .insert(jobCards)
      .values({
        companyId,
        code: `${P}JC-OSP`,
        jcDate: '2026-11-14',
        itemId,
        orderQty: 4,
        itemRevisionId: rev2,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: jobCards.id });
    await db.insert(jcOps).values({
      companyId,
      jobCardId: jc!.id,
      opSeq: 1,
      operation: 'Plating',
      opType: 'outsource',
      outsourcePoLineId: pol!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    } as never);
    const [grn] = await db
      .insert(goodsReceiptNotes)
      .values({
        companyId,
        code: `${P}GRN1`,
        grnDate: '2026-11-14',
        vendorCodeText: `${P}VEN`,
        purchaseOrderId: po!.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: goodsReceiptNotes.id });
    const [gl] = await db
      .insert(goodsReceiptNoteLines)
      .values({
        companyId,
        goodsReceiptNoteId: grn!.id,
        lineNo: 1,
        purchaseOrderLineId: pol!.id,
        itemId,
        itemName: 'part',
        receivedQty: 4,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: goodsReceiptNoteLines.id });
    const before = (await buckets())[rev2] ?? 0;
    await withUserContext(admin, (tx) =>
      creditGrnQcStock({
        tx,
        companyId,
        adminUserId: admin.id,
        grnId: grn!.id,
        grnLineId: gl!.id,
        itemId,
        qty: 4,
      }),
    );
    expect((await buckets())[rev2]).toBe(before + 4);
  });

  it('F: a Rev change on a line with a Job Card needs a reason; it is stored and logged', async () => {
    const [so] = await db
      .insert(salesOrders)
      .values({
        companyId,
        code: `${P}SO1`,
        soDate: '2026-11-14',
        type: 'component_manufacturing',
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: salesOrders.id });
    const [line] = await db
      .insert(salesOrderLines)
      .values({
        companyId,
        salesOrderId: so!.id,
        lineNo: 1,
        itemId,
        partName: 'part',
        revision: '1',
        uom: 'NOS',
        orderQty: 5,
        itemRevisionId: rev1,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: salesOrderLines.id });
    const [jc] = await db
      .insert(jobCards)
      .values({
        companyId,
        code: `${P}JC-F`,
        jcDate: '2026-11-14',
        itemId,
        orderQty: 5,
        sourceSoLineId: line!.id,
        itemRevisionId: rev1,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: jobCards.id });
    const change = (reason?: string) =>
      withUserContext(admin, (tx) =>
        applyLineRevChange(tx, admin, companyId, {
          kind: 'so',
          orderId: so!.id,
          docCode: `${P}SO1`,
          lineId: line!.id,
          lineNo: 1,
          itemId,
          fromId: rev1,
          toId: rev2,
          ...(reason !== undefined ? { reason } : {}),
        }),
      );
    const err = await change().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe('Ln 1: give a reason for changing the Drawing Rev');
    await expect(change('abc')).rejects.toBeInstanceOf(ValidationError);

    const res = await change('Customer sent drawing rev 2');
    expect(res.movedDocs).toEqual([`${P}JC-F`]);
    const rows = await db
      .select({ reason: itemRevisionChanges.reason })
      .from(itemRevisionChanges)
      .where(eq(itemRevisionChanges.soLineId, line!.id));
    expect(rows.map((r) => r.reason)).toEqual(['Customer sent drawing rev 2']);
    const jcRow = (
      await db
        .select({ rev: jobCards.itemRevisionId, by: jobCards.updatedBy })
        .from(jobCards)
        .where(eq(jobCards.id, jc!.id))
    )[0]!;
    expect(jcRow.rev).toBe(rev2);
    expect(jcRow.by).toBe(admin.id);
    const log = await db
      .select({ reason: activityLog.reason })
      .from(activityLog)
      .where(and(eq(activityLog.entityId, jc!.id), eq(activityLog.entity, 'JobCard')));
    expect(log.map((l) => l.reason)).toContain('Customer sent drawing rev 2');
  });

  it('G: a valid Replace drawing succeeds — file changed, history row written', async () => {
    const r = (await db.select().from(itemRevisions).where(eq(itemRevisions.id, rev1)))[0]!;
    // The updatedAt exactly as the screen loads it (a JS Date → ISO, ms only).
    const loaded = r.updatedAt.toISOString();
    await withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, rev1, {
        drawingFilePath: `${P}d1-v2.pdf`,
        reason: 'Customer sent corrected drawing',
        expectedUpdatedAt: loaded,
      }),
    );
    const after = (await db.select().from(itemRevisions).where(eq(itemRevisions.id, rev1)))[0]!;
    expect(after.drawingFilePath).toBe(`${P}d1-v2.pdf`);
    const hist = await db
      .select({ action: itemRevisionDrawings.action, path: itemRevisionDrawings.drawingFilePath })
      .from(itemRevisionDrawings)
      .where(
        and(
          eq(itemRevisionDrawings.itemRevisionId, rev1),
          eq(itemRevisionDrawings.action, 'replaced'),
        ),
      );
    expect(hist).toEqual([{ action: 'replaced', path: `${P}d1-v2.pdf` }]);
  });

  it('G: a Replace drawing with a stale updatedAt → 409', async () => {
    const stale = new Date(Date.now() - 86_400_000).toISOString();
    const err = await withUserContext(admin, (tx) =>
      replaceItemRevisionDrawing(tx, admin, companyId, rev1, {
        drawingFilePath: `${P}d1-v3.pdf`,
        reason: 'another replacement',
        expectedUpdatedAt: stale,
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
  });
});
