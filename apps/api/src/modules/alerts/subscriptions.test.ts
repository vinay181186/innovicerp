import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { alertSubscriptions, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as subs from './subscriptions';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
// Codes this suite mutates. Disjoint from routes.test.ts (AL-009 / AL-012)
// so the two files don't wipe each other's in-flight rows under the same
// seed admin user when running in parallel.
const TOUCHED_CODES = ['AL-001', 'AL-002', 'AL-014'];

let admin: AuthContext;

async function clearMy(): Promise<void> {
  await db
    .delete(alertSubscriptions)
    .where(
      and(
        eq(alertSubscriptions.companyId, admin.companyId!),
        eq(alertSubscriptions.userId, admin.id),
        inArray(alertSubscriptions.code, TOUCHED_CODES),
      ),
    );
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
  await clearMy();
});

afterEach(async () => {
  await clearMy();
});

describe('alerts subscriptions service', () => {
  it("listMySubscriptions excludes this suite's codes initially", async () => {
    const r = await subs.listMySubscriptions(admin);
    const codes = r.subscriptions.map((s) => s.code);
    for (const c of TOUCHED_CODES) expect(codes).not.toContain(c);
  });

  it('setMySubscription(true) inserts a row visible via list', async () => {
    const created = await subs.setMySubscription({ code: 'AL-001', subscribed: true }, admin);
    expect(created).not.toBeNull();
    expect(created?.code).toBe('AL-001');
    expect(created?.channel).toBe('email');
    expect(typeof created?.subscribedAt).toBe('string');

    const r = await subs.listMySubscriptions(admin);
    expect(r.subscriptions).toHaveLength(1);
    expect(r.subscriptions[0]?.code).toBe('AL-001');
  });

  it('setMySubscription(true) is idempotent — second call keeps the same row', async () => {
    const first = await subs.setMySubscription({ code: 'AL-002', subscribed: true }, admin);
    const second = await subs.setMySubscription({ code: 'AL-002', subscribed: true }, admin);
    expect(second?.subscribedAt).toBe(first?.subscribedAt);

    const r = await subs.listMySubscriptions(admin);
    expect(r.subscriptions.filter((s) => s.code === 'AL-002')).toHaveLength(1);
  });

  it('setMySubscription(false) removes the subscription; idempotent', async () => {
    await subs.setMySubscription({ code: 'AL-014', subscribed: true }, admin);
    const removed = await subs.setMySubscription({ code: 'AL-014', subscribed: false }, admin);
    expect(removed).toBeNull();

    // Calling unsubscribe again is a no-op.
    const removedAgain = await subs.setMySubscription({ code: 'AL-014', subscribed: false }, admin);
    expect(removedAgain).toBeNull();

    const r = await subs.listMySubscriptions(admin);
    expect(r.subscriptions.find((s) => s.code === 'AL-014')).toBeUndefined();
  });

  it("listMySubscriptions returns this suite's rows in code-asc order", async () => {
    await subs.setMySubscription({ code: 'AL-002', subscribed: true }, admin);
    await subs.setMySubscription({ code: 'AL-001', subscribed: true }, admin);
    const r = await subs.listMySubscriptions(admin);
    // Filter to this suite's codes — routes.test.ts may have parallel
    // subscriptions for AL-009 / AL-012 mid-flight under the same admin.
    const owned = r.subscriptions.map((s) => s.code).filter((c) => TOUCHED_CODES.includes(c));
    expect(owned).toEqual(['AL-001', 'AL-002']);
  });

  it('listMySubscriptions throws AuthorizationError when user has no company', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(subs.listMySubscriptions(orphan)).rejects.toThrow(AuthorizationError);
  });

  it('setMySubscription throws AuthorizationError when user has no company', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(
      subs.setMySubscription({ code: 'AL-001', subscribed: true }, orphan),
    ).rejects.toThrow(AuthorizationError);
  });

  it("subscriptions are scoped to user — admin's row does not appear in another user's list", async () => {
    await subs.setMySubscription({ code: 'AL-001', subscribed: true }, admin);
    // Synthesize a second user via raw insert (no second seed user available
    // in the dev fixture). We don't need a real auth round-trip for this — we
    // just need the service to filter by user_id.
    const otherUser: AuthContext = {
      ...admin,
      id: '00000000-0000-0000-0000-000000000000', // bogus uuid; service filters by userId
      email: 'noone@example.invalid',
    };
    const r = await subs.listMySubscriptions(otherUser);
    expect(r.subscriptions.map((s) => s.code)).not.toContain('AL-001');
  });
});
