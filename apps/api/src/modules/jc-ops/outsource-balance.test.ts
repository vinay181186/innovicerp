// Guard test: outsourceOpBalance must refuse while an in-house machine session
// is running on the op (else the running pieces get double-booked to a vendor).

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jcOps, jobCards, runningOps, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { outsourceOpBalance } from './outsource-balance';

const PREFIX = 'TOSB-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let itemId = '';
let jcId = '';
let opId = '';

async function cleanup(): Promise<void> {
  if (jcId) {
    const ops = (await db.select({ id: jcOps.id }).from(jcOps).where(eq(jcOps.jobCardId, jcId))).map(
      (o) => o.id,
    );
    for (const id of ops) await db.delete(runningOps).where(eq(runningOps.jcOpId, id));
    await db.delete(jcOps).where(eq(jcOps.jobCardId, jcId));
    await db.delete(jobCards).where(eq(jobCards.id, jcId));
  }
  if (itemId) await db.delete(items).where(eq(items.id, itemId));
  await db.delete(jobCards).where(like(jobCards.code, `${PREFIX}%`));
  await db.delete(items).where(like(items.code, `${PREFIX}%`));
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await cleanup();
  itemId = (
    await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${PREFIX}ITEM`,
        name: 'OSB test item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!.id;
  jcId = (
    await db
      .insert(jobCards)
      .values({
        companyId: admin.companyId!,
        code: `${PREFIX}JC`,
        jcDate: '2026-05-01',
        itemId,
        orderQty: 60,
        priority: 'normal',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!.id;
  opId = (
    await db
      .insert(jcOps)
      .values({
        companyId: admin.companyId!,
        jobCardId: jcId,
        opSeq: 1,
        machineCodeText: 'M1',
        operation: 'turn',
        opType: 'process',
        cycleTimeMin: '0.00',
        qcRequired: false,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning()
  )[0]!.id;
});

afterAll(cleanup);

describe('outsourceOpBalance — running-session guard', () => {
  it('blocks outsourcing the balance while an in-house machine session is running', async () => {
    // Machine started on the op, 0 completed → an active in-house running session.
    await db.insert(runningOps).values({
      companyId: admin.companyId!,
      jcOpId: opId,
      isOsp: false,
      startDate: '2026-05-01',
      startTime: '10:00',
      shift: 'day',
      status: 'running',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    // Guard fires before vendor resolution, so the vendor code is irrelevant here.
    await expect(
      outsourceOpBalance(opId, { qty: 60, vendorCode: 'ANY' }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
