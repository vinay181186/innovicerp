// ADR-261 — the Supply Chain Dashboard rows carry the lead-column fields
// (POL / Created On on the Pending PO Tracker; Created On on the SO and PO
// summaries) and their Sort & Filter fields run. Read-only.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listScPending } from './pending';
import { listScPoSummary, listScSos } from './summaries';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('sc-dashboard lead fields', () => {
  it('pending lines: POL / Created On present and sortable / filterable', async () => {
    const sf = JSON.stringify({
      sort: { field: 'createdOn', dir: 'desc' },
      filters: [
        { field: 'clientPoLineNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'soCode', kind: 'text', op: 'notContains', q: 'zzz' },
      ],
    });
    const res = await listScPending(admin, { sf, limit: 25, offset: 0 });
    for (const r of res.items) {
      expect('clientPoLineNo' in r).toBe(true);
      expect(typeof r.createdAt).toBe('string');
    }
  });

  it('SO and PO summaries carry Created On and sort on it', async () => {
    const sf = JSON.stringify({ sort: { field: 'createdOn', dir: 'asc' }, filters: [] });
    const sos = await listScSos(admin, { sf, limit: 25, offset: 0 });
    for (const r of sos.items) if (r.soCode) expect(typeof r.createdAt).toBe('string');
    const pos = await listScPoSummary(admin, { sf, limit: 25, offset: 0 });
    for (const r of pos.items) expect(typeof r.createdAt).toBe('string');
  });
});
