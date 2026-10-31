// Day Log — who may see and manage whose day. The API connects as a BYPASSRLS
// role (0180), so this file is the only gate.
//   - Writes: the owner only, on their own day. Any set-up user except an L7
//     Auditor (requireCanWrite — no page tick, so an L1 viewer logs their day).
//   - Read someone else's day / the team: Super Admin and Auditor → everyone;
//     an L5 Department Admin of department D → everyone holding a D right
//     ABOVE L1 (L2–L5) — by rights, not by main department (owner
//     2026-10-27: "Kiran, QC Dept Admin, sees every person with QC L2/L3…").
//     Anyone else sees only their own; another's day is "not found".
//   - Approve an edit: Super Admin, or L5 over one of the person's L2+
//     departments. Never one's own; an Auditor never.
//   - "Hide page" on Day Log (owner 2026-10-30): every Day Log read and write
//     refuses the caller — checked in resolveAccess, the one door they share.
//     People whose Day Log is hidden are left out of Team Day Logs (their
//     waiting edits stay in Approvals so they can still be decided).
//   - Teams Config (0230; ONE-WAY since 0231, owner 2026-10-31): a Super
//     Admin gives a User a team mate; the User SEES the mate's day (read-only,
//     like any non-Super viewer) — the mate does not see the User unless that
//     row is set too. A mate never manages or approves. `mates` rides in the same statement as
//     the access (matesJson); a caller that does not read it gets none —
//     mates only ever widen what is seen, so a missing read refuses, never leaks.

import {
  ACCESS_DEPTS,
  canWriteAnything,
  effectiveFormPerms,
  isUnconfigured,
  normalizeDeptsMap,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { type AuthContext, type FrozenAccess, requestScope } from '../../db/with-user-context';
import { toEffectiveAccess } from '../access-control/my-access';
import { personHolds } from '../access-control/users-with-right';
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
  /** Teams Config — the other person of every live pair holding the viewer. */
  mates: ReadonlySet<string>;
}

/**
 * The caller's user_access row as ONE json value (a scalar sub-select), so
 * the access read rides inside the request's first statement instead of
 * getMyAccess's own transaction (4 round trips). Same row, same filter.
 */
export const accessJson = (userId: string, companyId: string): SQL => sql`(
  SELECT json_build_object('fullAccess', ua.full_access, 'auditor', ua.auditor,
           'drawingDownload', ua.drawing_download, 'departments', ua.departments,
           'forms', ua.forms)
  FROM public.user_access ua
  WHERE ua.user_id = ${userId}::uuid AND ua.company_id = ${companyId}::uuid
    AND ua.deleted_at IS NULL
  LIMIT 1)`;

/** The caller's Teams Config mates as ONE json array (a scalar sub-select)
 *  — put it beside accessJson in the same statement. Only mates who are
 *  active and not deleted; each carries its access so toMates can drop one
 *  whose Day Log is hidden (personOpensDayLog). */
export const matesJson = (userId: string, companyId: string): SQL => sql`(
  SELECT COALESCE(json_agg(json_build_object('id', u.id::text,
           'departments', COALESCE(ua.departments, '{}'::jsonb), ${personAccessJson})), '[]'::json)
  FROM public.day_log_team_mates m
  JOIN public.users u
    ON u.id = m.mate_id
   AND u.company_id = m.company_id AND u.deleted_at IS NULL AND u.is_active
  LEFT JOIN public.user_access ua
    ON ua.user_id = u.id AND ua.company_id = m.company_id AND ua.deleted_at IS NULL
  WHERE m.company_id = ${companyId}::uuid AND m.deleted_at IS NULL
    AND m.user_id = ${userId}::uuid)`;

/** The mates whose Day Log is not hidden (a hidden one opens nothing). */
const toMates = (json: unknown): ReadonlySet<string> =>
  new Set(
    (Array.isArray(json) ? (json as Array<PersonAccess & { id: string }>) : [])
      .filter((p) => personOpensDayLog(p))
      .map((p) => String(p.id)),
  );

/**
 * The caller's access from `row` (accessJson) — exactly what getMyAccess
 * answers: the request's memo first (ADR-229; tests pre-fill it), else the
 * row through the same toEffectiveAccess, then remembered for the request.
 * null for role admin (no read needed — every guard passes them).
 */
export async function resolveAccess(user: AuthContext, row: unknown): Promise<FrozenAccess | null> {
  if (user.role === 'admin') return null;
  const scope = requestScope(user);
  if (scope?.myAccess) return assertDayLogPage(await scope.myAccess);
  const r = (row ?? {}) as Record<string, unknown>;
  const eff = toEffectiveAccess({
    fullAccess: (r['fullAccess'] as boolean | null) ?? null,
    auditor: (r['auditor'] as boolean | null) ?? null,
    drawingDownload: (r['drawingDownload'] as boolean | null) ?? null,
    departments: r['departments'] ?? null,
    forms: r['forms'] ?? null,
  });
  for (const perms of Object.values(eff.forms)) Object.freeze(perms);
  Object.freeze(eff.forms);
  Object.freeze(eff.departments);
  const frozen: FrozenAccess = Object.freeze(eff);
  if (scope) scope.myAccess = Promise.resolve(frozen);
  return assertDayLogPage(frozen);
}

/** May open the Day Log page (Day Log View, "Hide page" unticked)? Role admin
 *  never reaches here; Full Access passes inside effectiveFormPerms. */
export const opensDayLog = (eff: FrozenAccess): boolean =>
  effectiveFormPerms(eff, 'daylog_view').view;

/** Another person's access, as the json columns `personAccessJson` adds. */
export interface PersonAccess {
  role: string;
  fullAccess: boolean | null;
  auditor: boolean | null;
  departments: unknown;
  forms: unknown;
}

