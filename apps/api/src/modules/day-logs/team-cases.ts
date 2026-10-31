// Day Log — Teams Config (0230; ONE-WAY since 0231, owner 2026-10-31), TEST
// database. A Super Admin gives a User a team mate; the User sees the mate's
// saved day read-only (no Entry Rev, no replies, no manage / approve) and the
// mate does NOT see the User unless that row is set too. Registered by
// service.test.ts (teamCases()) so it shares that file's fixture. Main row:
// User = the seed admin's id (viewing with a plain, non-L5 matrix), mate = the
// owner. Rows among the fixture's users are soft-deleted before and after
// every case.
import { addDayLogTeamMateInputSchema } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { asAccess } from '../../lib/test-access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';
import { MON, add, at, fx, otherDeptAdmin, owner, sameDeptAdmin, superAdmin } from './test-fixture';

const C = at(MON, '17:00');

/** The seed admin's id as a plain viewer: no Full Access, no L5 anywhere. */
const plainAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.otherDept]: 'L1', tasks: 'L1' } }, 'manager');
/** The third user as a plain viewer, or null when TEST has none. */
const plainThird = (): AuthContext | null =>
  fx.thirdBase
    ? asAccess(fx.thirdBase, { departments: { [fx.otherDept]: 'L1', tasks: 'L1' } }, 'manager')
    : null;

const fixtureIds = (): string[] =>
  [fx.ownerBase.id, fx.admin.id, fx.thirdBase?.id].filter((x): x is string => !!x);

/** Soft-delete (§6 rule 8) every live pair among the fixture's users. */
async function wipePairs(): Promise<void> {
  const ids = fixtureIds();
  await db.execute(sql`
    UPDATE public.day_log_team_mates
    SET deleted_at = now(), deleted_by = ${fx.admin.id}::uuid,
        updated_at = now(), updated_by = ${fx.admin.id}::uuid
    WHERE deleted_at IS NULL
      AND user_id = ANY(${sql.param(ids)}::uuid[]) AND mate_id = ANY(${sql.param(ids)}::uuid[])
  `);
}

/** Set the owner's users.is_active (restored by the caller in finally). */
const setOwnerActive = (on: boolean) =>
  db.execute(sql`UPDATE public.users SET is_active = ${on} WHERE id = ${fx.ownerBase.id}::uuid`);

async function livePairs(): Promise<number> {
  const ids = fixtureIds();
  const [r] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM public.day_log_team_mates
    WHERE deleted_at IS NULL
      AND user_id = ANY(${sql.param(ids)}::uuid[]) AND mate_id = ANY(${sql.param(ids)}::uuid[])
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}

/** User = the seed admin, team mate = the owner: the admin SEES the owner's
 *  day (one-way, 0231) — the owner does not see the admin's. */
const pair = () =>
  service.addTeamMate({ userId: fx.admin.id, mateId: fx.ownerBase.id }, superAdmin());
/** The other direction: the owner sees the admin. */
const reversePair = () =>
  service.addTeamMate({ userId: fx.ownerBase.id, mateId: fx.admin.id }, superAdmin());
const dayOf = (userId: string, as: AuthContext) =>
  service.getPersonDay({ userId, date: MON }, as, C);
const teamIds = async (as: AuthContext) =>
  (await service.getTeam({ date: MON }, as, C)).rows.map((r) => r.userId);

