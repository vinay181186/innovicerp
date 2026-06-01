import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import type { ListUsersQuery, ListUsersResponse, UpdateUserInput, User } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function listUsers(
  input: ListUsersQuery,
  user: AuthContext,
): Promise<ListUsersResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(users.companyId, companyId), isNull(users.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(users.fullName, `%${input.search}%`),
        ilike(users.email, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.role) conditions.push(eq(users.role, input.role));
    if (input.isActive !== undefined) conditions.push(eq(users.isActive, input.isActive));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(users)
        .where(where)
        .orderBy(asc(users.email))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(users).where(where),
    ]);

    return {
      items: rows as unknown as User[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getUser(id: string, user: AuthContext): Promise<User> {
  requireAdminRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`User ${id} not found`);
    return row as unknown as User;
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  user: AuthContext,
): Promise<User> {
  requireAdminRole(user);
  requireCompany(user);

  // Guard self-demotion + self-deactivation so an admin can't lock themselves
  // out of their own account in one click. They can still hand admin to
  // someone else first then have *that* admin demote them.
  if (id === user.id) {
    if (input.role !== undefined && input.role !== 'admin') {
      throw new ValidationError('Cannot demote yourself — ask another admin to do it');
    }
    if (input.isActive === false) {
      throw new ValidationError('Cannot deactivate yourself');
    }
  }

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`User ${id} not found`);
    if (existing[0]!.companyId !== user.companyId) {
      throw new NotFoundError(`User ${id} not found`);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.fullName !== undefined) updates.fullName = emptyToNull(input.fullName);
    if (input.role !== undefined) updates.role = input.role;
    if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    // approval_limit is a numeric column → store as string; null clears it.
    if (input.approvalLimit !== undefined) {
      updates.approvalLimit = input.approvalLimit === null ? null : String(input.approvalLimit);
    }

    const updated = await tx.update(users).set(updates).where(eq(users.id, id)).returning();
    return updated[0] as unknown as User;
  });
}

export async function softDeleteUser(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireAdminRole(user);
  requireCompany(user);

  if (id === user.id) {
    throw new ValidationError('Cannot delete yourself');
  }

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`User ${id} not found`);
    if (existing[0]!.companyId !== user.companyId) {
      throw new NotFoundError(`User ${id} not found`);
    }

    await tx
      .update(users)
      .set({ deletedAt: new Date(), isActive: false, updatedBy: user.id })
      .where(eq(users.id, id));
    return { ok: true };
  });
}
