// ADR-261 — GET /purchase-orders/lines (list-lines.ts). Read-only: runs against
// whatever POs the TEST company already holds; creates nothing.
import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { purchaseOrderLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { listPurchaseOrderLines } from './list-lines';
import { listPurchaseOrdersQuerySchema } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('listPurchaseOrderLines', () => {
  it('returns one row per live PO line of the caller company, paged on lines', async () => {
    const q = listPurchaseOrdersQuerySchema.parse({ limit: '10', offset: '0' });
    const res = await listPurchaseOrderLines(q, admin);
    expect(res.limit).toBe(10);
    expect(res.items.length).toBeLessThanOrEqual(10);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    expect(new Set(res.items.map((r) => r.lineId)).size).toBe(res.items.length);
    if (res.items.length > 0) {
      const ids = res.items.map((r) => r.lineId);
      const stored = await db
        .select({
          id: purchaseOrderLines.id,
          companyId: purchaseOrderLines.companyId,
          poId: purchaseOrderLines.purchaseOrderId,
          deletedAt: purchaseOrderLines.deletedAt,
        })
        .from(purchaseOrderLines)
        .where(inArray(purchaseOrderLines.id, ids));
      for (const s of stored) {
        expect(s.companyId).toBe(admin.companyId);
        expect(s.deletedAt).toBeNull();
        expect(res.items.find((r) => r.lineId === s.id)?.docId).toBe(s.poId);
      }
    }
  });

  it('applies the PO status filter per row', async () => {
    const q = listPurchaseOrdersQuerySchema.parse({ status: 'closed', limit: '25', offset: '0' });
    const res = await listPurchaseOrderLines(q, admin);
    for (const r of res.items) expect(r.docStatus).toBe('closed');
  });

  it('every Sort & Filter field and the search run (list + count)', async () => {
    const sf = JSON.stringify({
      sort: { field: 'pendingQty', dir: 'desc' },
      filters: [
        { field: 'soCode', kind: 'text', op: 'contains', q: 'S' },
        { field: 'clientPoLineNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'itemCode', kind: 'text', op: 'contains', q: '-' },
        { field: 'createdOn', kind: 'date', op: 'after', from: '2020-01-01' },
        { field: 'grnReceivedQty', kind: 'num', op: 'gte', a: 0 },
        { field: 'qcAcceptedQty', kind: 'num', op: 'gte', a: 0 },
        { field: 'totalAmount', kind: 'num', op: 'gte', a: 0 },
      ],
    });
    const q = listPurchaseOrdersQuerySchema.parse({ sf, search: 'a', limit: '25', offset: '0' });
    const res = await listPurchaseOrderLines(q, admin);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    for (let i = 1; i < res.items.length; i++) {
      expect(res.items[i - 1]!.pendingQty).toBeGreaterThanOrEqual(res.items[i]!.pendingQty);
    }
  });

  it('is scoped to the caller company', async () => {
    const q = listPurchaseOrdersQuerySchema.parse({ limit: '5', offset: '0' });
    const other = { ...admin, companyId: '00000000-0000-0000-0000-000000000000' };
    const res = await listPurchaseOrderLines(q, other);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    await expect(listPurchaseOrderLines(q, { ...admin, companyId: null })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
