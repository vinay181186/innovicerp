// Day Log — who may see and manage whose day. The API connects as a BYPASSRLS
// role (0180), so this file is the only gate.
//   - Writes: the owner only, on their own day. Any set-up user except an L7
//     Auditor (requireCanWrite — no page tick, so an L1 viewer logs their day).
//   - Read someone else's day / the team: Super Admin and Auditor → everyone;
//     an L5 Department Admin of department D → everyone holding a D right
//     ABOVE L1 (L2–L5) — by rights, not by main department (owner
//     2026-10-27: "Kiran, QC Dept Admin, sees every person with QC L2/L3…").
//     Anyone else sees only their own; another's day is "not found".
//   - Manage (Reopen / Leave): Super Admin, or L5 over one of the person's
//     L2+ departments. An Auditor never.

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

/** Tiers that put a person on a Department Admin's team (above L1 viewer). */
const TEAM_TIERS: ReadonlySet<string> = new Set(['L2', 'L3', 'L4', 'L5']);

/** The viewer's L5 departments in which `departments` holds L2–L5. */
export function sharedTeamDepts(v: Viewer, departments: Record<string, unknown>): string[] {
  if (v.l5.size === 0) return [];
  const tiers = normalizeDeptsMap(departments as Parameters<typeof normalizeDeptsMap>[0]);
  return [...v.l5].filter((d) => TEAM_TIERS.has(String(tiers[d] ?? '')));
}

export function canSeeUser(
  v: Viewer,
  u: { id: string; departments: Record<string, unknown> },
): boolean {
  if (u.id === v.userId || v.isSuper || v.auditor) return true;
  return sharedTeamDepts(v, u.departments).length > 0;
}

export function canManageUser(v: Viewer, u: { departments: Record<string, unknown> }): boolean {
  if (v.auditor) return false;
  return v.isSuper || sharedTeamDepts(v, u.departments).length > 0;
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
  if (!u || !canSeeUser(v, u)) throw new NotFoundError('Day Log not found');
  return u;
}

/** Reopen / Leave: visible AND manageable, else refused. */
export async function requireManagedUser(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  userId: string,
): Promise<DayUser> {
  const u = await requireVisibleUser(tx, companyId, v, userId);
  // A Department Admin never reopens or marks Leave on their OWN day.
  if (u.id === v.userId && !v.isSuper) {
    throw new AuthorizationError(
      'Another Department Admin or a Super Admin must do this on your own Day Log.',
    );
  }
  if (!canManageUser(v, u)) {
    throw new AuthorizationError(
      "Only the person's Department Admin or a Super Admin can do this on a Day Log.",
    );
  }
  return u;
}