/** The json_build_object pairs a person row needs for `personOpensDayLog`
 *  (aliases: u = users, ua = user_access, LEFT JOINed). */
export const personAccessJson = sql`'role', u.role, 'fullAccess', ua.full_access,
  'auditor', ua.auditor, 'forms', COALESCE(ua.forms, '{}'::jsonb)`;

/** May this OTHER person open Day Log? Team Day Logs leaves out anyone whose
 *  Day Log is hidden. Same rule as the caller's own check. */
export function personOpensDayLog(p: PersonAccess): boolean {
  return personHolds(
    {
      role: p.role,
      acFullAccess: p.fullAccess,
      acAuditor: p.auditor,
      acDepartments: p.departments,
      acForms: p.forms,
    },
    'daylog_view',
    'view',
  );
}

/** requireFormAccess(user, 'daylog_view', 'view') on access already read. */
function assertDayLogPage(eff: FrozenAccess): FrozenAccess {
  if (opensDayLog(eff)) return eff;
  if (isUnconfigured(eff)) {
    throw new AuthorizationError(
      'Your account has no access configured yet. Ask an admin to set your ' +
        'department tiers in Access Control.',
    );
  }
  throw new AuthorizationError(
    'Your access does not let you open Day Log. Ask an admin to give you a Tasks tier, ' +
      'or to untick Hide page on Day Log in Access Control.',
  );
}

/** requireCanWrite (lib/access.ts) on access already read — same refusals. */
export function assertCanWrite(eff: FrozenAccess | null): void {
  if (!eff) return; // role admin
  if (eff.auditor) {
    throw new AuthorizationError('Auditor access is view-only. Ask an admin if you need to save.');
  }
  if (isUnconfigured(eff)) {
    throw new AuthorizationError(
      'Your account has no access configured yet. Ask an admin to set your ' +
        'department tiers in Access Control.',
    );
  }
}

/** The Viewer of access already read (resolveAccess); `mates` = the
 *  matesJson column of the same statement (omitted → no mates). */
export function viewerOf(user: AuthContext, eff: FrozenAccess | null, mates?: unknown): Viewer {
  if (!eff) {
    return {
      userId: user.id,
      isSuper: true,
      auditor: false,
      l5: new Set(),
      writer: true,
      mates: toMates(mates),
    };
  }
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
    mates: toMates(mates),
  };
}

const noCompany = (): AuthorizationError =>
  new AuthorizationError('User is not assigned to a company');

/** The caller's Viewer on its own — ONE statement (none for an admin or a
 *  request that already read its access, unless `withMates`: then the mates
 *  are read, beside the access when it is not read yet — still one). */
export async function loadViewer(
  user: AuthContext,
  opts: { withMates?: boolean } = {},
): Promise<Viewer> {
  const memo = user.role === 'admin' || !!requestScope(user)?.myAccess;
  // A role admin is Super Admin: mates add nothing.
  if (memo && (!opts.withMates || user.role === 'admin')) {
    return viewerOf(user, await resolveAccess(user, null));
  }
  if (!user.companyId) throw noCompany();
  const co = user.companyId;
  const [r] = (await db.execute(
    sql`SELECT ${memo ? sql`NULL::json` : accessJson(user.id, co)} AS access,
      ${opts.withMates ? matesJson(user.id, co) : sql`NULL::json`} AS mates`,
  )) as unknown as Array<{ access: unknown; mates: unknown }>;
  return viewerOf(user, await resolveAccess(user, r?.access), r?.mates);
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
  if (u.id === v.userId || v.isSuper || v.auditor || v.mates.has(u.id)) return true;
  return sharedTeamDepts(v, u.departments).length > 0;
}

export function canManageUser(v: Viewer, u: { departments: Record<string, unknown> }): boolean {
  if (v.auditor) return false;
  return v.isSuper || sharedTeamDepts(v, u.departments).length > 0;
}

export const canSeeTeam = (v: Viewer): boolean =>
  v.isSuper || v.auditor || v.l5.size > 0 || v.mates.size > 0;

/** May approve / reject this person's Day Log edits: Super Admin, or L5 of a
 *  department where the person holds L2+. Never one's own; an Auditor never. */
export const canApproveUser = (
  v: Viewer,
  u: { id: string; departments: Record<string, unknown> },
): boolean => u.id !== v.userId && canManageUser(v, u);

/** May approve anyone's edits at all (the Approvals tab). */
export const canApproveAny = (v: Viewer): boolean => !v.auditor && (v.isSuper || v.l5.size > 0);

export const deptLabelOf = (dept: string | null): string | null =>
  dept ? (ACCESS_DEPTS.find((d) => d.key === dept)?.label ?? dept) : null;

export interface DayUser {
  id: string;
  name: string;
  mainDept: string | null;
  departments: Record<string, unknown>;
}

/** One user of the company (active or not) as ONE json value (a scalar sub-select). */
export const dayUserJson = (companyId: string, userId: string | SQL): SQL => sql`(
  SELECT json_build_object('id', u.id::text, 'name', COALESCE(u.full_name, u.email),
           'mainDept', ua.main_dept, 'departments', COALESCE(ua.departments, '{}'::jsonb))
  FROM public.users u
  LEFT JOIN public.user_access ua
    ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
  WHERE u.id = ${userId}::uuid AND u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL
  LIMIT 1)`;

export const toDayUser = (json: unknown): DayUser | null => (json ? (json as DayUser) : null);

/** The person whose day is asked for, already read — "not found" when the
 *  viewer may not see it. */
export function visibleUser(v: Viewer, u: DayUser | null): DayUser {
  if (!u || !canSeeUser(v, u)) throw new NotFoundError('Day Log not found');
  return u;
}
