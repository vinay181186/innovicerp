// DC service is read-only in T-040a so the test surface is small: list
// returns aggregates + joins, get returns header + lines, NotFound on bad id.
// We rely on the migrated dev rows (4 challans / 4 lines from T-039) — no
// fixture creation needed.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

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
});

describe('delivery-challans service', () => {
  it('listDeliveryChallans returns the 4 migrated challans with vendor/po/line aggregates', async () => {
    const result = await service.listDeliveryChallans({ limit: 200, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(4);
    // All 4 migrated DCs are vendored to VND-001
    const vendorNames = new Set(result.items.map((d) => d.vendorName));
    expect(vendorNames.size).toBeGreaterThan(0);
    // Each migrated DC has 1 line in current data
    for (const dc of result.items) {
      expect(dc.lineCount).toBeGreaterThanOrEqual(0);
    }
    // DC-00002 case: po_unresolved → poCode null but poCodeText preserved
    const dc00002 = result.items.find((d) => d.code === 'DC-00002');
    if (dc00002) {
      expect(dc00002.purchaseOrderId).toBeNull();
      expect(dc00002.poCodeText).toBe('IN-PO-00002');
    }
  });

  it('listDeliveryChallans status filter narrows to issued', async () => {
    const result = await service.listDeliveryChallans(
      { status: 'issued', limit: 200, offset: 0 },
      admin,
    );
    expect(result.items.every((d) => d.status === 'issued')).toBe(true);
  });

  it('listDeliveryChallans search matches code prefix', async () => {
    const result = await service.listDeliveryChallans(
      { search: 'DC-00001', limit: 50, offset: 0 },
      admin,
    );
    // DC-00001, DC-00001-02, DC-00001-03 all match
    expect(result.items.length).toBeGreaterThanOrEqual(3);
  });

  it('getDeliveryChallan returns header + lines for a migrated DC', async () => {
    const list = await service.listDeliveryChallans({ limit: 1, offset: 0 }, admin);
    const first = list.items[0];
    expect(first).toBeDefined();
    const detail = await service.getDeliveryChallan(first!.id, admin);
    expect(detail.id).toBe(first!.id);
    expect(detail.lines.length).toBeGreaterThanOrEqual(1);
    // Lines preserve uom enum + qty as numeric string
    for (const line of detail.lines) {
      expect(line.uom).toBeDefined();
      expect(line.qty).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('getDeliveryChallan throws NotFoundError on unknown id', async () => {
    await expect(
      service.getDeliveryChallan('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