export function teamCases(): void {
  describe('Day Log — Teams Config (one-way: the User sees the team mate)', () => {
    beforeEach(wipePairs);
    afterEach(wipePairs);

    it('before a row: no sight, no team tab', async () => {
      await add(MON, C);
      await expect(dayOf(fx.ownerBase.id, plainAdmin())).rejects.toBeInstanceOf(NotFoundError);
      expect((await service.getAccess(owner())).canSeeTeam).toBe(false);
      await expect(service.getTeam({ date: MON }, owner(), C)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it('User → mate: the User sees the mate read-only; the mate does NOT see the User', async () => {
      await add(MON, C, { description: 'mate-visible work' });
      const row = await pair();
      expect(row.mateId).toBe(fx.ownerBase.id);

      // Listed under the User only.
      const a = await service.listTeamMates({ userId: fx.admin.id }, superAdmin());
      expect(a.rows.map((x) => [x.id, x.mateId])).toEqual([[row.id, fx.ownerBase.id]]);
      const b = await service.listTeamMates({ userId: fx.ownerBase.id }, superAdmin());
      expect(b.rows).toEqual([]);

      // The User sees the mate's day: entries, no revisions, no replies.
      const d = await dayOf(fx.ownerBase.id, plainAdmin());
      expect([d.isSuperAdmin, d.canReply]).toEqual([false, false]);
      expect(d.entries.map((e) => e.description)).toEqual(['mate-visible work']);
      expect(d.entries.map((e) => [e.entryRevNo, e.revisions, e.replies])).toEqual([
        [null, [], []],
      ]);
      const day = await service.getDay({ userId: fx.ownerBase.id, date: MON }, plainAdmin(), C);
      expect([day.canWrite, day.canManage]).toEqual([false, false]);
      expect(await service.getAccess(plainAdmin())).toEqual({
        canSeeTeam: true,
        canApprove: false,
        canManageHolidays: false,
        canManageTeams: false,
      });
      expect(await teamIds(plainAdmin())).toEqual([fx.ownerBase.id]);

      // The mate sees nothing of the User: no tab, the day is "not found".
      await expect(dayOf(fx.admin.id, owner())).rejects.toBeInstanceOf(NotFoundError);
      expect((await service.getAccess(owner())).canSeeTeam).toBe(false);
    });

    it('both directions set: each sees the other; removing one keeps the other', async () => {
      const ab = await pair();
      const ba = await reversePair();
      expect(await livePairs()).toBe(2);
      expect(await teamIds(plainAdmin())).toEqual([fx.ownerBase.id]);
      expect(await teamIds(owner())).toEqual([fx.admin.id]);
      await service.removeTeamMate(ba.id, superAdmin());
      expect((await service.getAccess(owner())).canSeeTeam).toBe(false);
      expect(await teamIds(plainAdmin())).toEqual([fx.ownerBase.id]);
      await service.removeTeamMate(ab.id, superAdmin());
      expect(await livePairs()).toBe(0);
    });

    it('a third person sees neither', async () => {
      const third = plainThird();
      if (!third) return; // TEST has no third user
      await pair();
      await reversePair();
      await expect(dayOf(fx.ownerBase.id, third)).rejects.toBeInstanceOf(NotFoundError);
      await expect(dayOf(fx.admin.id, third)).rejects.toBeInstanceOf(NotFoundError);
      expect((await service.getAccess(third)).canSeeTeam).toBe(false);
    });

    it('the same User → mate again is a 409; one row stays', async () => {
      await pair();
      const again = await pair().catch((e: unknown) => e);
      expect(again).toBeInstanceOf(ConflictError);
      expect((again as Error).message).toMatch(/is already a team mate of/);
      expect(await livePairs()).toBe(1);
    });

    it('two adds of one User → mate at once — exactly one wins', async () => {
      const res = await Promise.allSettled([pair(), pair()]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictError);
      expect(await livePairs()).toBe(1);
    });

    it('remove: sight ends; a second remove is a 409; the day is untouched', async () => {
      await add(MON, C);
      const row = await pair();
      expect((await dayOf(fx.ownerBase.id, plainAdmin())).entries).toHaveLength(1);
      expect(await service.removeTeamMate(row.id, superAdmin())).toEqual({ ok: true });
      await expect(dayOf(fx.ownerBase.id, plainAdmin())).rejects.toBeInstanceOf(NotFoundError);
      expect((await service.getAccess(plainAdmin())).canSeeTeam).toBe(false);
      const twice = await service.removeTeamMate(row.id, superAdmin()).catch((e: unknown) => e);
      expect(twice).toBeInstanceOf(ConflictError);
      expect((twice as Error).message).toBe('This team mate was already removed.');
      expect((await service.getDay({ date: MON }, owner(), C)).entries).toHaveLength(1);
      // Removed, then added again: a fresh live row.
      await pair();
      expect(await livePairs()).toBe(1);
    });

    it('only a Super Admin (not an Auditor) lists / adds / removes', async () => {
      const row = await pair();
      const auditorSuper = asAccess(fx.admin, { fullAccess: true, auditor: true }, 'manager');
      for (const as of [sameDeptAdmin(), owner(), plainAdmin()]) {
        await expect(service.listTeamMates({ userId: fx.ownerBase.id }, as)).rejects.toBeInstanceOf(
          AuthorizationError,
        );
      }
      for (const as of [sameDeptAdmin(), owner(), auditorSuper]) {
        await expect(
          service.addTeamMate({ userId: fx.ownerBase.id, mateId: fx.admin.id }, as),
        ).rejects.toBeInstanceOf(AuthorizationError);
        await expect(service.removeTeamMate(row.id, as)).rejects.toBeInstanceOf(AuthorizationError);
      }
      expect(await livePairs()).toBe(1);
      expect((await service.getAccess(superAdmin())).canManageTeams).toBe(true);
      // The pickers' people: any Super Admin — also Full Access without role admin.
      const fullAccessManager = asAccess(fx.admin, { fullAccess: true }, 'manager');
      for (const as of [superAdmin(), fullAccessManager]) {
        const ids = (await service.listTeamPeople(as)).rows.map((p) => p.id);
        expect(ids).toContain(fx.ownerBase.id);
      }
      for (const as of [sameDeptAdmin(), owner(), plainAdmin()]) {
        await expect(service.listTeamPeople(as)).rejects.toBeInstanceOf(AuthorizationError);
      }
      expect((await service.getAccess(auditorSuper)).canManageTeams).toBe(false);
    });

    it('a self-pair is refused (schema and service)', async () => {
      const self = { userId: fx.ownerBase.id, mateId: fx.ownerBase.id };
      expect(addDayLogTeamMateInputSchema.safeParse(self).success).toBe(false);
      await expect(service.addTeamMate(self, superAdmin())).rejects.toBeInstanceOf(ValidationError);
      expect(await livePairs()).toBe(0);
    });

    it('a deactivated mate counts for nothing: no Team tab, their day stays closed', async () => {
      await pair();
      expect((await service.getAccess(plainAdmin())).canSeeTeam).toBe(true);
      await setOwnerActive(false);
      try {
        expect((await service.getAccess(plainAdmin())).canSeeTeam).toBe(false);
        await expect(dayOf(fx.ownerBase.id, plainAdmin())).rejects.toBeInstanceOf(NotFoundError);
        await expect(service.getTeam({ date: MON }, plainAdmin(), C)).rejects.toBeInstanceOf(
          AuthorizationError,
        );
      } finally {
        await setOwnerActive(true);
      }
      expect((await service.getAccess(plainAdmin())).canSeeTeam).toBe(true);
    });

    it('an L5 with a mate sees the department team plus the mate, manages only the team', async () => {
      const l5 = otherDeptAdmin(); // owner holds no L2+ in that department
      const before = await teamIds(l5);
      expect(before).not.toContain(fx.ownerBase.id);
      await pair();
      const after = await teamIds(l5);
      expect([...after].sort()).toEqual([...before, fx.ownerBase.id].sort());
      const day = await service.getDay({ userId: fx.ownerBase.id, date: MON }, l5, C);
      expect(day.canManage).toBe(false);
    });
  });
}
