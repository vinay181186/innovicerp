// Access Control service — admin manages per-user permission matrix.
//
// Mirror of legacy db.userAccess CRUD (renderAccessControl L13861 list +
// _editAccess L13917 save handler). All writes admin-only. Reads:
// - `getMyAccess` returns the caller's own EffectiveAccess (any role; web
//   shell uses it to gate buttons + sidebar)
// - `listUserAccess` / `getUserAccess` are admin-only
//
// ADR-035 option A was "matrix is UI-only enforcement". 0100 starts
// closing that: `requireFormAccess` (../../lib/access) enforces the matrix
// server-side, and is wired into the approve/reject paths first because
// the `approve` action is new and has no legacy behaviour to preserve.
// The remaining modules' write endpoints are still role-gated only.

import {
  ACCESS_DEPTS,
  ACCESS_DEPT_KEYS,
  isAccessDeptKey,
  roleForAccess,
  ACCESS_FORM_KEYS,
  type AccessDeptsMap,
  type AccessFormsMap,
  cascadeFormsMap,
  type EffectiveAccess,
  type ListUserAccessResponse,
  normalizeDeptsMap,
  pruneDeptsMap,
  pruneFormsMap,
  type SaveUserAccessInput,
  type UserAccess,
  type UserAccessListItem,
} from '@innovic/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { userAccess, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Coerce a raw jsonb cell into a typed map. jsonb is `unknown` from the
// driver; defensive cast keeps the service free of `any`.
function asDeptsMap(v: unknown): AccessDeptsMap {
  return (v && typeof v === 'object' ? (v as AccessDeptsMap) : {}) ?? {};
}
function asFormsMap(v: unknown): AccessFormsMap {
  return (v && typeof v === 'object' ? (v as AccessFormsMap) : {}) ?? {};
}

function rowToUserAccess(r: {
  id: string;
  userId: string;
  companyId: string;
  fullAccess: boolean;
  auditor: boolean;
  mainDept: string | null;
  departments: unknown;
  forms: unknown;
  createdAt: Date;
  updatedAt: Date;
}): UserAccess {
  return {
    id: r.id,
    userId: r.userId,
    companyId: r.companyId,
    auditor: r.auditor,
    mainDept: r.mainDept,
    fullAccess: r.fullAccess,
    departments: asDeptsMap(r.departments),
    forms: asFormsMap(r.forms),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Count granted depts / forms for the list-row summary. A form counts as
// hand-configured if any of view/entry/edit/approve is true, or if money was
// granted below the department's normal level (`price`) or taken away above it
// (`priceOff`) — those are decisions someone made by hand and the row should
// not read as "nothing set here".
function countDepts(m: AccessDeptsMap): number {
  const tiers = normalizeDeptsMap(m);
  return ACCESS_DEPT_KEYS.reduce((n, k) => (tiers[k] ? n + 1 : n), 0);
}
function countForms(m: AccessFormsMap): number {
  return ACCESS_FORM_KEYS.reduce((n, k) => {
    const p = m[k];
    return p && (p.view || p.entry || p.edit || p.approve || p.price || p.priceOff)
      ? n + 1
      : n;
  }, 0);
}

// "Sales L3 · Store L1" — the headline for one matrix row. Precomputed
// server-side so the list page does not have to pull every user's full
// matrix just to render a column.
function tierSummary(m: AccessDeptsMap): string {
  const tiers = normalizeDeptsMap(m);
  const parts = ACCESS_DEPTS.flatMap((d) => {
    const t = tiers[d.key];
    return t ? [`${d.label} ${t}`] : [];
  });
  return parts.join(' · ');
}

// Caller's own effective access — fail-closed: if no row exists, deny
// everything (admin can still grant themselves via the matrix UI).
export async function getMyAccess(user: AuthContext): Promise<EffectiveAccess> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
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
    if (!row) {
      return { fullAccess: false, auditor: false, departments: {}, forms: {} };
    }
    return {
      fullAccess: row.fullAccess,
      auditor: row.auditor,
      departments: normalizeDeptsMap(asDeptsMap(row.departments)),
      forms: cascadeFormsMap(asFormsMap(row.forms)),
    };
  });
}

// Admin list: every user in the company + matrix summary. Self-join so
// users without an access row still appear (deptCount=0, formCount=0).
export async function listUserAccess(user: AuthContext): Promise<ListUserAccessResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        userId: users.id,
        userName: users.fullName,
        userEmail: users.email,
        role: users.role,
        isActive: users.isActive,
        acFullAccess: userAccess.fullAccess,
        acAuditor: userAccess.auditor,
        acMainDept: userAccess.mainDept,
        acDepartments: userAccess.departments,
        acForms: userAccess.forms,
      })
      .from(users)
      .leftJoin(
        userAccess,
        and(eq(userAccess.userId, users.id), isNull(userAccess.deletedAt)),
      )
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(desc(users.isActive), asc(users.fullName), asc(users.email));

    const items: UserAccessListItem[] = rows.map((r) => {
      const fullAccess = r.acFullAccess ?? false;
      const auditor = r.acAuditor ?? false;
      const depts = asDeptsMap(r.acDepartments);
      const forms = asFormsMap(r.acForms);
      const totalDepts = ACCESS_DEPT_KEYS.length;
      const totalForms = ACCESS_FORM_KEYS.length;
      return {
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        role: r.role,
        isActive: r.isActive,
        fullAccess,
        auditor,
        mainDept: r.acMainDept ?? null,
        derivedRole: roleForAccess({ fullAccess, auditor, departments: normalizeDeptsMap(depts) }),
        deptCount: fullAccess || auditor ? totalDepts : countDepts(depts),
        totalDepts,
        formCount: fullAccess ? totalForms : countForms(forms),
        totalForms,
        tierSummary: fullAccess
          ? 'L6 Super Admin — every department'
          : auditor
            ? 'L7 Auditor — reads every department'
            : tierSummary(depts),
      };
    });

    return { items };
  });
}

