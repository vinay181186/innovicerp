// Day Log — who may see and manage whose day. The API connects as a BYPASSRLS
// role (0180), so this file is the only gate.
//   - Writes: the owner only, on their own day. Any set-up user except an L7
//     Auditor (requireCanWrite — no page tick, so an L1 viewer logs their day).
//   - Read someone else's day / the team: Super Admin and Auditor → everyone;
//     an L5 Department Admin → people whose main department is one they hold
//     L5 in. Anyone else sees only their own; another's day is "not found".
//   - Manage (Reopen / Leave / Remind): Super Admin, or L5 over the person's
//     main department. An Auditor never.

import { ACCESS_DEPTS, canWriteAnything, normalizeDeptsMap } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { getMyAccess } from '../access-control/service';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

export interface Viewer {
  userId: string;
  /** L6 Super Admin (full access, or role admin which only full access gives). */
  isSuper: boolean;
  auditor: boolean;
  /** Departments where the viewer holds L5. */
  l5: ReadonlySet<string>;
  /** May save anything at all (not an Auditor, not unconfigured). */
  writer: boolean;
}

/** Read the caller's access BEFORE a transaction opens (ADR-229). */
export async function loadViewer(user: AuthContext): Promise<Viewer> {
  if (user.role === 'admin') {
    return { userId: user.id, isSuper: true, auditor: false, l5: new Set(), writer: true };
  }
  const eff = await getMyAccess(user);
  const tiers = normalizeDeptsMap(eff.departments ?? {});
  const l5 = new Set(
    Object.entries(tiers)
      .filter(([, t]) => t === 'L5')
      .map(([d]) => d),
  );
  return {
    userId: user.id,
    isSuper: eff.fullAccess,
    auditor: eff.auditor,
    l5,
    writer: canWriteAnything(eff),
  };
}

export function canSeeUser(v: Viewer, userId: string, mainDept: string | null): boolean {
  if (userId === v.userId || v.isSuper || v.auditor) return true;
  return !!mainDept && v.l5.has(mainDept);
}

export function canManageUser(v: Viewer, mainDept: string | null): boolean {
  if (v.auditor) return false;
  return v.isSuper || (!!mainDept && v.l5.has(mainDept));
}

export const canSeeTeam = (v: Viewer): boolean => v.isSuper || v.auditor || v.l5.size > 0;

export const deptLabelOf = (dept: string | null): string | null =>
  dept ? (ACCESS_DEPTS.find((d) => d.key === dept)?.label ?? dept) : null;

export interface DayUser {
  id: string;
  name: string;
  mainDept: string | null;
  departments: Record<string, unknown>;
}

/** One user of the company (active or not) with their main department. */
export async function loadDayUser(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<DayUser | null> {
  const rows = (await tx.execute(sql`
    SELECT u.id::text AS id, COALESCE(u.full_name, u.email) AS name,
           ua.main_dept AS main_dept, COALESCE(ua.departments, '{}'::jsonb) AS departments
    FROM public.users u
    LEFT JOIN public.user_access ua
      ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
    WHERE u.id = ${userId}::uuid AND u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{
    id: string;
    name: string;
    main_dept: string | null;
    departments: Record<string, unknown>;
  }>;
  const r = rows[0];
  return r ? { id: r.id, name: r.name, mainDept: r.main_dept, departments: r.departments } : null;
}

/** The person whose day is asked for — "not found" when the viewer may not see it. */
export async function requireVisibleUser(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  userId: string,
): Promise<DayUser> {
  const u = await loadDayUser(tx, companyId, userId);
  if (!u || !canSeeUser(v, u.id, u.mainDept)) throw new NotFoundError('Day Log not found');
  return u;
}

/** Reopen / Leave / Remind: visible AND manageable, else refused. */
export async function requireManagedUser(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  userId: string,
): Promise<DayUser> {
  const u = await requireVisibleUser(tx, companyId, v, userId);
  if (!canManageUser(v, u.mainDept)) {
    throw new AuthorizationError(
      "Only the person's Department Admin or a Super Admin can do this on a Day Log.",
    );
  }
  return u;
}

/** The tier key a user holds in a department ("L1"…"L5"), or null. */
export function tierIn(departments: Record<string, unknown>, dept: string): string | null {
  return normalizeDeptsMap(departments as Parameters<typeof normalizeDeptsMap>[0])[dept] ?? null;
}
