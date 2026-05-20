// Companies service tests. Capture + restore the caller's company row so
// successive runs are idempotent against the dev DB.

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { companies, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

let admin: AuthContext;
let viewer: AuthContext;
let original: {
  name: string;
  gstNumber: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
};

beforeAll(async () => {
  const a = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!a || !a.companyId) throw new Error('Seed admin missing');
  admin = { id: a.id, email: a.email, companyId: a.companyId, role: a.role, isActive: a.isActive };

  const v = (await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)).limit(1))[0];
  if (!v || !v.companyId) throw new Error('Seed viewer missing');
  viewer = { id: v.id, email: v.email, companyId: v.companyId, role: v.role, isActive: v.isActive };

  const c = (
    await db.select().from(companies).where(eq(companies.id, admin.companyId!)).limit(1)
  )[0];
  if (!c) throw new Error('Seed company missing');
  original = {
    name: c.name,
    gstNumber: c.gstNumber,
    phone: c.phone,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    pincode: c.pincode,
  };
});

afterAll(async () => {
  await db
    .update(companies)
    .set({ ...original, updatedBy: admin.id })
    .where(eq(companies.id, admin.companyId!));
});

describe('companies service', () => {
  it('getMyCompany returns the caller company', async () => {
    const c = await service.getMyCompany(admin);
    expect(c.id).toBe(admin.companyId);
    expect(c.name).toBe(original.name);
  });

  it('updateMyCompany changes editable fields (admin)', async () => {
    const updated = await service.updateMyCompany(
      {
        name: 'TestCompany Renamed',
        gstNumber: '27AAAAA0000A1Z5',
        phone: '+91-99999-00000',
        addressLine1: 'Plot 1',
        addressLine2: 'MIDC',
        city: 'Pune',
        state: 'MH',
        pincode: '411001',
      },
      admin,
    );
    expect(updated.name).toBe('TestCompany Renamed');
    expect(updated.gstNumber).toBe('27AAAAA0000A1Z5');
    expect(updated.city).toBe('Pune');
    expect(updated.pincode).toBe('411001');
  });

  it('updateMyCompany rejects non-admin', async () => {
    await expect(
      service.updateMyCompany({ name: 'Hi' }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