// Admin: full row for one user (used by the Configure modal). Returns a
// default-empty shape if no row exists yet so the modal can render
// without a separate code path.
export async function getUserAccess(userId: string, user: AuthContext): Promise<UserAccess> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the target user belongs to caller's company.
    const target = await tx
      .select({ id: users.id, companyId: users.companyId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (target.length === 0 || target[0]!.companyId !== companyId) {
      throw new NotFoundError(`User ${userId} not found`);
    }

    const rows = await tx
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.userId, userId),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row) return rowToUserAccess(row);

    // No row yet — return a synthetic default so the modal can show
    // un-saved defaults without writing first. UI calls save to persist.
    return {
      id: '',
      userId,
      companyId,
      fullAccess: false,
      auditor: false,
      mainDept: null,
      departments: {},
      forms: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

// Admin: upsert one user's matrix. Cascades view⊆entry⊆edit on save,
// prunes unknown dept/form keys, emits activity log.
export async function saveUserAccess(
  userId: string,
  input: SaveUserAccessInput,
  user: AuthContext,
): Promise<UserAccess> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  const cleanDepts = pruneDeptsMap(input.departments);
  const cleanForms = cascadeFormsMap(pruneFormsMap(input.forms));
  // L6 and L7 are mutually exclusive: Super Admin already reads everything
  // AND writes, so an account marked both is really just a Super Admin.
  // Resolving it here means the stored row can never say two things at once.
  const auditor = input.fullAccess ? false : input.auditor;
  // The main department has to be a real department that this person actually
  // holds a tier in. A stale value — the admin picked Design, then cleared the
  // Design row by hand — would leave the screen claiming a department the
  // access no longer backs. Neither whole-account level is departmental.
  const mainDept =
    input.fullAccess || auditor
      ? null
      : input.mainDept && isAccessDeptKey(input.mainDept) && cleanDepts[input.mainDept]
        ? input.mainDept
        : null;
  // `users.role` is DERIVED, never chosen (ADR-136). It is still what gates
  // 120 write paths, so it has to be written — but making it a consequence of
  // the access is what stops the role and the matrix ever contradicting.
  const derivedRole = roleForAccess({ fullAccess: input.fullAccess, auditor, departments: cleanDepts });

  return withUserContext(user, async (tx) => {
    // Confirm target user in caller's company.
    const target = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        companyId: users.companyId,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (target.length === 0 || target[0]!.companyId !== companyId) {
      throw new NotFoundError(`User ${userId} not found`);
    }
    const targetUser = target[0]!;

    // Dropping someone out of admin is now a one-click accident waiting to
    // happen: an admin with no access row loads an EMPTY box, so pressing Save
    // without touching anything derives them to viewer and locks them out with
    // no undo. Two guards.
    //
    // Yourself: always refused, whatever you tick. You cannot confirm your own
    // demotion, because if it is wrong there is nobody left to reverse it.
    if (userId === user.id && derivedRole !== 'admin' && targetUser.role === 'admin') {
      throw new ValidationError(
        'This would remove your own admin access — ask another admin to do it.',
      );
    }
    // Someone else: allowed, but only on purpose. The modal asks first and
    // resends with the flag set.
    if (
      userId !== user.id &&
      targetUser.role === 'admin' &&
      derivedRole !== 'admin' &&
      !input.confirmAdminChange
    ) {
      throw new ValidationError(
        `${targetUser.fullName ?? targetUser.email} is an admin. Saving this access would ` +
          `change them to "${derivedRole}" and they would lose admin rights. Tick Full Access ` +
          `to keep them an admin, or confirm the change.`,
      );
    }
    if (targetUser.role !== derivedRole) {
      await tx
        .update(users)
        .set({ role: derivedRole as typeof users.$inferSelect.role, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    const existingRows = await tx
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.userId, userId),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    let saved;
    if (existing) {
      const updated = await tx
        .update(userAccess)
        .set({
          fullAccess: input.fullAccess,
          auditor,
          mainDept,
          departments: cleanDepts,
          forms: cleanForms,
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(userAccess.id, existing.id))
        .returning();
      saved = updated[0]!;
    } else {
      const inserted = await tx
        .insert(userAccess)
        .values({
          userId,
          companyId,
          fullAccess: input.fullAccess,
          auditor,
          mainDept,
          departments: cleanDepts,
          forms: cleanForms,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      saved = inserted[0]!;
    }

    await emitActivityLog(
      tx,
      {
        action: 'ACCESS',
        entity: 'Access Control',
        // Record WHAT the access became, not just that it changed — a bare
        // "updated access" line is useless to the person auditing it later.
        detail:
          `Updated access for ${targetUser.fullName ?? targetUser.email} — ` +
          (input.fullAccess
            ? 'L6 Super Admin (full access)'
            : auditor
              ? 'L7 Auditor (reads every department, writes nothing)'
              : `main dept ${mainDept ?? 'none'}; ` +
                (tierSummary(cleanDepts) || 'no departments') +
                `; ${countForms(cleanForms)} form override(s)`) +
          ` [role → ${derivedRole}]`,
        refId: userId,
      },
      companyId,
      user,
    );

    return rowToUserAccess(saved);
  });
}
