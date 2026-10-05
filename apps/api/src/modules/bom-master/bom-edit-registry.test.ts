// BOM Master enrolled in edit-approval (ADR-202). Integration test (hits the real
// DB via the house harness, so CI runs it — not a local run against production).
// It proves the LINE-level path: with the gate on, a line qty edit + a header edit
// STAGE, approving writes both through the BOM's own writer (updateBomMasterTx), and
// a line add/remove is refused while the gate is on.

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { db } from '../../db/client';
import {
  activityLog,
  approvalConfig,
  bomMasterLines,
  bomMasters,
  documentEditRequests,
  items,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { decideDocumentEdit } from '../document-edits/service';
import { createBomMaster, updateBomMasterOrStage } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TBOMEA-';

let admin: AuthContext;
let parentId: string;
let child1: string;
let child2: string;
let cfgExisted = false;
let origDocEditApproval = false;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const it = await db
    .insert(items)
    .values([
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}P`,
        name: 'EA parent',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}C1`,
        name: 'EA child 1',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}C2`,
        name: 'EA child 2',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  parentId = it[0]!.id;
  child1 = it[1]!.id;
  child2 = it[2]!.id;

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
  await db
    .delete(documentEditRequests)
    .where(like(documentEditRequests.docCode, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}, 180_000);

describe('BOM Master — edit-approval (ADR-202)', () => {
  it('stages a line qty edit + a header edit and applies both on approve', async () => {
    const bom = await createBomMaster(
      {
        bomNo: `${TEST_PREFIX}${Date.now()}`,
        bomName: 'EA original name',
        parentItemId: parentId,
        status: 'active',
        lines: [
          { childItemId: child1, qtyPerSet: 2, bomType: 'manufacture' },
          { childItemId: child2, qtyPerSet: 3, bomType: 'purchase' },
        ],
      },
      admin,
    );
    const expectedUpdatedAt = new Date(bom.updatedAt as unknown as string).toISOString();

    const staged = (await updateBomMasterOrStage(
      bom.id,
      {
        bomNo: bom.bomNo,
        bomName: 'EA new name', // header edit
        parentItemId: parentId,
        status: bom.status,
        lines: [
          { childItemId: child1, qtyPerSet: 5, bomType: 'manufacture' }, // qty edit
          { childItemId: child2, qtyPerSet: 3, bomType: 'purchase' }, // unchanged
        ],
        expectedUpdatedAt,
      },
      admin,
    )) as DocumentEditStagedResult;
    expect(staged.staged).toBe(true);

    const nameChange = staged.request.changes.find((c) => c.id === 'bomName');
    const qtyChange = staged.request.changes.find((c) => c.id === `line:${child1}:qty`);
    expect(nameChange).toBeTruthy();
    expect(qtyChange).toBeTruthy();

    const decided = await decideDocumentEdit(
      {
        id: staged.request.id,
        decisions: [
          { changeId: nameChange!.id, decision: 'approve' },
          { changeId: qtyChange!.id, decision: 'approve' },
        ],
      },
      admin,
    );
    expect(decided.decisions.every((d) => d.outcome === 'approved')).toBe(true);

    const hdr = await db
      .select({ bomName: bomMasters.bomName })
      .from(bomMasters)
      .where(eq(bomMasters.id, bom.id))
      .limit(1);
    expect(hdr[0]!.bomName).toBe('EA new name');

    const line = await db
      .select({ qtyPerSet: bomMasterLines.qtyPerSet })
      .from(bomMasterLines)
      .where(and(eq(bomMasterLines.bomMasterId, bom.id), eq(bomMasterLines.childItemId, child1)))
      .limit(1);
    expect(Number(line[0]!.qtyPerSet)).toBe(5);
  }, 180_000);

  it('refuses adding or removing a line while the gate is on', async () => {
    const bom = await createBomMaster(
      {
        bomNo: `${TEST_PREFIX}RM-${Date.now()}`,
        bomName: 'EA set-change',
        parentItemId: parentId,
        status: 'active',
        lines: [
          { childItemId: child1, qtyPerSet: 1, bomType: 'manufacture' },
          { childItemId: child2, qtyPerSet: 1, bomType: 'purchase' },
        ],
      },
      admin,
    );
    const expectedUpdatedAt = new Date(bom.updatedAt as unknown as string).toISOString();

    await expect(
      updateBomMasterOrStage(
        bom.id,
        {
          bomNo: bom.bomNo,
          bomName: bom.bomName,
          parentItemId: parentId,
          status: bom.status,
          lines: [{ childItemId: child1, qtyPerSet: 1, bomType: 'manufacture' }], // child2 dropped
          expectedUpdatedAt,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  }, 180_000);
});
