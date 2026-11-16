// ADR-303 — GET /delivery-challans is the OSP Outward DC list again: ONE ROW
// PER DC. Read-only: runs against whatever DCs the TEST company already holds.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { deliveryChallanLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listDeliveryChallans } from './service';
import { listDeliveryChallansQuerySchema } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
const q = (o: Record<string, string>) => listDeliveryChallansQuerySchema.parse(o);

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('listDeliveryChallans — one row per DC (ADR-303)', () => {
  it('a DC with many lines is ONE row; lineCount = its live lines', async () => {
    const res = await listDeliveryChallans(q({ limit: '50', offset: '0' }), admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (ids.length === 0) return;
    const counts = await db
      .select({ dc: deliveryChallanLines.deliveryChallanId, n: sql<number>`count(*)::int` })
      .from(deliveryChallanLines)
      .where(
        and(
          inArray(deliveryChallanLines.deliveryChallanId, ids),
          isNull(deliveryChallanLines.deletedAt),
        ),
      )
      .groupBy(deliveryChallanLines.deliveryChallanId);
    const byDc = new Map(counts.map((c) => [c.dc, Number(c.n)]));
    for (const r of res.items) {
      expect(r.lineCount).toBe(byDc.get(r.id) ?? 0);
      expect(r.soExtraCount).toBeGreaterThanOrEqual(0);
      expect(r.jobCardExtraCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('the SO dropdown (soCode tick) returns each DC once, incl. the DC it came from', async () => {
    const all = await listDeliveryChallans(q({ limit: '200', offset: '0' }), admin);
    const withSo = all.items.find((r) => r.lineSoCode);
    if (!withSo) return;
    const sf = JSON.stringify({
      sort: null,
      filters: [{ field: 'soCode', kind: 'values', values: [withSo.lineSoCode] }],
    });
    const res = await listDeliveryChallans(q({ sf, limit: '200', offset: '0' }), admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(withSo.id);
    expect(res.total).toBe(res.items.length);
  });

  it('every new Sort & Filter field runs on list AND count', async () => {
    const sf = JSON.stringify({
      sort: { field: 'jobCardCode', dir: 'asc' },
      filters: [
        { field: 'soCode', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'soInternalNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'jobCardCode', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'createdBy', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'lineCount', kind: 'num', op: 'gte', a: 0 },
      ],
    });
    const res = await listDeliveryChallans(q({ sf, search: 'a', limit: '25', offset: '0' }), admin);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    for (const s of ['soCode', 'soInternalNo', 'createdBy', 'totalQty']) {
      const sorted = JSON.stringify({ sort: { field: s, dir: 'desc' }, filters: [] });
      const r = await listDeliveryChallans(q({ sf: sorted, limit: '5', offset: '0' }), admin);
      expect(r.items.length).toBeLessThanOrEqual(5);
    }
  });
});
