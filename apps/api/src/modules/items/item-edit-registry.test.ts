// Item Master enrolled in edit-approval (ADR-202, Phase 2c). Integration test:
// it hits the real DB (the house harness), so CI runs it, not a local run
// against production. It proves the record-level path end to end: with the gate
// on, a field edit STAGES, and approving it writes the approved value through the
// item's own edit writer (updateItemTx).

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { db } from '../../db/client';
import { activityLog, approvalConfig, documentEditRequests, items, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { decideDocumentEdit } from '../document-edits/service';
import { createItem, updateItemOrStage } from './service';

const TEST_PREFIX = 'TIE-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let cfgExisted = false;
let origDocEditApproval = false;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const cfg = await db
    .select()
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, u.companyId)))
    .limit(1);
  if (cfg[0]) {
    cfgExisted = true;
    origDocEditApproval = cfg[0].docEditApproval;
    await db
      .update(approvalConfig)
      .set({ docEditApproval: true })
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
      .set({ docEditApproval: origDocEditApproval })
      .where(eq(approvalConfig.companyId, admin.companyId!));
  } else {
    await db.delete(approvalConfig).where(eq(approvalConfig.companyId, admin.companyId!));
  }
  await db.delete(documentEditRequests).where(like(documentEditRequests.docCode, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}, 180_000);

describe('Item Master — edit-approval (ADR-202)', () => {
  it('stages a record-level edit and applies the approved change', async () => {
    const code = `${TEST_PREFIX}${Date.now()}`;
    const created = await createItem(
      {
        code,
        name: 'Edit-approval widget',
        description: 'before',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        procurementType: 'make',
      },
      admin,
    );
    const expectedUpdatedAt = new Date(created.updatedAt as unknown as string).toISOString();

    const staged = (await updateItemOrStage(
      created.id,
      { description: 'after', expectedUpdatedAt },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);

    const change = staged.request.changes.find((c) => c.id === 'description');
    expect(change).toBeTruthy();

    const decided = await decideDocumentEdit(
      { id: staged.request.id, decisions: [{ changeId: change!.id, decision: 'approve' }] },
      admin,
    );
    expect(decided.decisions.find((d) => d.changeId === change!.id)?.outcome).toBe('approved');

    const after = await db
      .select({ description: items.description })
      .from(items)
      .where(eq(items.id, created.id))
      .limit(1);
    expect(after[0]!.description).toBe('after'); // approved → applied
  }, 180_000);
});
