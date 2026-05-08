import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, storeTransactions, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T036D-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;

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
  // Dedicated test item so this suite's seeded ledger rows don't perturb
  // v_item_stock for the GRN suite (which shared firstItemId previously and
  // saw flaky stock_before assertions when this suite's afterAll dropped its
  // +3 net stock between the GRN test's baseline read and create call).
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const itemRows = await db
    .insert(items)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}ITEM`,
      name: 'Store-tx test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  firstItemId = itemRows[0]!.id;
});

afterAll(async () => {
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('store-transactions service', () => {
  it('listStoreTransactions returns rows with item_code/name joined and applies filters', async () => {
    // Seed two ledger rows directly (no service writer — append-only ledger).
    await db.insert(storeTransactions).values([
      {
        companyId: admin.companyId!,
        txnDate: '2026-05-03',
        itemId: firstItemId,
        txnType: 'in',
        qty: 5,
        sourceType: 'grn_qc',
        sourceRef: `${TEST_PREFIX}A1`,
        stockBefore: 0,
        stockAfter: 5,
        remarks: 'test',
        createdBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        txnDate: '2026-05-03',
        itemId: firstItemId,
        txnType: 'out',
        qty: 2,
        sourceType: 'dispatch',
        sourceRef: `${TEST_PREFIX}A2`,
        stockBefore: 5,
        stockAfter: 3,
        remarks: 'test',
        createdBy: admin.id,
      },
    ]);

    const allForItem = await service.listStoreTransactions(
      { itemId: firstItemId, limit: 50, offset: 0 },
      admin,
    );
    const myRows = allForItem.items.filter((r) => r.sourceRef.startsWith(TEST_PREFIX));
    expect(myRows).toHaveLength(2);
    expect(myRows[0]?.itemCode).toBeTruthy();
    expect(myRows[0]?.itemName).toBeTruthy();

    const onlyIn = await service.listStoreTransactions(
      { itemId: firstItemId, txnType: 'in', search: TEST_PREFIX, limit: 50, offset: 0 },
      admin,
    );
    expect(onlyIn.items.every((r) => r.txnType === 'in')).toBe(true);
    expect(onlyIn.items.find((r) => r.sourceRef === `${TEST_PREFIX}A1`)).toBeDefined();
  });

  it('getItemBalance returns on_hand from v_item_stock', async () => {
    const balance = await service.getItemBalance(firstItemId, admin);
    expect(balance.itemId).toBe(firstItemId);
    expect(typeof balance.onHand).toBe('number');
    expect(balance.onHand).toBeGreaterThanOrEqual(0);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.listStoreTransactions({ limit: 10, offset: 0 }, noCompanyUser),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.getItemBalance(firstItemId, noCompanyUser)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
