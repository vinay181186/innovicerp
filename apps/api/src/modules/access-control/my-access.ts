// The caller's own access — read once per request (ADR-229).
//
// One request reads the caller's access ONCE, however many guards ask (the
// Approvals badge alone asked four times). The answer is kept in the request
// scope the auth plugin opens on THAT request's user object
// (db/with-user-context): the next request gets a new object and reads the
// database again, so a right switched OFF still bites on the very next click.
// A context without a scope (the alerts worker, tests, a spread copy) simply
// reads every time.

import {
  cascadeFormsMap,
  normalizeDeptsMap,
  type AccessDeptsMap,
  type AccessFormsMap,
  type EffectiveAccess,
} from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { userAccess } from '../../db/schema';
import {
  type AuthContext,
  type FrozenAccess,
  requestScope,
  withUserContext,
} from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

/** jsonb arrives as `unknown` from the driver; a non-object reads as empty.
 *  The one coercion for a stored access matrix — the admin matrix list uses
 *  it too, so every screen reads a stored row the same way. */
export function asJsonMap<T>(v: unknown): T {
  return v && typeof v === 'object' ? (v as T) : ({} as T);
}

/** The one way a stored access row becomes an EffectiveAccess — used by the
 *  caller's own read, the department pickers and the Assembled By check, so
 *  all three ask the same question of the same shape. Every field is required,
 *  so a caller that forgets one is a compile error, not a silent "no". */
export function toEffectiveAccess(row: {
  fullAccess: boolean | null;
  auditor: boolean | null;
  drawingDownload: boolean | null;
  departments: unknown;
  forms: unknown;
}): EffectiveAccess {
  return {
    fullAccess: row.fullAccess ?? false,
    auditor: row.auditor ?? false,
    drawingDownload: row.drawingDownload ?? false,
    departments: normalizeDeptsMap(asJsonMap<AccessDeptsMap>(row.departments)),
    forms: cascadeFormsMap(asJsonMap<AccessFormsMap>(row.forms)),
  };
}

// Caller's own effective access — fail-closed: if no row exists, deny
// everything (admin can still grant themselves via the matrix UI).
export async function getMyAccess(user: AuthContext): Promise<FrozenAccess> {
  const scope = requestScope(user);
  if (!scope) return readMyAccess(user);
  if (!scope.myAccess) {
    const access = readMyAccess(user);
    scope.myAccess = access;
    // A failed read is not remembered — the next guard tries again. Guards
    // already waiting on it fail with it, as the request would have anyway.
    access.catch(() => {
      if (scope.myAccess === access) scope.myAccess = undefined;
    });
  }
  return scope.myAccess;
}

// Frozen on EVERY path, so a caller that tried to change the answer would fail
// the same way whether or not it was shared.
function freezeAccess(access: EffectiveAccess): FrozenAccess {
  for (const perms of Object.values(access.forms)) Object.freeze(perms);
  Object.freeze(access.forms);
  Object.freeze(access.departments);
  return Object.freeze(access);
}

// The read itself is unchanged: its own transaction with the caller's claims
// set, so it keeps working if the API ever stops bypassing RLS.
async function readMyAccess(user: AuthContext): Promise<FrozenAccess> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return freezeAccess(
    await withUserContext(user, async (tx): Promise<EffectiveAccess> => {
      const rows = await tx
        .select()
        .from(userAccess)
        .where(
          and(
            eq(userAccess.userId, user.id),
            eq(userAccess.companyId, companyId),
            isNull(userAccess.deletedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      // Fail closed: nobody set this person up, so every flag reads "no" —
      // the same shape an empty row gives.
      if (!row) {
        return toEffectiveAccess({
          fullAccess: null,
          auditor: null,
          drawingDownload: null,
          departments: null,
          forms: null,
        });
      }
      // drawingDownload is carried on /access-control/me so the screens can
      // decide whether to render a Download button. The button is only the
      // courtesy half — the refusal that holds is on the drawing-link route.
      return toEffectiveAccess(row);
    }),
  );
}
