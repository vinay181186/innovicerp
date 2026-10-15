// OSP Process Configuration service tests.
//
// Integration against the dev DB (mirrors qc-processes/service.test.ts).
//
// Regression guard: create/update used to call `getOspProcess(id, user)` from
// INSIDE their own `withUserContext` transaction. That opens a second
// transaction on a different pooled connection, which cannot see the outer
// transaction's uncommitted INSERT — so create threw
// `NotFoundError: OSP process <id> not found` and rolled its own write back,
// leaving the process unsaved (and every downstream "Operation X does not match
// any configured OSP process" as the visible symptom). osp-cascade.test.ts
// seeds `ospProcesses` with a raw db.insert, so it never exercised this path.

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { ospProcesses, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const TEST_PREFIX = 'TOSP-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

afterAll(async () => {
  await db.delete(ospProcesses).where(like(ospProcesses.processName, `${TEST_PREFIX}%`));
});

describe('ospProcesses service', () => {
  it('createOspProcess returns the created row and persists it', async () => {
    const processName = `${TEST_PREFIX}Machining`;
    const created = await service.createOspProcess(
      { processName, vendorId: null, autoPo: false, leadDays: 7 },
      admin,
    );

    expect(created.processName).toBe(processName);
    expect(created.companyId).toBe(admin.companyId);
    expect(created.vendorId).toBeNull();
    expect(created.autoPo).toBe(false);
    expect(created.leadDays).toBe(7);

    // The write must survive the transaction — this is what actually broke:
    // create resolved its read on a separate connection, threw NotFound, and
    // rolled the INSERT back, so the process never appeared in the list.
    const listed = await service.listOspProcesses(admin);
    expect(listed.items.map((p) => p.processName)).toContain(processName);
  });

  it('createOspProcess rejects a duplicate name (case-insensitive)', async () => {
    const processName = `${TEST_PREFIX}Painting`;
    await service.createOspProcess(
      { processName, vendorId: null, autoPo: false, leadDays: 5 },
      admin,
    );
    await expect(
      service.createOspProcess(
        { processName: processName.toUpperCase(), vendorId: null, autoPo: false, leadDays: 5 },
        admin,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('updateOspProcess returns the post-update row, not a stale read', async () => {
    const created = await service.createOspProcess(
      { processName: `${TEST_PREFIX}Coating`, vendorId: null, autoPo: false, leadDays: 5 },
      admin,
    );
    const updated = await service.updateOspProcess(
      created.id,
      { processName: `${TEST_PREFIX}Coating-v2`, vendorId: null, autoPo: false, leadDays: 12 },
      admin,
    );
    expect(updated.processName).toBe(`${TEST_PREFIX}Coating-v2`);
    expect(updated.leadDays).toBe(12);
  });

  it('softDeleteOspProcess removes the row from the list', async () => {
    const created = await service.createOspProcess(
      { processName: `${TEST_PREFIX}HeatTreat`, vendorId: null, autoPo: false, leadDays: 5 },
      admin,
    );
    await service.softDeleteOspProcess(created.id, admin);

    const listed = await service.listOspProcesses(admin);
    expect(listed.items.map((p) => p.id)).not.toContain(created.id);
    await expect(service.getOspProcess(created.id, admin)).rejects.toThrow(NotFoundError);
  });
});

// ADR-232 (owner, 2026-10-15): deleting any record needs L6 Super Admin. No
// department tier — not even L5 Department Admin — and no page tick grants it.
describe('softDeleteOspProcess — Super Admin only (ADR-232)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

  it('L5 Production Department Admin cannot delete OSP processes — AuthorizationError', async () => {
    const l5 = asAccess(admin, { departments: { production: 'L5' } }, 'manager');
    await expect(service.softDeleteOspProcess(UNKNOWN_ID, l5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor cannot delete OSP processes — AuthorizationError', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { production: 'L5' } });
    await expect(service.softDeleteOspProcess(UNKNOWN_ID, auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the delete gate (unknown id → NotFoundError, not refused)', async () => {
    await expect(service.softDeleteOspProcess(UNKNOWN_ID, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ADR-232 (owner D3): OSP Process Configuration stays an Admin setting — create
// and update are Super Admin only, whatever the caller's department tier.
describe('OSP process create / update — Admin setting (ADR-232 D3)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
  const input = { processName: 'T-GATE-OSP', vendorId: null, autoPo: false, leadDays: 5 };

  it('an L5 Department Admin cannot create or update an OSP process — AuthorizationError', async () => {
    const l5 = asAccess(admin, { departments: { production: 'L5', purchase: 'L5' } }, 'manager');
    await expect(service.createOspProcess(input, l5)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.updateOspProcess(UNKNOWN_ID, input, l5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the update gate (unknown id → NotFoundError)', async () => {
    await expect(service.updateOspProcess(UNKNOWN_ID, input, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
