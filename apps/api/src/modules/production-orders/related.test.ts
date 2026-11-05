// getProductionOrderRelated (GET /production-orders/:id/related). Read-only: it reads
// whichever orders the database already has, and skips a case when it has none.
// TEST only, never production (house rules).

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { productionOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let companyId: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  companyId = u.companyId;
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

const istDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

async function latestOrder(cancelled: boolean) {
  const rows = await db
    .select({
      id: productionOrders.id,
      code: productionOrders.code,
      createdAt: productionOrders.createdAt,
    })
    .from(productionOrders)
    .where(
      and(
        eq(productionOrders.companyId, companyId),
        cancelled ? isNotNull(productionOrders.cancelledAt) : isNull(productionOrders.deletedAt),
      ),
    )
    .orderBy(desc(productionOrders.createdAt))
    .limit(1);
  return rows[0];
}

describe('getProductionOrderRelated', () => {
  it('returns the upstream sections, the item and an IST-dated timeline', async (ctx) => {
    const order = await latestOrder(false);
    if (!order) return ctx.skip();

    const related = await service.getProductionOrderRelated(order.id, admin);

    expect(related.self).toEqual({ module: 'production-orders', code: order.code });
    expect(related.upstream.map((s) => s.key)).toEqual(['plan', 'route-card', 'item']);
    expect(related.downstream.map((s) => s.key)).toEqual(['job-card']);
    const created = related.timeline.find((e) => e.label === 'Production Order created');
    expect(created?.ts).toBe(istDate(order.createdAt));
    expect(related.upstream.find((s) => s.key === 'item')?.count).toBeGreaterThan(0);
  });

  it('a Cancelled order still names its item', async (ctx) => {
    const order = await latestOrder(true);
    if (!order) return ctx.skip();

    const related = await service.getProductionOrderRelated(order.id, admin);

    const itemTab = related.upstream.find((s) => s.key === 'item');
    expect(itemTab?.count).toBeGreaterThan(0);
    expect(itemTab?.items[0]?.items[0]?.itemCode).toBeTruthy();
  });

  it('throws NotFoundError for an unknown order', async () => {
    await expect(
      service.getProductionOrderRelated('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
