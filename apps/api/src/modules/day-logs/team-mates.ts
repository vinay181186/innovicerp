// Day Log — Teams Config (owner 2026-10-30; ONE-WAY since 0231, owner
// 2026-10-31). A Super Admin picks a User and a team mate: the User gets
// read-only sight of the mate's day (access.ts canSeeUser) — not the other way
// round; that needs its own row (mate → User).
// Mates never manage or approve. Only a Super Admin lists; only a Super Admin
// who is not an Auditor adds or removes. A resent save is the Idempotency-Key
// plugin's (ADR-172); two adds of one User → mate meet the partial unique
// (ON CONFLICT DO NOTHING → 409) — mate → User is a separate row; a remove is
// a conditional UPDATE (§20.2).

import type {
  AddDayLogTeamMateInput,
  DayLogTeamMate,
  DayLogTeamMatesQuery,
  DayLogTeamMatesResponse,
  DayLogTeamPeopleResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  type Viewer,
  accessJson,
  deptLabelOf,
  loadViewer,
  type PersonAccess,
  personAccessJson,
  personOpensDayLog,
  resolveAccess,
  viewerOf,
} from './access';
import { ts } from './day';
import { requireCompany } from './writes';

const ENTITY = 'Day Log Team Mate';

function assertList(v: Viewer): void {
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can see Teams Config.');
}

function assertManage(v: Viewer): void {
  if (!v.isSuper || v.auditor) {
    throw new AuthorizationError('Only a Super Admin can change Teams Config.');
  }
}

/** GET — the chosen user's mates, by mate name. ONE statement (access + rows). */
export async function listTeamMates(
  query: DayLogTeamMatesQuery,
  user: AuthContext,
): Promise<DayLogTeamMatesResponse> {
  const companyId = requireCompany(user);
  const uid = query.userId;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', q.id, 'mateId', q.mate_id, 'mateName', q.mate_name,
                'mainDept', q.main_dept, 'addedAt', q.added_at)
              ORDER BY q.mate_name, q.mate_id), '[]'::json)
       FROM (
         SELECT m.id::text AS id, u.id::text AS mate_id,
           COALESCE(u.full_name, u.email) AS mate_name, ua.main_dept,
           ${ts('m.created_at')} AS added_at
         FROM public.day_log_team_mates m
         JOIN public.users u ON u.id = m.mate_id AND u.company_id = m.company_id
           AND u.deleted_at IS NULL
         LEFT JOIN public.user_access ua
           ON ua.user_id = u.id AND ua.company_id = m.company_id AND ua.deleted_at IS NULL
         WHERE m.company_id = ${companyId}::uuid AND m.deleted_at IS NULL
           AND m.user_id = ${uid}::uuid) q) AS rows
  `)) as unknown as Array<{
    access: unknown;
    rows: Array<{
      id: string;
      mateId: string;
      mateName: string;
      mainDept: string | null;
      addedAt: string;
    }> | null;
  }>;
  assertList(viewerOf(user, await resolveAccess(user, r?.access)));
  return {
    userId: uid,
    rows: (r?.rows ?? []).map((x) => ({
      id: x.id,
      mateId: x.mateId,
      mateName: x.mateName,
      mateDeptLabel: deptLabelOf(x.mainDept),
      addedAt: x.addedAt,
    })),
  };
}

/** GET people — who the Teams Config pickers offer: active users whose Day
 *  Log is not hidden, by name. ONE statement (access + people). */
export async function listTeamPeople(user: AuthContext): Promise<DayLogTeamPeopleResponse> {
  const companyId = requireCompany(user);
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', u.id::text, 'name', COALESCE(u.full_name, u.email),
                'mainDept', ua.main_dept,
                'departments', COALESCE(ua.departments, '{}'::jsonb), ${personAccessJson})
              ORDER BY COALESCE(u.full_name, u.email)), '[]'::json)
       FROM public.users u
       LEFT JOIN public.user_access ua
         ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
       WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active) AS people
  `)) as unknown as Array<{
    access: unknown;
    people: Array<PersonAccess & { id: string; name: string; mainDept: string | null }> | null;
  }>;
  assertList(viewerOf(user, await resolveAccess(user, r?.access)));
  return {
    rows: (r?.people ?? [])
      .filter((p) => personOpensDayLog(p))
      .map((p) => ({ id: p.id, name: p.name, deptLabel: deptLabelOf(p.mainDept) })),
  };
}

