// ADR-261 — GET /delivery-challans/lines (one row per DC line). Read-only
// tests against the TEST database's existing challans.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { listDeliveryChallanLines } from './list-lines';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('listDeliveryChallanLines', () => {
  it('returns one row per live DC line, agreeing with the DC list', async () => {
    const docs = await service.listDeliveryChallans({ limit: 200, offset: 0 }, admin);
    const lines = await listDeliveryChallanLines({ limit: 200, offset: 0 }, admin);

    // Same KPI totals as the DC list (both are line-grain sums).
    expect(lines.summary).toEqual(docs.summary);
    expect(lines.total).toBe(docs.summary.entryCount);

    // Every page row belongs to a DC in the company and carries the lead facts' keys.
    const docIds = new Set(docs.items.map((d) => d.id));
    for (const r of lines.items) {
      expect(typeof r.lineId).toBe('string');
      expect(typeof r.createdAt).toBe('string');
      expect(Number(r.qty)).toBeGreaterThan(0);
      if (docs.total <= 200) expect(docIds.has(r.docId)).toBe(true);
    }

    // Per DC, the line rows add up to the DC's own line count and Sent Qty.
    if (lines.total <= 200 && docs.total <= 200) {
      for (const d of docs.items) {
        const own = lines.items.filter((r) => r.docId === d.id);
        expect(own.length).toBe(d.lineCount);
        const sum = own.reduce((a, r) => a + Number(r.qty), 0);
        expect(sum).toBeCloseTo(Number(d.totalQty), 3);
      }
    }
  });

  it('line ids are unique (no join multiplies a line)', async () => {
    const lines = await listDeliveryChallanLines({ limit: 200, offset: 0 }, admin);
    expect(new Set(lines.items.map((r) => r.lineId)).size).toBe(lines.items.length);
  });

  it('sorts and filters through its own field map', async () => {
    const sf = JSON.stringify({
      sort: { field: 'itemCode', dir: 'asc' },
      filters: [
        { field: 'createdOn', kind: 'date', op: 'after', from: '2000-01-01' },
        { field: 'soCode', kind: 'text', op: 'contains', q: 'IN' },
      ],
    });
    const r = await listDeliveryChallanLines({ limit: 25, offset: 0, sf }, admin);
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it('is company-scoped: another company sees no lines', async () => {
    const other: AuthContext = { ...admin, companyId: '00000000-0000-0000-0000-000000000000' };
    const r = await listDeliveryChallanLines({ limit: 25, offset: 0 }, other);
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
  });

  it('refuses a user with no company', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(listDeliveryChallanLines({ limit: 25, offset: 0 }, orphan)).rejects.toThrow(
      AuthorizationError,
    );
  });
});
