// Edit-approval engine (ADR-202) — Phase 1b PO LINE changes, per-change partial
// apply. These are integration tests: they hit the real DB (the house harness),
// so CI runs them, not a local run against production. They prove the two rules
// Phase 1b turns on:
//
//  1. Approve one line attr, reject another in the same request → only the
//     approved attr is written; the rejected one keeps its current value.
//  2. If the live line drifts after the request, approving that change marks it
//     'superseded' and applies nothing (§20.4 under the engine's row lock).
//
// Add / remove of a line is out of scope for 1b and is refused by the divert in
// purchase-orders/service.ts (updatePurchaseOrderOrStage).

import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  documentEditRequests,
  items,
  purchaseOrderLines,
  purchaseOrders,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as poService from '../purchase-orders/service';
import { decideDocumentEdit } from './service';

const TEST_PREFIX = 'TDE1B-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstVendorId: string;

let cfgExisted = false;
let origDocEditApproval = false;
let origPoApproval = false;

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

  const itemRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  firstItemId = itemRow[0]!.id;

  const vendorRow = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.companyId, u.companyId),
        isNull(vendors.deletedAt),
        notLike(vendors.code, 'T%-%'),
      ),
    )
    .orderBy(asc(vendors.createdAt))
    .limit(1);
  firstVendorId = vendorRow[0]!.id;

  // Gate ON for the edit-approval engine; PO approval OFF so a commercial change
  // on an open PO does not also bounce it back to draft (that path is tested by
  // the PO suite — here we isolate the line-level partial apply).
  const cfg = await db
    .select()
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, u.companyId), isNull(approvalConfig.deletedAt)))
    .limit(1);
  if (cfg[0]) {
    cfgExisted = true;
    origDocEditApproval = cfg[0].docEditApproval;
    origPoApproval = cfg[0].poApproval;
    await db
      .update(approvalConfig)
      .set({ docEditApproval: true, poApproval: false })
      .where(eq(approvalConfig.id, cfg[0].id));
  } else {
    await db.insert(approvalConfig).values({
      companyId: u.companyId,
      docEditApproval: true,
      poApproval: false,
      prApproval: false,
      invoiceApproval: false,
      createdBy: u.id,
      updatedBy: u.id,
    });
  }
}, 180_000);

afterAll(async () => {
  if (cfgExisted) {
    await db
      .update(approvalConfig)
      .set({ docEditApproval: origDocEditApproval, poApproval: origPoApproval })
      .where(and(eq(approvalConfig.companyId, admin.companyId!), isNull(approvalConfig.deletedAt)));
  } else {
    await db.delete(approvalConfig).where(eq(approvalConfig.companyId, admin.companyId!));
  }

  await db.delete(documentEditRequests).where(like(documentEditRequests.docCode, `${TEST_PREFIX}%`));
  const headers = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  for (const h of headers) {
    await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, h.id));
  }
  await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}, 180_000);

/** An OPEN (live) PO with a single line, so the edit must stage. */
async function createOpenPo(code: string, qty: number, rate: number) {
  return poService.createPurchaseOrder(
    {
      header: {
        code,
        poDate: '2026-05-03',
        poType: 'standard',
        vendorId: firstVendorId,
        status: 'open',
        sgstPct: 0,
        cgstPct: 0,
        igstPct: 0,
      },
      lines: [{ itemId: firstItemId, itemName: 'Widget', qty, rate }],
    },
    admin,
  );
}

async function readLine(lineId: string) {
  const rows = await db
    .select({ qty: purchaseOrderLines.qty, rate: purchaseOrderLines.rate })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.id, lineId))
    .limit(1);
  return rows[0]!;
}

describe('document-edits engine — PO line changes (Phase 1b)', () => {
  it('approves one line attr and rejects another: only the approved attr is written', async () => {
    const po = await createOpenPo(`${TEST_PREFIX}PART`, 5, 100);
    const lineId = po.lines[0]!.id;

    // Stage: L1 rate 100 → 120 AND qty 5 → 6 (item unchanged — same itemId).
    const staged = (await poService.updatePurchaseOrderOrStage(
      po.id,
      {
        header: {},
        lines: [{ id: lineId, itemId: firstItemId, itemName: 'Widget', qty: 6, rate: 120 }],
        expectedUpdatedAt: po.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);

    const rateChange = staged.request.changes.find((c) => c.id === `line:${lineId}:rate`);
    const qtyChange = staged.request.changes.find((c) => c.id === `line:${lineId}:qty`);
    expect(rateChange).toBeTruthy();
    expect(qtyChange).toBeTruthy();
    // No item change was requested.
    expect(staged.request.changes.find((c) => c.id === `line:${lineId}:item`)).toBeUndefined();

    // Approve the rate, reject the qty.
    const decided = await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: rateChange!.id, decision: 'approve' },
          { changeId: qtyChange!.id, decision: 'reject', reason: 'keep qty' },
        ],
      },
      admin,
    );

    const rateOutcome = decided.decisions.find((d) => d.changeId === rateChange!.id);
    const qtyOutcome = decided.decisions.find((d) => d.changeId === qtyChange!.id);
    expect(rateOutcome?.outcome).toBe('approved');
    expect(qtyOutcome?.outcome).toBe('rejected');

    const line = await readLine(lineId);
    expect(Number(line.rate)).toBe(120); // approved → applied
    expect(Number(line.qty)).toBe(5); // rejected → untouched
  }, 180_000);

  it('marks a line change superseded when the live line drifted after the request', async () => {
    const po = await createOpenPo(`${TEST_PREFIX}SUP`, 5, 100);
    const lineId = po.lines[0]!.id;

    // Stage: rate 100 → 120.
    const staged = (await poService.updatePurchaseOrderOrStage(
      po.id,
      {
        header: {},
        lines: [{ id: lineId, itemId: firstItemId, itemName: 'Widget', qty: 5, rate: 120 }],
        expectedUpdatedAt: po.updatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    const rateChange = staged.request.changes.find((c) => c.id === `line:${lineId}:rate`);
    expect(rateChange).toBeTruthy();

    // The live line's rate moves to 130 after the request — the captured before
    // (100) no longer matches, so approving must supersede, not apply.
    await db
      .update(purchaseOrderLines)
      .set({ rate: '130.00', updatedBy: admin.id })
      .where(eq(purchaseOrderLines.id, lineId));

    const decided = await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: rateChange!.id, decision: 'approve' }] },
      admin,
    );
    const rateOutcome = decided.decisions.find((d) => d.changeId === rateChange!.id);
    expect(rateOutcome?.outcome).toBe('superseded');
    expect(decided.status).toBe('superseded');

    const line = await readLine(lineId);
    expect(Number(line.rate)).toBe(130); // drift kept; the 120 was NOT applied
  }, 180_000);
});
