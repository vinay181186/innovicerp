// JC list service tests. Uses the existing migrated data on dev Supabase
// (T-029d): 2 surviving JCs (IN-JC-00002, IN-JC-00003), both with their
// source_so_line_id backfilled to SO-436 lines. Read-only — no test
// fixtures inserted; we just assert the service exposes the data correctly.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
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

describe('job-cards service', () => {
  it('listJobCards returns headers + computed status + source link for migrated JCs', async () => {
    const result = await service.listJobCards({ limit: 50, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = result.items.find((j) => j.code === 'IN-JC-00002');
    const jc03 = result.items.find((j) => j.code === 'IN-JC-00003');
    expect(jc02).toBeDefined();
    expect(jc03).toBeDefined();

    // v_jc_status enrichment present
    expect(typeof jc02!.computedStatus).toBe('string');
    expect(jc02!.totalOps).toBeGreaterThanOrEqual(0);
    expect(jc02!.doneOps).toBeGreaterThanOrEqual(0);

    // SO source link backfilled in T-029d (legacy soRefId -> SO-436 lines)
    expect(jc02!.sourceLink).not.toBeNull();
    expect(jc02!.sourceLink?.type).toBe('so');
    if (jc02!.sourceLink?.type === 'so') {
      expect(jc02!.sourceLink.code).toBe('SO-436');
      expect(jc02!.sourceLink.lineNo).toBe(6);
      expect(jc02!.sourceLink.partName).toBe('JOINT');
    }

    expect(jc03!.sourceLink?.type).toBe('so');
    if (jc03!.sourceLink?.type === 'so') {
      expect(jc03!.sourceLink.code).toBe('SO-436');
      expect(jc03!.sourceLink.lineNo).toBe(4);
      expect(jc03!.sourceLink.partName).toBe('SPACER');
    }

    // Item info joined
    expect(jc02!.itemCode).not.toBe('');
    expect(jc02!.itemName).not.toBe('');
  });

  it('listJobCards filters by status — scoped to migrated IN-JC-0000* JCs', async () => {
    // Use the migrated JCs (IN-JC-00002, IN-JC-00003) as a stable
    // population — other test files create + tear down JCs which would
    // race against an unscoped query.
    const all = await service.listJobCards(
      { search: 'IN-JC-0000', limit: 200, offset: 0 },
      admin,
    );
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const jc02 = all.items.find((j) => j.code === 'IN-JC-00002');
    expect(jc02).toBeDefined();
    const status = jc02!.computedStatus;
    const filtered = await service.listJobCards(
      { search: 'IN-JC-0000', status, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((j) => j.computedStatus === status)).toBe(true);
  });

  it('listJobCards search matches against jc code, item code, and SO source code', async () => {
    const bySoCode = await service.listJobCards(
      { search: 'SO-436', limit: 50, offset: 0 },
      admin,
    );
    // Both surviving JCs are linked to SO-436
    expect(bySoCode.items.length).toBeGreaterThanOrEqual(2);
    expect(
      bySoCode.items.every((j) => j.sourceLink?.type === 'so' && j.sourceLink.code === 'SO-436'),
    ).toBe(true);

    const byJcCode = await service.listJobCards(
      { search: 'IN-JC-00002', limit: 50, offset: 0 },
      admin,
    );
    expect(byJcCode.items.length).toBe(1);
    expect(byJcCode.items[0]?.code).toBe('IN-JC-00002');
  });

  it('listJobCards date range filter inclusive', async () => {
    const all = await service.listJobCards({ limit: 200, offset: 0 }, admin);
    if (all.items.length === 0) return;
    const firstDate = all.items[0]!.jcDate;
    const filtered = await service.listJobCards(
      { fromDate: firstDate, toDate: firstDate, limit: 200, offset: 0 },
      admin,
    );
    expect(filtered.items.every((j) => j.jcDate === firstDate)).toBe(true);
  });

  it('getJobCard returns the single row by id', async () => {
    const list = await service.listJobCards({ limit: 1, offset: 0 }, admin);
    if (list.items.length === 0) return; // nothing seeded
    const target = list.items[0]!;
    const fetched = await service.getJobCard(target.id, admin);
    expect(fetched.id).toBe(target.id);
    expect(fetched.code).toBe(target.code);
    expect(fetched.computedStatus).toBe(target.computedStatus);
  });

  it('getJobCard throws NotFoundError for unknown id', async () => {
    await expect(
      service.getJobCard('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.listJobCards({ limit: 10, offset: 0 }, noCompanyUser),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
