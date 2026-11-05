// getRouteCardRelated (GET /route-cards/:id/related). TEST only, never production
// (house rules).

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, machines, routeCards, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import { getRouteCardRelated } from './related';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TRCREL-';

let admin: AuthContext;
let itemId: string;
let machineId: string;

async function cleanup(): Promise<void> {
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(machines).where(like(machines.code, `${P}%`));
}

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
  await cleanup();
  const it_ = await db
    .insert(items)
    .values({
      companyId: u.companyId,
      code: `${P}A`,
      name: 'RC related test',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'buy', // not a Drawing Rev test — a MAKE card needs one (0232)
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = it_[0]!.id;
  const m = await db
    .insert(machines)
    .values({
      companyId: u.companyId,
      code: `${P}MACH`,
      name: 'RC related machine',
      machineType: 'cnc',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  machineId = m[0]!.id;
});

afterAll(cleanup);

describe('getRouteCardRelated', () => {
  it('names the item, has no orders yet, and dates the card in IST', async () => {
    const card = await service.createRouteCard(
      {
        code: `${P}1`,
        itemId,
        ops: [
          {
            machineId,
            operation: 'od turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
      admin,
    );
    // 20:30 UTC on the 1st is 02:00 IST on the 2nd.
    await db
      .update(routeCards)
      .set({ createdAt: new Date('2026-05-01T20:30:00Z') })
      .where(eq(routeCards.id, card.id));

    const related = await getRouteCardRelated(card.id, admin);

    expect(related.self).toEqual({ module: 'route-cards', code: card.code });
    const itemTab = related.upstream.find((s) => s.key === 'item');
    expect(itemTab?.count).toBe(1);
    expect(itemTab?.items[0]?.items[0]?.itemCode).toBe(`${P}A`);
    expect(related.downstream.find((s) => s.key === 'production-orders')?.count).toBe(0);
    const created = related.timeline.find((e) => e.label === 'Route Card created');
    expect(created?.ts).toBe('2026-05-02');
  });

  it('throws NotFoundError for an unknown card', async () => {
    await expect(
      getRouteCardRelated('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