interface PairUser {
  id: string;
  name: string;
  mainDept: string | null;
  active: boolean;
}

/** One user of the company (not deleted) as json, for the add's checks. */
const pairUserJson = (companyId: string, id: string) => sql`(
  SELECT json_build_object('id', u.id::text, 'name', COALESCE(u.full_name, u.email),
           'mainDept', ua.main_dept, 'active', u.is_active)
  FROM public.users u
  LEFT JOIN public.user_access ua
    ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
  WHERE u.id = ${id}::uuid AND u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL
  LIMIT 1)`;

function activeUser(u: PairUser | null, who: string): PairUser {
  if (!u) throw new ValidationError(`${who} is not a user of this company.`);
  if (!u.active) throw new ValidationError(`${u.name} is not an active user — pick someone else.`);
  return u;
}

/** POST — the User now sees the team mate. 409 when that User → mate is
 *  already set (mate → User is a different row). */
export async function addTeamMate(
  input: AddDayLogTeamMateInput,
  user: AuthContext,
): Promise<DayLogTeamMate> {
  const companyId = requireCompany(user);
  if (input.userId === input.mateId) {
    throw new ValidationError('A person always sees their own Day Log — pick someone else.');
  }
  return withUserContext(user, async (tx) => {
    // ONE statement: the caller's access and both people.
    const [r] = (await tx.execute(sql`
      SELECT ${accessJson(user.id, companyId)} AS access,
        ${pairUserJson(companyId, input.userId)} AS person,
        ${pairUserJson(companyId, input.mateId)} AS mate
    `)) as unknown as Array<{ access: unknown; person: PairUser | null; mate: PairUser | null }>;
    assertManage(viewerOf(user, await resolveAccess(user, r?.access)));
    const person = activeUser(r?.person ?? null, 'The chosen person');
    const mate = activeUser(r?.mate ?? null, 'The chosen team mate');

    // Two adds of one User → mate at once: the partial unique lets exactly
    // one in; the other gets 0 rows here.
    const rows = (await tx.execute(sql`
      INSERT INTO public.day_log_team_mates
        (company_id, user_id, mate_id, created_by, updated_by)
      VALUES (${companyId}::uuid, ${person.id}::uuid, ${mate.id}::uuid, ${user.id}::uuid, ${user.id}::uuid)
      ON CONFLICT (company_id, user_id, mate_id) WHERE deleted_at IS NULL DO NOTHING
      RETURNING id::text AS id, ${ts('created_at')} AS added_at
    `)) as unknown as Array<{ id: string; added_at: string }>;
    const row = rows[0];
    if (!row) throw new ConflictError(`${mate.name} is already a team mate of ${person.name}.`);
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: ENTITY,
        entityId: row.id,
        detail: `Teams Config: ${person.name} can see ${mate.name}'s Day Log`,
      },
      companyId,
      user,
    );
    return {
      id: row.id,
      mateId: mate.id,
      mateName: mate.name,
      mateDeptLabel: deptLabelOf(mate.mainDept),
      addedAt: row.added_at,
    };
  });
}

/** DELETE — remove one User → mate row (soft). 409 when it is already removed. Never
 *  touches anyone's Day Log. */
export async function removeTeamMate(id: string, user: AuthContext): Promise<{ ok: true }> {
  const companyId = requireCompany(user);
  assertManage(await loadViewer(user));
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      WITH m AS (
        UPDATE public.day_log_team_mates
        SET deleted_at = now(), deleted_by = ${user.id}::uuid,
            updated_at = now(), updated_by = ${user.id}::uuid
        WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
        RETURNING user_id, mate_id)
      SELECT (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = m.user_id) AS a,
        (SELECT COALESCE(u.full_name, u.email) FROM public.users u WHERE u.id = m.mate_id) AS b
      FROM m
    `)) as unknown as Array<{ a: string | null; b: string | null }>;
    const r = rows[0];
    if (!r) throw new ConflictError('This team mate was already removed.');
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: ENTITY,
        entityId: id,
        detail: `Teams Config: ${r.a ?? '?'} can no longer see ${r.b ?? '?'}'s Day Log`,
      },
      companyId,
      user,
    );
    return { ok: true as const };
  });
}
