// ADR-289 — Drawing Rev control, step 1. Positive asserts on TEST:
//   • A1: an Item Issue of a make item takes from the NAMED Rev bucket (ADR-292)
//     and a partial Return / a Cancel give back to that same bucket;
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
import { createRevSubstitution } from '../rev-substitutions/service';
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
    // ADR-292 — substitutions + their use rows (0251) first.
    await db.execute(sql`
      DELETE FROM public.rev_substitution_uses WHERE substitution_id IN (
        SELECT id FROM public.rev_substitutions WHERE item_id = ANY(${sql.param(ids)}::uuid[]))`);
    await db.execute(sql`
      DELETE FROM public.activity_log WHERE entity_id IN (
        SELECT id FROM public.rev_substitutions WHERE item_id = ANY(${sql.param(ids)}::uuid[]))`);
    await db.execute(sql`
      DELETE FROM public.rev_substitutions WHERE item_id = ANY(${sql.param(ids)}::uuid[])`);
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
  it('A1: Item Issue takes from the named Rev bucket; Return and Cancel give back to it', async () => {
    await seed(3, null);
    await seed(5, rev1);
    await seed(2, rev2);
    const slip = (qty: number, rev: string | undefined, purpose: string) =>
      createStoreIssue(
        {
          issueDate: '2026-11-14',
          issueAgainst: 'general',
          issuedToText: 'Rev test',
          department: 'Production',
          purpose,
          lines: [{ itemId, qty, ...(rev === undefined ? {} : { itemRevisionId: rev }) }],
        } as never,
        admin,
      );
    // ADR-292 — a make item with Rev stock must name its bucket.
    await expect(slip(1, undefined, 'ADR-292 no Rev')).rejects.toThrow(
      /Choose the Drawing Rev to issue/,
    );
    expect(await buckets()).toMatchObject({ '': 3, [rev1]: 5, [rev2]: 2 });

    // Take 4 from ABC/1 only — blank and ABC/2 are not touched.
    const iss = await slip(4, rev1, 'ADR-289 test');
    expect(await buckets()).toMatchObject({ '': 3, [rev1]: 1, [rev2]: 2 });
    const parts = await db
      .select({ rev: stockOutParts.itemRevisionId, qty: stockOutParts.qty })
      .from(stockOutParts)
      .where(eq(stockOutParts.storeIssueLineId, iss.lines[0]!.id))
      .orderBy(stockOutParts.takeOrder);
    expect(parts.map((x) => ({ rev: x.rev, qty: Number(x.qty) }))).toEqual([{ rev: rev1, qty: 4 }]);

    // Return 2 → back into ABC/1 (the bucket it came from), nowhere else.
    await returnStoreIssue(
      iss.id,
      { lines: [{ issueLineId: iss.lines[0]!.id, qty: 2 }], reason: 'ADR-289 partial return' },
      admin,
    );
    expect(await buckets()).toMatchObject({ '': 3, [rev1]: 3, [rev2]: 2 });
    const rets = await db
      .select({ qty: storeIssueReturns.qty })
      .from(storeIssueReturns)
      .where(eq(storeIssueReturns.issueLineId, iss.lines[0]!.id));
    // ONE return row per user Return; the bucket is in the parts + ledger.
    expect(rets.map((r) => Number(r.qty))).toEqual([2]);
    const back = await db
      .select({ rev: stockOutParts.itemRevisionId, ret: stockOutParts.returnedQty })
      .from(stockOutParts)
      .where(eq(stockOutParts.storeIssueLineId, iss.lines[0]!.id))
      .orderBy(stockOutParts.takeOrder);
    expect(back.map((x) => ({ rev: x.rev, ret: Number(x.ret) }))).toEqual([{ rev: rev1, ret: 2 }]);
    // Returning more than is still out (4 − 2 = 2) is refused.
    await expect(
      returnStoreIssue(
        iss.id,
        { lines: [{ issueLineId: iss.lines[0]!.id, qty: 3 }], reason: 'ADR-289 over return' },
        admin,
      ),
    ).rejects.toBeInstanceOf(AppError);

    // A second issue of 2 from ABC/2, then Cancel → ABC/2 gets exactly 2 back.
    const before = await buckets();
    const iss2 = await slip(2, rev2, 'ADR-289 test 2');
    expect(await buckets()).toMatchObject({ '': 3, [rev1]: 3, [rev2]: 0 });
    await withUserContext(admin, (tx) =>
      cancelStoreIssueTx(tx, companyId, iss2.id, 'ADR-289 cancel test', admin),
    );
    expect(await buckets()).toMatchObject(before);
    const back2 = await db
      .select({
        rev: stockOutParts.itemRevisionId,
        qty: stockOutParts.qty,
        ret: stockOutParts.returnedQty,
      })
      .from(stockOutParts)
      .where(eq(stockOutParts.storeIssueLineId, iss2.lines[0]!.id));
    expect(back2.map((x) => ({ rev: x.rev, qty: Number(x.qty), ret: Number(x.ret) }))).toEqual([
      { rev: rev2, qty: 2, ret: 2 },
    ]);
  });

  it('A1b: a Job Card Rev moved between issue and return still gives the substitution back', async () => {
    // A Job Card on ABC/1; Store issues ABC/2 to it on an approved substitution.
    const [jc] = await db
      .insert(jobCards)
      .values({
        companyId,
        code: `${P}JC-SUB`,
        jcDate: '2026-11-14',
        itemId,
        orderQty: 2,
        itemRevisionId: rev1,
        createdBy: admin.id,
        updatedBy: admin.id,
      } as never)
      .returning({ id: jobCards.id });
    const issue = () =>
      createStoreIssue(
        {
          issueDate: '2026-11-14',
          issueAgainst: 'job_card',
          jobCardId: jc!.id,
          issuedToText: 'Rev test',
          purpose: 'ADR-292 substitution',
          confirmReason: 'ADR-292 test issue to card',
          lines: [{ itemId, qty: 2, itemRevisionId: rev2 }],
        } as never,
        admin,
      );
    await expect(issue()).rejects.toThrow(/Revision mismatch with the Job Card/);
    const sub = await createRevSubstitution(
      {
        itemId,
        fromItemRevisionId: rev2,
        toItemRevisionId: rev1,
        salesOrderLineId: null,
        jobWorkOrderLineId: null,
        jobCardId: jc!.id,
        qtyAllowed: 5,
        reason: `${P}card takes ABC/2`,
        ecrId: null,
      },
      admin,
    );
    const used = async () =>
      Number(
        (
          (await db.execute(sql`
            SELECT qty_used::float8 AS u FROM public.rev_substitutions WHERE id = ${sub.id}::uuid`)) as unknown as Array<{
            u: number;
          }>
        )[0]!.u,
      );
    const iss = await issue();
    expect(await used()).toBe(2);
    const uses = (await db.execute(sql`
      SELECT source_type AS t, source_id AS id, qty::float8 AS q FROM public.rev_substitution_uses
       WHERE substitution_id = ${sub.id}::uuid`)) as unknown as Array<{
      t: string;
      id: string;
      q: number;
    }>;
    expect(uses).toEqual([{ t: 'store_issue_line', id: iss.lines[0]!.id, q: 2 }]);

    // The card moves to ABC/2 (an ECR) — the old code re-derived "substituted?"
    // from the card's Rev and gave nothing back.
    await db.execute(
      sql`UPDATE public.job_cards SET item_revision_id = ${rev2}::uuid WHERE id = ${jc!.id}::uuid`,
    );
    await returnStoreIssue(
      iss.id,
      { lines: [{ issueLineId: iss.lines[0]!.id, qty: 1 }], reason: 'ADR-292 partial return' },
      admin,
    );
    expect(await used()).toBe(1); // exactly the 1 that came back
    await returnStoreIssue(
      iss.id,
      { lines: [{ issueLineId: iss.lines[0]!.id, qty: 1 }], reason: 'ADR-292 rest return' },
      admin,
    );
    expect(await used()).toBe(0); // never below 0 — never more than was used
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
    // ADR-291 — an open Job Card on the line: a plain Rev change is refused
    // (raise an ECR). The reason / release / log rules below are exercised
    // through the documentation-only ECR path ('move_all'), which still moves.
    const plain = await withUserContext(admin, (tx) =>
      applyLineRevChange(tx, admin, companyId, {
        kind: 'so',
        orderId: so!.id,
        docCode: `${P}SO1`,
        lineId: line!.id,
        lineNo: 1,
        itemId,
        fromId: rev1,
        toId: rev2,
        reason: 'Customer sent drawing rev 2',
      }),
    ).catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(ValidationError);
    expect((plain as Error).message).toBe(
      `Ln 1: ${P}PART/1 has work in progress — raise an Engineering Change (ECR) to move it to ${P}PART/2.`,
    );
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
          ecrImplement: 'move_all',
          ...(reason !== undefined ? { reason } : {}),
        }),
      );
    const err = await change().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe('Ln 1: give a reason for changing the Drawing Rev');
    await expect(change('abc')).rejects.toBeInstanceOf(ValidationError);
    // ADR-290 — open work may not move to a Rev that is not released.
    await expect(change('Customer sent drawing rev 2')).rejects.toThrow(
      `${P}PART/2 is Not released. Add / release it in the Drawing Register first, then change the Rev on the line.`,
    );
    await db
      .update(itemRevisions)
      .set({ releaseStatus: 'released' })
      .where(eq(itemRevisions.id, rev2));

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
