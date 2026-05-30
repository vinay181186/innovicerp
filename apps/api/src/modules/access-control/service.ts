// Access Control service — admin manages per-user permission matrix.
//
// Mirror of legacy db.userAccess CRUD (renderAccessControl L13861 list +
// _editAccess L13917 save handler). All writes admin-only. Reads:
// - `getMyAccess` returns the caller's own EffectiveAccess (any role; web
//   shell uses it to gate buttons + sidebar)
// - `listUserAccess` / `getUserAccess` are admin-only
//
// ADR-035 option A: matrix is UI-only enforcement; per-form gating on
// other modules' write endpoints is a deferred audit task.

import {
  ACCESS_DEPT_KEYS,
  ACCESS_FORM_KEYS,
  type AccessDeptsMap,
  type AccessFormsMap,
  cascadeFormsMap,
  type EffectiveAccess,
  type ListUserAccessResponse,
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
import { AuthorizationError, NotFoundError } from '../../lib/errors';
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
  departments: unknown;
  forms: unknown;
  createdAt: Date;
  updatedAt: Date;
}): UserAccess {
  return {
    id: r.id,
    userId: r.userId,
    companyId: r.companyId,
    fullAccess: r.fullAccess,
    departments: asDeptsMap(r.departments),
    forms: asFormsMap(r.forms),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Count granted depts / forms for the list-row summary. A form counts as
// granted if any of view/entry/edit is true.
function countDepts(m: AccessDeptsMap): number {
  return ACCESS_DEPT_KEYS.reduce((n, k) => (m[k] ? n + 1 : n), 0);
}
function countForms(m: AccessFormsMap): number {
  return ACCESS_FORM_KEYS.reduce((n, k) => {
    const p = m[k];
    return p && (p.view || p.entry || p.edit) ? n + 1 : n;
  }, 0);
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
      return { fullAccess: false, departments: {}, forms: {} };
    }
    return {
      fullAccess: row.fullAccess,
      departments: asDeptsMap(row.departments),
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
        deptCount: fullAccess ? totalDepts : countDepts(depts),
        totalDepts,
        formCount: fullAccess ? totalForms : countForms(forms),
        totalForms,
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

  return withUserContext(user, async (tx) => {
    // Confirm target user in caller's company.
    const target = await tx
      .select({ id: users.id, fullName: users.fullName, email: users.email, companyId: users.companyId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (target.length === 0 || target[0]!.companyId !== companyId) {
      throw new NotFoundError(`User ${userId} not found`);
    }
    const targetUser = target[0]!;

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
        detail: `Updated access for ${targetUser.fullName ?? targetUser.email}`,
        refId: userId,
      },
      companyId,
      user,
    );

    return rowToUserAccess(saved);
  });
}
