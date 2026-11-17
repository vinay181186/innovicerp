// ADR-303 — GET /purchase-orders is the PO list screen again: ONE ROW PER PO.
// Read-only: runs against whatever POs the TEST company already holds.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { purchaseOrderLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listPurchaseOrders } from './service';
import { listPurchaseOrdersQuerySchema } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('listPurchaseOrders — one row per PO (ADR-303)', () => {
  it('a PO with many lines is ONE row; lineCount = its live lines', async () => {
    const q = listPurchaseOrdersQuerySchema.parse({ limit: '50', offset: '0' });
    const res = await listPurchaseOrders(q, admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    if (ids.length === 0) return;
    const counts = await db
      .select({ po: purchaseOrderLines.purchaseOrderId, n: sql<number>`count(*)::int` })
      .from(purchaseOrderLines)
      .where(
        and(inArray(purchaseOrderLines.purchaseOrderId, ids), isNull(purchaseOrderLines.deletedAt)),
      )
      .groupBy(purchaseOrderLines.purchaseOrderId);
    const byPo = new Map(counts.map((c) => [c.po, Number(c.n)]));
    for (const r of res.items) expect(r.lineCount).toBe(byPo.get(r.id) ?? 0);
    for (const r of res.items) expect(r.soExtraCount).toBeGreaterThanOrEqual(0);
  });

  it('the SO dropdown (soCode tick) returns each PO once, incl. the PO it came from', async () => {
    const all = await listPurchaseOrders(
      listPurchaseOrdersQuerySchema.parse({ limit: '200', offset: '0' }),
      admin,
    );
    const withSo = all.items.find((r) => r.soCode);
    if (!withSo) return;
    const sf = JSON.stringify({
      sort: null,
      filters: [{ field: 'soCode', kind: 'values', values: [withSo.soCode] }],
    });
    const res = await listPurchaseOrders(
      listPurchaseOrdersQuerySchema.parse({ sf, limit: '200', offset: '0' }),
      admin,
    );
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(withSo.id);
    expect(res.total).toBe(res.items.length);
  });

  it('every new Sort & Filter field runs on list AND count', async () => {
    const sf = JSON.stringify({
      sort: { field: 'soCode', dir: 'asc' },
      filters: [
        { field: 'soCode', kind: 'text', op: 'contains', q: 'S' },
        { field: 'soInternalNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'createdBy', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'lineCount', kind: 'num', op: 'gte', a: 0 },
        { field: 'grnReceivedQty', kind: 'num', op: 'gte', a: 0 },
        { field: 'qcAcceptedQty', kind: 'num', op: 'gte', a: 0 },
        { field: 'subtotal', kind: 'num', op: 'gte', a: 0 },
        { field: 'createdOn', kind: 'date', op: 'after', from: '2020-01-01' },
      ],
    });
    const res = await listPurchaseOrders(
      listPurchaseOrdersQuerySchema.parse({ sf, search: 'a', limit: '25', offset: '0' }),
      admin,
    );
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    for (const s of ['createdBy', 'lineCount', 'soInternalNo', 'subtotal']) {
      const sorted = JSON.stringify({ sort: { field: s, dir: 'desc' }, filters: [] });
      const r = await listPurchaseOrders(
        listPurchaseOrdersQuerySchema.parse({ sf: sorted, limit: '5', offset: '0' }),
        admin,
      );
      expect(r.items.length).toBeLessThanOrEqual(5);
    }
  });

  it('pages on POs: page 2 holds no PO of page 1', async () => {
    const p1 = await listPurchaseOrders(
      listPurchaseOrdersQuerySchema.parse({ limit: '5', offset: '0' }),
      admin,
    );
    const p2 = await listPurchaseOrders(
      listPurchaseOrdersQuerySchema.parse({ limit: '5', offset: '5' }),
      admin,
    );
    const one = new Set(p1.items.map((r) => r.id));
    for (const r of p2.items) expect(one.has(r.id)).toBe(false);
    expect(p2.total).toBe(p1.total);
  });
});
