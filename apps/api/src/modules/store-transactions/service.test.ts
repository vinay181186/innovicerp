import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, itemStockBalances, storeTransactions, users } from '../../db/schema';
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

// ─── T-042: item_stock_balances trigger ────────────────────────────────────
// Verifies that the AFTER INSERT trigger on store_transactions keeps the
// balance cache in sync with the live ledger. Each test seeds a clean item
// + txns, asserts the balance row reflects the expected SUM, then cleans up.

const T042_PREFIX = 'T042-';

describe('store-transactions: item_stock_balances trigger', () => {
  let testItemId: string;

  beforeAll(async () => {
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${T042_PREFIX}%`));
    await db.delete(items).where(like(items.code, `${T042_PREFIX}%`));
    const itemRows = await db
      .insert(items)
      .values({
        companyId: admin.companyId!,
        code: `${T042_PREFIX}ITEM`,
        name: 'Trigger test item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    testItemId = itemRows[0]!.id;
  });

  afterAll(async () => {
    // store_transactions cascade-delete is not in place (append-only ledger),
    // and the trigger only fires on INSERT — deletes are silent. Wiping
    // store_transactions here will leave the balance cache stale for the
    // test item only; the items DELETE cascades to item_stock_balances
    // via the FK (ON DELETE CASCADE in 0020) so the table stays consistent.
    await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `${T042_PREFIX}%`));
    await db.delete(items).where(like(items.code, `${T042_PREFIX}%`));
  });

  async function readBalance(itemId: string): Promise<number> {
    const rows = await db
      .select({ q: itemStockBalances.onHandQty })
      .from(itemStockBalances)
      .where(
        and(
          eq(itemStockBalances.companyId, admin.companyId!),
          eq(itemStockBalances.itemId, itemId),
        ),
      )
      .limit(1);
    return rows[0]?.q ?? 0;
  }

  async function liveSum(itemId: string): Promise<number> {
    const rows = (await db.execute(sql`
      SELECT COALESCE(SUM(CASE
        WHEN txn_type = 'in'  THEN  qty
        WHEN txn_type = 'out' THEN -qty
        ELSE qty
      END), 0)::int AS s
      FROM store_transactions
      WHERE company_id = ${admin.companyId!}::uuid
        AND item_id = ${itemId}::uuid
    `)) as unknown as Array<{ s: number }>;
    return Number(rows[0]?.s ?? 0);
  }

  it('insert with txn_type=in upserts a balance row with +qty', async () => {
    await db.insert(storeTransactions).values({
      companyId: admin.companyId!,
      txnDate: '2026-05-19',
      itemId: testItemId,
      txnType: 'in',
      qty: 10,
      sourceType: 'grn_qc',
      sourceRef: `${T042_PREFIX}IN1`,
      stockBefore: 0,
      stockAfter: 10,
      createdBy: admin.id,
    });
    expect(await readBalance(testItemId)).toBe(10);
  });

  it('subsequent insert with txn_type=out reduces balance', async () => {
    await db.insert(storeTransactions).values({
      companyId: admin.companyId!,
      txnDate: '2026-05-19',
      itemId: testItemId,
      txnType: 'out',
      qty: 3,
      sourceType: 'dispatch',
      sourceRef: `${T042_PREFIX}OUT1`,
      stockBefore: 10,
      stockAfter: 7,
      createdBy: admin.id,
    });
    expect(await readBalance(testItemId)).toBe(7);
  });

  it('balance matches live SUM across mixed txns (in + out + adjust)', async () => {
    await db.insert(storeTransactions).values([
      {
        companyId: admin.companyId!,
        txnDate: '2026-05-19',
        itemId: testItemId,
        txnType: 'in',
        qty: 5,
        sourceType: 'qc_accept',
        sourceRef: `${T042_PREFIX}MIX-IN`,
        stockBefore: 7,
        stockAfter: 12,
        createdBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        txnDate: '2026-05-19',
        itemId: testItemId,
        txnType: 'out',
        qty: 4,
        sourceType: 'jw_out',
        sourceRef: `${T042_PREFIX}MIX-OUT`,
        stockBefore: 12,
        stockAfter: 8,
        createdBy: admin.id,
      },
    ]);
    expect(await readBalance(testItemId)).toBe(await liveSum(testItemId));
  });

  it('insert with item_id=NULL does NOT create a balance row', async () => {
    const balanceCountBefore = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(itemStockBalances);
    await db.insert(storeTransactions).values({
      companyId: admin.companyId!,
      txnDate: '2026-05-19',
      itemId: null,
      itemCodeText: 'FREE-TEXT-ITEM',
      txnType: 'in',
      qty: 100,
      sourceType: 'manual_adjust',
      sourceRef: `${T042_PREFIX}NULL`,
      stockBefore: 0,
      stockAfter: 0,
      createdBy: admin.id,
    });
    const balanceCountAfter = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(itemStockBalances);
    expect(balanceCountAfter[0]?.c).toBe(balanceCountBefore[0]?.c);
  });

  it('v_item_stock view reads from the table and returns the same value', async () => {
    const viaTable = await readBalance(testItemId);
    const viaView = await service.getItemBalance(testItemId, admin);
    expect(viaView.onHand).toBe(viaTable);
  });
});
